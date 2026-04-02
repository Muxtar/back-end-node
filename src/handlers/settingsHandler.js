'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

function defaultSettings(userIdObj) {
  const now = new Date();
  return {
    _id: new ObjectId(),
    user_id: userIdObj,
    account: { account_status: 'active' },
    privacy: {
      last_seen: 'everyone',
      online_status: 'everyone',
      profile_photo: 'everyone',
      bio_visibility: 'everyone',
      find_by_phone: true,
      find_by_username: true,
      secret_chat_ttl: 0,
      encryption_level: 'standard',
    },
    chat: {
      theme: 'light',
      font_size: 'medium',
      emoji_enabled: true,
      stickers_enabled: true,
      gif_enabled: true,
      message_preview: true,
      read_receipts: true,
      auto_download: { photos: 'wifi', videos: 'wifi', audio: 'wifi', documents: 'wifi' },
    },
    notifications: {
      direct_chats: true,
      group_chats: true,
      calls: true,
      sound: 'default',
      vibration: 'default',
    },
    appearance: { theme: 'system', font_size: 'medium', animations: true },
    data: { cloud_sync: true },
    calls: {
      quality: 'medium',
      data_usage_mode: 'medium',
      video_calls: true,
      voice_calls: true,
      who_can_call: 'everyone',
      call_history: true,
    },
    groups: { who_can_create: 'everyone' },
    blocked_users: [],
    sessions: [],
    created_at: now,
    updated_at: now,
  };
}

async function getSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    let settings = await db.collection('user_settings').findOne({ user_id: userIdObj });

    if (!settings) {
      settings = defaultSettings(userIdObj);
      await db.collection('user_settings').insertOne(settings);
    }

    return res.status(200).json(settings);
  } catch (err) {
    console.error('getSettings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    const updateData = { ...req.body, updated_at: new Date() };

    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: updateData },
      { upsert: true }
    );

    return res.status(200).json({ message: 'Settings updated successfully' });
  } catch (err) {
    console.error('updateSettings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateAccountSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: { account: req.body, updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'Account settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updatePrivacySettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: { privacy: req.body, updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'Privacy settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateChatSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: { chat: req.body, updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'Chat settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateNotificationSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: { notifications: req.body, updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'Notification settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateAppearanceSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: { appearance: req.body, updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'Appearance settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateDataSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: { data: req.body, updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'Data settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateCallSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: { calls: req.body, updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'Call settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateGroupSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: { groups: req.body, updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'Group settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateAdvancedSettings(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $set: { advanced: req.body, updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'Advanced settings updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getSessions(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    const settings = await db.collection('user_settings').findOne({ user_id: userIdObj });
    const sessions = (settings && settings.sessions) || [];
    return res.status(200).json({ sessions });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function terminateSession(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    const { session_id } = req.params;
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $pull: { sessions: { id: session_id } } }
    );
    return res.status(200).json({ message: 'Session terminated' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function blockUser(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    // Validate user_id format
    try { new ObjectId(user_id); } catch { return res.status(400).json({ error: 'Invalid user_id' }); }

    // Store as string for consistent comparison throughout the app
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $addToSet: { blocked_users: user_id.toString() }, $set: { updated_at: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ message: 'User blocked' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function unblockUser(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    const blockedUserId = req.params.user_id;
    try { new ObjectId(blockedUserId); } catch { return res.status(400).json({ error: 'Invalid user_id' }); }

    // Pull both string and ObjectId variants for backwards compatibility
    await db.collection('user_settings').updateOne(
      { user_id: userIdObj },
      { $pull: { blocked_users: { $in: [blockedUserId, new ObjectId(blockedUserId)] } }, $set: { updated_at: new Date() } }
    );
    return res.status(200).json({ message: 'User unblocked' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getBlockedUsers(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    const settings = await db.collection('user_settings').findOne({ user_id: userIdObj });
    const blockedIds = (settings && settings.blocked_users) || [];

    // Enrich with user info
    const users = await db.collection('users').find({ _id: { $in: blockedIds } }).toArray();
    return res.status(200).json({ blocked_users: users });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function suspendAccount(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('users').updateOne(
      { _id: userIdObj },
      { $set: { account_status: 'suspended', updated_at: new Date() } }
    );
    return res.status(200).json({ message: 'Account suspended' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteAccount(req, res) {
  try {
    const db = getDB();
    const userIdObj = new ObjectId(req.userId);
    await db.collection('users').updateOne(
      { _id: userIdObj },
      { $set: { account_status: 'deleted', updated_at: new Date() } }
    );
    return res.status(200).json({ message: 'Account deletion scheduled' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function clearCache(req, res) {
  return res.status(200).json({ message: 'Cache cleared' });
}

async function getDataUsage(req, res) {
  return res.status(200).json({ data_usage: { total_bytes: 0, photos: 0, videos: 0, audio: 0, documents: 0 } });
}

module.exports = {
  getSettings,
  updateSettings,
  updateAccountSettings,
  updatePrivacySettings,
  updateChatSettings,
  updateNotificationSettings,
  updateAppearanceSettings,
  updateDataSettings,
  updateCallSettings,
  updateGroupSettings,
  updateAdvancedSettings,
  getSessions,
  terminateSession,
  blockUser,
  unblockUser,
  getBlockedUsers,
  suspendAccount,
  deleteAccount,
  clearCache,
  getDataUsage,
};
