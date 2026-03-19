'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createProduct(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { title, description, price, currency, images, category, location } = req.body || {};

    if (!title) return res.status(400).json({ error: 'title is required' });

    const now = new Date();
    const productDoc = {
      user_id: userId,
      title,
      description: description || '',
      price: price || 0,
      currency: currency || 'USD',
      images: images || [],
      category: category || null,
      location: location || null,
      view_count: 0,
      like_count: 0,
      created_at: now,
      updated_at: now,
    };

    const insertResult = await db.collection('products').insertOne(productDoc);
    productDoc._id = insertResult.insertedId;

    return res.status(201).json({ ...productDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('createProduct error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getProducts(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const { category, user_id } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (user_id) filter.user_id = user_id;

    const total = await db.collection('products').countDocuments(filter);
    const skip = (page - 1) * limit;

    const products = await db.collection('products').find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Check if current user liked each product
    const result = [];
    for (const product of products) {
      const productIdStr = product._id.toString();
      let isLiked = false;

      if (userId) {
        const like = await db.collection('likes').findOne({
          product_id: productIdStr,
          user_id: userId,
          type: 'like',
        });
        isLiked = !!like;
      }

      result.push({ ...product, id: productIdStr, is_liked: isLiked });
    }

    return res.json({ products: result, total, page, limit });
  } catch (err) {
    console.error('getProducts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getProduct(req, res) {
  try {
    const db = getDB();
    const productIdStr = req.params.product_id;

    let productObjId;
    try {
      productObjId = new ObjectId(productIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const product = await db.collection('products').findOneAndUpdate(
      { _id: productObjId },
      { $inc: { view_count: 1 } },
      { returnDocument: 'after' }
    );

    if (!product) return res.status(404).json({ error: 'Product not found' });

    return res.json({ ...product, id: product._id.toString() });
  } catch (err) {
    console.error('getProduct error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateProduct(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const productIdStr = req.params.product_id;
    const updates = req.body || {};

    let productObjId;
    try {
      productObjId = new ObjectId(productIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const product = await db.collection('products').findOne({ _id: productObjId });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    if (product.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: not the owner' });
    }

    const setFields = { ...updates, updated_at: new Date() };
    delete setFields._id;
    delete setFields.user_id;
    delete setFields.view_count;
    delete setFields.like_count;

    await db.collection('products').updateOne(
      { _id: productObjId },
      { $set: setFields }
    );

    return res.json({ message: 'Product updated' });
  } catch (err) {
    console.error('updateProduct error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteProduct(req, res) {
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

    if (product.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: not the owner' });
    }

    // Delete product and related data
    await Promise.all([
      db.collection('products').deleteOne({ _id: productObjId }),
      db.collection('comments').deleteMany({ product_id: productIdStr }),
      db.collection('likes').deleteMany({ product_id: productIdStr }),
    ]);

    return res.json({ message: 'Product deleted' });
  } catch (err) {
    console.error('deleteProduct error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getUserProducts(req, res) {
  try {
    const db = getDB();
    const targetUserIdStr = req.params.user_id;

    const products = await db.collection('products').find({ user_id: targetUserIdStr })
      .sort({ created_at: -1 })
      .toArray();

    return res.json(products.map(p => ({ ...p, id: p._id.toString() })));
  } catch (err) {
    console.error('getUserProducts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  getUserProducts,
};
