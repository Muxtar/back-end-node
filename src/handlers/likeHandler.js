'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Product Likes ────────────────────────────────────────────────────────────

async function likeProduct(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const productIdStr = req.params.product_id;

    let productObjId;
    try {
      productObjId = new ObjectId(productIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const product = await db.collection('products').findOne({ _id: productObjId });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Idempotent check
    const existing = await db.collection('likes').findOne({
      product_id: productIdStr,
      user_id: userId,
      type: 'like',
    });
    if (existing) return res.json({ message: 'Already liked' });

    await db.collection('likes').insertOne({
      product_id: productIdStr,
      user_id: userId,
      type: 'like',
      created_at: new Date(),
    });

    await db.collection('products').updateOne(
      { _id: productObjId },
      { $inc: { like_count: 1 } }
    );

    return res.json({ message: 'Product liked' });
  } catch (err) {
    console.error('likeProduct error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function unlikeProduct(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const productIdStr = req.params.product_id;

    let productObjId;
    try {
      productObjId = new ObjectId(productIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const deleteResult = await db.collection('likes').deleteOne({
      product_id: productIdStr,
      user_id: userId,
      type: 'like',
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: 'Like not found' });
    }

    await db.collection('products').updateOne(
      { _id: productObjId },
      { $inc: { like_count: -1 } }
    );

    return res.json({ message: 'Product unliked' });
  } catch (err) {
    console.error('unlikeProduct error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Comment Likes ────────────────────────────────────────────────────────────

async function likeComment(req, res) {
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

    // Idempotent
    const existing = await db.collection('likes').findOne({
      comment_id: commentIdStr,
      user_id: userId,
      type: 'like',
    });
    if (existing) return res.json({ message: 'Already liked' });

    // Remove existing dislike if any
    const dislikeResult = await db.collection('likes').deleteOne({
      comment_id: commentIdStr,
      user_id: userId,
      type: 'dislike',
    });
    if (dislikeResult.deletedCount > 0) {
      await db.collection('comments').updateOne(
        { _id: commentObjId },
        { $inc: { dislike_count: -1 } }
      );
    }

    await db.collection('likes').insertOne({
      comment_id: commentIdStr,
      user_id: userId,
      type: 'like',
      created_at: new Date(),
    });

    await db.collection('comments').updateOne(
      { _id: commentObjId },
      { $inc: { like_count: 1 } }
    );

    return res.json({ message: 'Comment liked' });
  } catch (err) {
    console.error('likeComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function unlikeComment(req, res) {
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

    const deleteResult = await db.collection('likes').deleteOne({
      comment_id: commentIdStr,
      user_id: userId,
      type: 'like',
    });

    if (deleteResult.deletedCount > 0) {
      await db.collection('comments').updateOne(
        { _id: commentObjId },
        { $inc: { like_count: -1 } }
      );
    }

    return res.json({ message: 'Comment unliked' });
  } catch (err) {
    console.error('unlikeComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function dislikeComment(req, res) {
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

    // Idempotent
    const existing = await db.collection('likes').findOne({
      comment_id: commentIdStr,
      user_id: userId,
      type: 'dislike',
    });
    if (existing) return res.json({ message: 'Already disliked' });

    // Remove existing like
    const likeResult = await db.collection('likes').deleteOne({
      comment_id: commentIdStr,
      user_id: userId,
      type: 'like',
    });
    if (likeResult.deletedCount > 0) {
      await db.collection('comments').updateOne(
        { _id: commentObjId },
        { $inc: { like_count: -1 } }
      );
    }

    await db.collection('likes').insertOne({
      comment_id: commentIdStr,
      user_id: userId,
      type: 'dislike',
      created_at: new Date(),
    });

    await db.collection('comments').updateOne(
      { _id: commentObjId },
      { $inc: { dislike_count: 1 } }
    );

    return res.json({ message: 'Comment disliked' });
  } catch (err) {
    console.error('dislikeComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function undislikeComment(req, res) {
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

    const deleteResult = await db.collection('likes').deleteOne({
      comment_id: commentIdStr,
      user_id: userId,
      type: 'dislike',
    });

    if (deleteResult.deletedCount > 0) {
      await db.collection('comments').updateOne(
        { _id: commentObjId },
        { $inc: { dislike_count: -1 } }
      );
    }

    return res.json({ message: 'Comment undisliked' });
  } catch (err) {
    console.error('undislikeComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Profile Comment Likes ────────────────────────────────────────────────────

async function likeProfileComment(req, res) {
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
    if (!comment) return res.status(404).json({ error: 'Profile comment not found' });

    // Idempotent
    const existing = await db.collection('likes').findOne({
      profile_comment_id: commentIdStr,
      user_id: userId,
      type: 'like',
    });
    if (existing) return res.json({ message: 'Already liked' });

    // Remove existing dislike
    const dislikeResult = await db.collection('likes').deleteOne({
      profile_comment_id: commentIdStr,
      user_id: userId,
      type: 'dislike',
    });
    if (dislikeResult.deletedCount > 0) {
      await db.collection('profile_comments').updateOne(
        { _id: commentObjId },
        { $inc: { dislike_count: -1 } }
      );
    }

    await db.collection('likes').insertOne({
      profile_comment_id: commentIdStr,
      user_id: userId,
      type: 'like',
      created_at: new Date(),
    });

    await db.collection('profile_comments').updateOne(
      { _id: commentObjId },
      { $inc: { like_count: 1 } }
    );

    return res.json({ message: 'Profile comment liked' });
  } catch (err) {
    console.error('likeProfileComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function unlikeProfileComment(req, res) {
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

    const deleteResult = await db.collection('likes').deleteOne({
      profile_comment_id: commentIdStr,
      user_id: userId,
      type: 'like',
    });

    if (deleteResult.deletedCount > 0) {
      await db.collection('profile_comments').updateOne(
        { _id: commentObjId },
        { $inc: { like_count: -1 } }
      );
    }

    return res.json({ message: 'Profile comment unliked' });
  } catch (err) {
    console.error('unlikeProfileComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function dislikeProfileComment(req, res) {
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

    // Idempotent
    const existing = await db.collection('likes').findOne({
      profile_comment_id: commentIdStr,
      user_id: userId,
      type: 'dislike',
    });
    if (existing) return res.json({ message: 'Already disliked' });

    // Remove existing like
    const likeResult = await db.collection('likes').deleteOne({
      profile_comment_id: commentIdStr,
      user_id: userId,
      type: 'like',
    });
    if (likeResult.deletedCount > 0) {
      await db.collection('profile_comments').updateOne(
        { _id: commentObjId },
        { $inc: { like_count: -1 } }
      );
    }

    await db.collection('likes').insertOne({
      profile_comment_id: commentIdStr,
      user_id: userId,
      type: 'dislike',
      created_at: new Date(),
    });

    await db.collection('profile_comments').updateOne(
      { _id: commentObjId },
      { $inc: { dislike_count: 1 } }
    );

    return res.json({ message: 'Profile comment disliked' });
  } catch (err) {
    console.error('dislikeProfileComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function undislikeProfileComment(req, res) {
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

    const deleteResult = await db.collection('likes').deleteOne({
      profile_comment_id: commentIdStr,
      user_id: userId,
      type: 'dislike',
    });

    if (deleteResult.deletedCount > 0) {
      await db.collection('profile_comments').updateOne(
        { _id: commentObjId },
        { $inc: { dislike_count: -1 } }
      );
    }

    return res.json({ message: 'Profile comment undisliked' });
  } catch (err) {
    console.error('undislikeProfileComment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Product Like List ────────────────────────────────────────────────────────

async function getProductLikes(req, res) {
  try {
    const db = getDB();
    const productIdStr = req.params.product_id;

    const likes = await db.collection('likes').find({
      product_id: productIdStr,
      type: 'like',
    }).toArray();

    const result = [];
    for (const like of likes) {
      let user = null;
      if (like.user_id) {
        try {
          const userDoc = await db.collection('users').findOne(
            { _id: new ObjectId(like.user_id) },
            { projection: { _id: 1, username: 1, avatar: 1 } }
          );
          if (userDoc) {
            user = { id: userDoc._id.toString(), username: userDoc.username, avatar: userDoc.avatar };
          }
        } catch (_) {}
      }
      result.push({
        like: { ...like, id: like._id.toString() },
        user,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('getProductLikes error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  likeProduct,
  unlikeProduct,
  likeComment,
  unlikeComment,
  dislikeComment,
  undislikeComment,
  likeProfileComment,
  unlikeProfileComment,
  dislikeProfileComment,
  undislikeProfileComment,
  getProductLikes,
};
