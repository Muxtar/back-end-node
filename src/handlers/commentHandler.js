'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createComment(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const productIdStr = req.params.product_id;
    const { text, parent_id } = req.body || {};

    if (!text) return res.status(400).json({ error: 'text is required' });

    const now = new Date();
    const commentDoc = {
      product_id: productIdStr,
      user_id: userId,
      text,
      like_count: 0,
      dislike_count: 0,
      created_at: now,
    };

    if (parent_id) {
      commentDoc.parent_id = parent_id.toString();
    }

    const insertResult = await db.collection('comments').insertOne(commentDoc);
    commentDoc._id = insertResult.insertedId;

    return res.status(201).json({ ...commentDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('createComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getComments(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const productIdStr = req.params.product_id;

    const comments = await db.collection('comments').find({
      product_id: productIdStr,
    }).sort({ created_at: 1 }).toArray();

    // Batch enrich: users + likes (avoids N+1)
    const commentIdStrs = comments.map(c => c._id.toString());
    const userIdStrs = [...new Set(comments.map(c => c.user_id).filter(Boolean))];

    // Batch user lookup
    const userObjIds = userIdStrs.map(uid => { try { return new ObjectId(uid); } catch { return null; } }).filter(Boolean);
    const usersMap = new Map();
    if (userObjIds.length > 0) {
      const users = await db.collection('users').find(
        { _id: { $in: userObjIds } },
        { projection: { _id: 1, username: 1, avatar: 1 } }
      ).toArray();
      users.forEach(u => usersMap.set(u._id.toString(), { id: u._id.toString(), username: u.username, avatar: u.avatar }));
    }

    // Batch like/dislike lookup
    const likedSet = new Set();
    const dislikedSet = new Set();
    if (userId && commentIdStrs.length > 0) {
      const userReactions = await db.collection('likes').find({
        comment_id: { $in: commentIdStrs },
        user_id: userId,
      }).toArray();
      userReactions.forEach(r => {
        if (r.type === 'like') likedSet.add(r.comment_id);
        else if (r.type === 'dislike') dislikedSet.add(r.comment_id);
      });
    }

    const enrichedComments = comments.map(comment => {
      const cid = comment._id.toString();
      return {
        ...comment,
        id: cid,
        user: usersMap.get(comment.user_id) || null,
        is_liked: likedSet.has(cid),
        is_disliked: dislikedSet.has(cid),
      };
    });

    // Build reply tree: top-level comments + their replies
    const topLevel = enrichedComments.filter(c => !c.parent_id);
    const replyMap = new Map();
    for (const comment of enrichedComments) {
      if (comment.parent_id) {
        if (!replyMap.has(comment.parent_id)) replyMap.set(comment.parent_id, []);
        replyMap.get(comment.parent_id).push(comment);
      }
    }

    const result = topLevel.map(comment => ({
      ...comment,
      replies: replyMap.get(comment.id) || [],
    }));

    return res.json(result);
  } catch (err) {
    console.error('getComments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteComment(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const commentIdStr = req.params.comment_id;

    let commentObjId;
    try {
      commentObjId = new ObjectId(commentIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid comment ID' });
    }

    const comment = await db.collection('comments').findOne({ _id: commentObjId });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (comment.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: not the owner' });
    }

    await db.collection('comments').deleteOne({ _id: commentObjId });

    // Cascade: clean up likes, dislikes, spam reports for this comment
    await db.collection('likes').deleteMany({ comment_id: commentIdStr });
    await db.collection('spam_reports').deleteMany({ comment_id: commentIdStr });
    // Also delete child replies
    await db.collection('comments').deleteMany({ parent_id: commentIdStr });

    // Decrement comment count on product
    if (comment.product_id) {
      await db.collection('products').updateOne(
        { _id: new ObjectId(comment.product_id) },
        { $inc: { comment_count: -1 } }
      );
    }

    return res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error('deleteComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function reportSpam(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const commentIdStr = req.params.comment_id;
    const { reason } = req.body || {};

    const now = new Date();
    const reportDoc = {
      comment_id: commentIdStr,
      reporter_id: userId,
      reason: reason || '',
      created_at: now,
    };

    await db.collection('spam_reports').insertOne(reportDoc);

    return res.json({ message: 'Spam reported' });
  } catch (err) {
    console.error('reportSpam error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createComment,
  getComments,
  deleteComment,
  reportSpam,
};
