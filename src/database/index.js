'use strict';

const { MongoClient } = require('mongodb');

let db = null;
let client = null;

async function initialize(cfg) {
  const maxRetries = 5;
  let lastErr = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      client = new MongoClient(cfg.mongodbURI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        maxPoolSize: 100,
        minPoolSize: 10,
      });

      await client.connect();
      await client.db('admin').command({ ping: 1 });

      db = client.db(cfg.mongodbName);
      console.log('✅ MongoDB connected successfully');
      console.log(`📦 Using database: ${cfg.mongodbName}`);

      // Create indexes (idempotent — safe to run on every startup)
      await ensureIndexes(db);

      return db;
    } catch (err) {
      lastErr = err;
      if (i < maxRetries - 1) {
        const waitMs = Math.pow(2, i) * 1000;
        console.log(`MongoDB connection attempt ${i + 1}/${maxRetries} failed, retrying in ${waitMs / 1000}s...`);
        console.log(`Error: ${err.message}`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }

  console.error('❌ ERROR: Failed to connect to MongoDB after', maxRetries, 'attempts');
  console.error('Error:', lastErr?.message);
  process.exit(1);
}

async function ensureIndexes(database) {
  try {
    await Promise.all([
      database.collection('users').createIndex({ phone_number: 1 }, { unique: true, sparse: true }),
      database.collection('users').createIndex({ username: 1 }),
      database.collection('chats').createIndex({ members: 1 }),
      database.collection('messages').createIndex({ chat_id: 1, created_at: -1 }),
      database.collection('contacts').createIndex({ user_id: 1, contact_id: 1 }),
      database.collection('stories').createIndex({ expires_at: 1 }),
      database.collection('stories').createIndex({ user_id: 1 }),
      database.collection('likes').createIndex({ story_id: 1, user_id: 1 }),
      database.collection('likes').createIndex({ product_id: 1, user_id: 1 }),
      database.collection('likes').createIndex({ comment_id: 1, user_id: 1 }),
      database.collection('story_comments').createIndex({ story_id: 1 }),
      database.collection('notifications').createIndex({ user_id: 1, created_at: -1 }),
      database.collection('products').createIndex({ owner_id: 1 }),
      database.collection('products').createIndex({ created_at: -1 }),
      database.collection('product_views').createIndex({ product_id: 1, user_id: 1 }, { unique: true }),
      database.collection('verification_codes').createIndex({ phone_number: 1 }),
      database.collection('verification_codes').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    ]);
    console.log('📇 Database indexes ensured');
  } catch (err) {
    console.warn('⚠️ Index creation warning (non-fatal):', err.message);
  }
}

function getDB() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

async function close() {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

module.exports = { initialize, getDB, close };
