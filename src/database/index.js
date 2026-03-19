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
