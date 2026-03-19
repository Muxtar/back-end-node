'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function enrichStory(db, story, userId) {
  const enriched = { ...story, id: story._id.toString() };

  // Attach product if product type
  if (story.type === 'product' && story.product_id) {
    try {
      const product = await db.collection('products').findOne({
        _id: new ObjectId(story.product_id),
      });
      if (product) enriched.product = { ...product, id: product._id.toString() };
    } catch (_) {}
  }

  // Check is_liked / is_disliked
  const storyIdStr = story._id.toString();
  if (userId) {
    const like = await db.collection('likes').findOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'like',
    });
    enriched.is_liked = !!like;

    const dislike = await db.collection('likes').findOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'dislike',
    });
    enriched.is_disliked = !!dislike;
  }

  return enriched;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createStory(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { type, media_url, media_type, text, product_id } = req.body || {};

    if (!type) return res.status(400).json({ error: 'type is required' });

    if (type === 'media' && !media_url) {
      return res.status(400).json({ error: 'media_url is required for media stories' });
    }
    if (type === 'product' && !product_id) {
      return res.status(400).json({ error: 'product_id is required for product stories' });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const storyDoc = {
      user_id: userId,
      type,
      media_url: media_url || null,
      media_type: media_type || null,
      text: text || null,
      product_id: product_id || null,
      like_count: 0,
      dislike_count: 0,
      comment_count: 0,
      expires_at: expiresAt,
      created_at: now,
      updated_at: now,
    };

    const insertResult = await db.collection('stories').insertOne(storyDoc);
    storyDoc._id = insertResult.insertedId;

    return res.status(201).json({ ...storyDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('createStory error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getStoryFeed(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const now = new Date();

    const stories = await db.collection('stories').find({
      expires_at: { $gt: now },
    }).sort({ created_at: -1 }).toArray();

    // Group by user_id
    const userGroupMap = new Map();
    for (const story of stories) {
      const uid = story.user_id;
      if (!userGroupMap.has(uid)) userGroupMap.set(uid, []);
      userGroupMap.get(uid).push(story);
    }

    const feed = [];
    for (const [uid, userStories] of userGroupMap) {
      let userInfo = null;
      try {
        const user = await db.collection('users').findOne(
          { _id: new ObjectId(uid) },
          { projection: { _id: 1, username: 1, avatar: 1 } }
        );
        if (user) {
          userInfo = { id: user._id.toString(), username: user.username, avatar: user.avatar };
        }
      } catch (_) {}

      const enrichedStories = [];
      for (const story of userStories) {
        enrichedStories.push(await enrichStory(db, story, userId));
      }

      feed.push({
        user_id: uid,
        user_info: userInfo,
        stories: enrichedStories,
      });
    }

    return res.json({ feed });
  } catch (err) {
    console.error('getStoryFeed error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getUserStories(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const targetUserIdStr = req.params.user_id;
    const now = new Date();

    const stories = await db.collection('stories').find({
      user_id: targetUserIdStr,
      expires_at: { $gt: now },
    }).sort({ created_at: -1 }).toArray();

    const enrichedStories = [];
    for (const story of stories) {
      enrichedStories.push(await enrichStory(db, story, userId));
    }

    return res.json({ stories: enrichedStories });
  } catch (err) {
    console.error('getUserStories error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function likeStory(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const storyIdStr = req.params.story_id;

    // Remove existing dislike first
    const dislikeResult = await db.collection('likes').deleteOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'dislike',
    });
    if (dislikeResult.deletedCount > 0) {
      await db.collection('stories').updateOne(
        { _id: new ObjectId(storyIdStr) },
        { $inc: { dislike_count: -1 } }
      );
    }

    // Idempotent: check if already liked
    const existing = await db.collection('likes').findOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'like',
    });
    if (existing) return res.json({ message: 'Already liked' });

    await db.collection('likes').insertOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'like',
      created_at: new Date(),
    });
    await db.collection('stories').updateOne(
      { _id: new ObjectId(storyIdStr) },
      { $inc: { like_count: 1 } }
    );

    return res.json({ message: 'Story liked' });
  } catch (err) {
    console.error('likeStory error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function unlikeStory(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const storyIdStr = req.params.story_id;

    const deleteResult = await db.collection('likes').deleteOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'like',
    });

    if (deleteResult.deletedCount > 0) {
      await db.collection('stories').updateOne(
        { _id: new ObjectId(storyIdStr) },
        { $inc: { like_count: -1 } }
      );
    }

    return res.json({ message: 'Story unliked' });
  } catch (err) {
    console.error('unlikeStory error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function dislikeStory(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const storyIdStr = req.params.story_id;

    // Remove existing like first
    const likeResult = await db.collection('likes').deleteOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'like',
    });
    if (likeResult.deletedCount > 0) {
      await db.collection('stories').updateOne(
        { _id: new ObjectId(storyIdStr) },
        { $inc: { like_count: -1 } }
      );
    }

    // Idempotent
    const existing = await db.collection('likes').findOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'dislike',
    });
    if (existing) return res.json({ message: 'Already disliked' });

    await db.collection('likes').insertOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'dislike',
      created_at: new Date(),
    });
    await db.collection('stories').updateOne(
      { _id: new ObjectId(storyIdStr) },
      { $inc: { dislike_count: 1 } }
    );

    return res.json({ message: 'Story disliked' });
  } catch (err) {
    console.error('dislikeStory error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function undislikeStory(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const storyIdStr = req.params.story_id;

    const deleteResult = await db.collection('likes').deleteOne({
      story_id: storyIdStr,
      user_id: userId,
      type: 'dislike',
    });

    if (deleteResult.deletedCount > 0) {
      await db.collection('stories').updateOne(
        { _id: new ObjectId(storyIdStr) },
        { $inc: { dislike_count: -1 } }
      );
    }

    return res.json({ message: 'Story undisliked' });
  } catch (err) {
    console.error('undislikeStory error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function addStoryComment(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const storyIdStr = req.params.story_id;
    const { text } = req.body || {};

    if (!text) return res.status(400).json({ error: 'text is required' });

    let userInfo = null;
    try {
      const user = await db.collection('users').findOne(
        { _id: new ObjectId(userId) },
        { projection: { _id: 1, username: 1, avatar: 1 } }
      );
      if (user) userInfo = { id: user._id.toString(), username: user.username, avatar: user.avatar };
    } catch (_) {}

    const now = new Date();
    const commentDoc = {
      story_id: storyIdStr,
      user_id: userId,
      user_info: userInfo,
      text,
      created_at: now,
    };

    const insertResult = await db.collection('story_comments').insertOne(commentDoc);
    commentDoc._id = insertResult.insertedId;

    await db.collection('stories').updateOne(
      { _id: new ObjectId(storyIdStr) },
      { $inc: { comment_count: 1 } }
    );

    return res.status(201).json({ ...commentDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('addStoryComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getStoryComments(req, res) {
  try {
    const db = getDB();
    const storyIdStr = req.params.story_id;

    const comments = await db.collection('story_comments').find({
      story_id: storyIdStr,
    }).sort({ created_at: 1 }).toArray();

    return res.json({ comments: comments.map(c => ({ ...c, id: c._id.toString() })) });
  } catch (err) {
    console.error('getStoryComments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteStory(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const storyIdStr = req.params.story_id;

    let storyObjId;
    try {
      storyObjId = new ObjectId(storyIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid story ID' });
    }

    const deleteResult = await db.collection('stories').deleteOne({
      _id: storyObjId,
      user_id: userId,
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: 'Story not found or not owned by you' });
    }

    return res.json({ message: 'Story deleted' });
  } catch (err) {
    console.error('deleteStory error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createStory,
  getStoryFeed,
  getUserStories,
  likeStory,
  unlikeStory,
  dislikeStory,
  undislikeStory,
  addStoryComment,
  getStoryComments,
  deleteStory,
};
