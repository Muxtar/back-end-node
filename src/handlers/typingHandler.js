'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function setTyping(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const chatIdStr = req.params.chat_id;
    const { type } = req.body || {};

    const typingType = type || 'typing';
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5000); // expires in 5 seconds

    await db.collection('typing_indicators').updateOne(
      { chat_id: chatIdStr, user_id: userId },
      {
        $set: {
          chat_id: chatIdStr,
          user_id: userId,
          type: typingType,
          updated_at: now,
          expires_at: expiresAt,
        },
      },
      { upsert: true }
    );

    return res.json({ message: 'Typing indicator set' });
  } catch (err) {
    console.error('setTyping error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getTyping(req, res) {
  try {
    const db = getDB();
    const chatIdStr = req.params.chat_id;
    const now = new Date();

    const indicators = await db.collection('typing_indicators').find({
      chat_id: chatIdStr,
      expires_at: { $gt: now },
    }).toArray();

    return res.json({
      typing: indicators.map(ind => ({
        user_id: ind.user_id,
        type: ind.type,
      })),
    });
  } catch (err) {
    console.error('getTyping error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  setTyping,
  getTyping,
};
