'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_TYPE_PHONE = 'phone';
const TARGET_TYPE_CAR_NUMBER = 'car_number';
const TARGET_TYPE_PERSON_NAME = 'person_name';

const VALID_TARGET_TYPES = [TARGET_TYPE_PHONE, TARGET_TYPE_CAR_NUMBER, TARGET_TYPE_PERSON_NAME];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTargetType(t) {
  if (!t || !VALID_TARGET_TYPES.includes(t)) return TARGET_TYPE_PHONE;
  return t;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Public route — no auth required.
 */
async function createProfileCommentByPhone(req, res) {
  try {
    const db = getDB();
    const { phone_number, target_type, target_value, text } = req.body || {};

    if (!text) return res.status(400).json({ error: 'text is required' });
    if (!target_value && !phone_number) {
      return res.status(400).json({ error: 'target_value or phone_number is required' });
    }

    const normalizedType = normalizeTargetType(target_type);
    const resolvedTargetValue = target_value || phone_number;

    const now = new Date();
    const commentDoc = {
      target_type: normalizedType,
      target_value: resolvedTargetValue,
      text,
      like_count: 0,
      dislike_count: 0,
      created_at: now,
      updated_at: now,
    };

    // If phone type: try to find the user
    if (normalizedType === TARGET_TYPE_PHONE) {
      const phoneToLookup = phone_number || resolvedTargetValue;
      const targetUser = await db.collection('users').findOne({ phone_number: phoneToLookup });
      if (targetUser) {
        commentDoc.target_user_id = targetUser._id.toString();

        // Insert notification for the target user
        await db.collection('notifications').insertOne({
          user_id: targetUser._id.toString(),
          type: 'profile_comment',
          message: 'Someone left a comment on your profile',
          created_at: now,
        });
      }
    }

    const insertResult = await db.collection('profile_comments').insertOne(commentDoc);
    commentDoc._id = insertResult.insertedId;

    return res.status(201).json({ ...commentDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('createProfileCommentByPhone error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Auth-required route.
 */
async function createProfileComment(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { target_user_id, target_type, target_value, text } = req.body || {};

    if (!text) return res.status(400).json({ error: 'text is required' });

    const normalizedType = normalizeTargetType(target_type);

    const now = new Date();
    const commentDoc = {
      commenter_id: userId,
      target_type: normalizedType,
      target_value: target_value || null,
      text,
      like_count: 0,
      dislike_count: 0,
      created_at: now,
      updated_at: now,
    };

    if (normalizedType === TARGET_TYPE_PHONE) {
      // Resolve target user by phone or target_user_id
      let targetUser = null;
      if (target_user_id) {
        try {
          targetUser = await db.collection('users').findOne({ _id: new ObjectId(target_user_id) });
        } catch (_) {}
      } else if (target_value) {
        targetUser = await db.collection('users').findOne({ phone_number: target_value });
      }

      if (targetUser) {
        commentDoc.target_user_id = targetUser._id.toString();

        // Insert notification
        await db.collection('notifications').insertOne({
          user_id: targetUser._id.toString(),
          type: 'profile_comment',
          message: 'Someone left a comment on your profile',
          created_at: now,
        });
      }
    } else {
      // car_number or person_name: no target_user_id
      if (target_user_id) commentDoc.target_user_id = target_user_id.toString();
    }

    const insertResult = await db.collection('profile_comments').insertOne(commentDoc);
    commentDoc._id = insertResult.insertedId;

    return res.status(201).json({ ...commentDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('createProfileComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getProfileComments(req, res) {
  try {
    const db = getDB();
    const { target_user_id, phone_number } = req.query;

    const filter = {};
    if (target_user_id) {
      filter.target_user_id = target_user_id;
    } else if (phone_number) {
      filter.target_value = phone_number;
    } else {
      return res.status(400).json({ error: 'target_user_id or phone_number query param is required' });
    }

    const comments = await db.collection('profile_comments').find(filter)
      .sort({ created_at: -1 })
      .toArray();

    // Return without commenter_id (anonymous)
    return res.json(
      comments.map(c => ({
        id: c._id.toString(),
        text: c.text,
        like_count: c.like_count || 0,
        dislike_count: c.dislike_count || 0,
        target_type: c.target_type,
        target_value: c.target_value,
        created_at: c.created_at,
      }))
    );
  } catch (err) {
    console.error('getProfileComments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function replyToProfileComment(req, res) {
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

    const comment = await db.collection('profile_comments').findOne({ _id: commentObjId });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Only the target user can reply
    if (!comment.target_user_id || comment.target_user_id !== userId) {
      return res.status(403).json({ error: 'Only the target user can reply to this comment' });
    }

    const commenterIdStr = comment.commenter_id;
    if (!commenterIdStr) {
      return res.status(400).json({ error: 'No commenter to reply to' });
    }

    const now = new Date();

    // Find or create direct chat between target user and commenter (with anonymous_from_user_id)
    let chat = await db.collection('chats').findOne({
      type: 'direct',
      members: { $all: [userId, commenterIdStr] },
      anonymous_from_user_id: commenterIdStr,
    });

    if (!chat) {
      const chatDoc = {
        type: 'direct',
        members: [userId, commenterIdStr],
        anonymous_from_user_id: commenterIdStr,
        created_at: now,
        updated_at: now,
      };
      const chatInsert = await db.collection('chats').insertOne(chatDoc);
      chatDoc._id = chatInsert.insertedId;
      chat = chatDoc;
    }

    const chatIdStr = chat._id.toString();

    return res.json({
      chat_id: chatIdStr,
      message: 'You can now message the commenter anonymously',
    });
  } catch (err) {
    console.error('replyToProfileComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function searchProfileComments(req, res) {
  try {
    const db = getDB();
    const { q } = req.query;

    if (!q) return res.status(400).json({ error: 'q query param is required' });

    // Try to find a user with this phone number
    const matchedUser = await db.collection('users').findOne({ phone_number: q });

    const filter = {
      $or: [
        { target_value: { $regex: q, $options: 'i' } },
      ],
    };

    if (matchedUser) {
      filter.$or.push({ target_user_id: matchedUser._id.toString() });
    }

    const comments = await db.collection('profile_comments').find(filter)
      .sort({ created_at: -1 })
      .limit(50)
      .toArray();

    return res.json(
      comments.map(c => ({
        id: c._id.toString(),
        target_type: c.target_type,
        target_value: c.target_value,
        text: c.text,
        created_at: c.created_at,
      }))
    );
  } catch (err) {
    console.error('searchProfileComments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteProfileComment(req, res) {
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

    const comment = await db.collection('profile_comments').findOne({ _id: commentObjId });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Only the target_user_id owner can delete
    if (!comment.target_user_id || comment.target_user_id !== userId) {
      return res.status(403).json({ error: 'Only the target user can delete this comment' });
    }

    await db.collection('profile_comments').deleteOne({ _id: commentObjId });

    return res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error('deleteProfileComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createProfileCommentByPhone,
  createProfileComment,
  getProfileComments,
  replyToProfileComment,
  searchProfileComments,
  deleteProfileComment,
  TARGET_TYPE_PHONE,
  TARGET_TYPE_CAR_NUMBER,
  TARGET_TYPE_PERSON_NAME,
};
