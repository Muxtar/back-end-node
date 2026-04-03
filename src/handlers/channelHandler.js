'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createChannel(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { channel_name, description, is_public, public_link } = req.body || {};

    if (!channel_name) return res.status(400).json({ error: 'channel_name is required' });

    const now = new Date();
    const channelDoc = {
      type: 'channel',
      group_name: channel_name,
      description: description || '',
      is_public: is_public !== undefined ? is_public : true,
      public_link: public_link || null,
      is_broadcast: true,
      members: [userId],
      admins: [
        {
          user_id: userId,
          role: 'owner',
          permissions: ['all'],
          granted_at: now,
          granted_by: userId,
        },
      ],
      subscriber_count: 1,
      view_count: {},
      statistics: {},
      created_at: now,
      updated_at: now,
    };

    const insertResult = await db.collection('chats').insertOne(channelDoc);
    channelDoc._id = insertResult.insertedId;

    return res.status(201).json({ ...channelDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('createChannel error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function subscribe(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const channelIdStr = req.params.channel_id;

    let channelObjId;
    try {
      channelObjId = new ObjectId(channelIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const channel = await db.collection('chats').findOne({ _id: channelObjId, type: 'channel' });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // Atomic: only increment if user was NOT already a member
    // Use a filter that excludes existing members + $addToSet in one operation
    const result = await db.collection('chats').updateOne(
      { _id: channelObjId, members: { $not: { $elemMatch: { $eq: userId } } } },
      {
        $addToSet: { members: userId },
        $inc: { subscriber_count: 1 },
        $set: { updated_at: new Date() },
      }
    );

    // If no match (already a member), just ensure membership without incrementing
    if (result.matchedCount === 0) {
      await db.collection('chats').updateOne(
        { _id: channelObjId },
        { $addToSet: { members: userId }, $set: { updated_at: new Date() } }
      );
    }

    return res.json({ message: 'Subscribed to channel' });
  } catch (err) {
    console.error('subscribe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function unsubscribe(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const channelIdStr = req.params.channel_id;

    let channelObjId;
    try {
      channelObjId = new ObjectId(channelIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const channel = await db.collection('chats').findOne({ _id: channelObjId, type: 'channel' });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const isMember = Array.isArray(channel.members) && channel.members.some(m => m.toString() === userId);

    await db.collection('chats').updateOne(
      { _id: channelObjId },
      {
        $pull: { members: userId },
        $inc: isMember ? { subscriber_count: -1 } : {},
        $set: { updated_at: new Date() },
      }
    );

    return res.json({ message: 'Unsubscribed from channel' });
  } catch (err) {
    console.error('unsubscribe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function recordView(req, res) {
  try {
    const db = getDB();
    const channelIdStr = req.params.channel_id;
    const messageIdStr = req.params.message_id;

    let channelObjId;
    try {
      channelObjId = new ObjectId(channelIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const channel = await db.collection('chats').findOne({ _id: channelObjId, type: 'channel' });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // Only members can record views
    const userId = req.userId;
    const isMember = Array.isArray(channel.members) && channel.members.some(m => m.toString() === userId);
    if (!isMember) return res.status(403).json({ error: 'Not subscribed to this channel' });

    const viewKey = `view_count.${messageIdStr}`;
    await db.collection('chats').updateOne(
      { _id: channelObjId },
      { $inc: { [viewKey]: 1 } }
    );

    const updatedChannel = await db.collection('chats').findOne({ _id: channelObjId });
    const viewCount = updatedChannel?.view_count?.[messageIdStr] || 1;

    return res.json({ view_count: viewCount });
  } catch (err) {
    console.error('recordView error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getStatistics(req, res) {
  try {
    const db = getDB();
    const channelIdStr = req.params.channel_id;

    let channelObjId;
    try {
      channelObjId = new ObjectId(channelIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const channel = await db.collection('chats').findOne({ _id: channelObjId, type: 'channel' });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    return res.json(channel.statistics || {});
  } catch (err) {
    console.error('getStatistics error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createChannel,
  subscribe,
  unsubscribe,
  recordView,
  getStatistics,
};
