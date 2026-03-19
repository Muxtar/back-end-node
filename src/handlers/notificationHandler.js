'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function getNotifications(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const limit = parseInt(req.query.limit, 10) || 50;

    const notifications = await db
      .collection('notifications')
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    return res.json({
      notifications: notifications.map(n => ({ ...n, id: n._id.toString() })),
    });
  } catch (err) {
    console.error('getNotifications error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function markNotificationsRead(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { ids } = req.body || {};

    const now = new Date();

    if (Array.isArray(ids) && ids.length > 0) {
      const objIds = ids.map(id => {
        try { return new ObjectId(id); } catch (_) { return null; }
      }).filter(Boolean);

      await db.collection('notifications').updateMany(
        { _id: { $in: objIds }, user_id: userId },
        { $set: { read_at: now } }
      );
    } else {
      await db.collection('notifications').updateMany(
        { user_id: userId, read_at: { $exists: false } },
        { $set: { read_at: now } }
      );
    }

    return res.json({ message: 'Notifications marked as read' });
  } catch (err) {
    console.error('markNotificationsRead error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getUnreadCount(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;

    const count = await db.collection('notifications').countDocuments({
      user_id: userId,
      $or: [
        { read_at: { $exists: false } },
        { read_at: null },
      ],
    });

    return res.json({ unread_count: count });
  } catch (err) {
    console.error('getUnreadCount error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getNotifications,
  markNotificationsRead,
  getUnreadCount,
};
