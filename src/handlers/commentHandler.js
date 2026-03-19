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

    // Enrich with user info and like/dislike status
    const enrichedComments = [];
    for (const comment of comments) {
      const commentIdStr = comment._id.toString();
      let userInfo = null;

      try {
        const user = await db.collection('users').findOne(
          { _id: new ObjectId(comment.user_id) },
          { projection: { _id: 1, username: 1, avatar: 1 } }
        );
        if (user) {
          userInfo = { id: user._id.toString(), username: user.username, avatar: user.avatar };
        }
      } catch (_) {}

      let isLiked = false;
      let isDisliked = false;
      if (userId) {
        const like = await db.collection('likes').findOne({
          comment_id: commentIdStr,
          user_id: userId,
          type: 'like',
        });
        isLiked = !!like;

        const dislike = await db.collection('likes').findOne({
          comment_id: commentIdStr,
          user_id: userId,
          type: 'dislike',
        });
        isDisliked = !!dislike;
      }

      enrichedComments.push({
        ...comment,
        id: commentIdStr,
        user: userInfo,
        is_liked: isLiked,
        is_disliked: isDisliked,
      });
    }

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
