'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');
const { calculateDistance } = require('../utils/location');
const { hub } = require('../websocket/hub');

async function getMe(req, res) {
  try {
    const db = getDB();
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.userId) });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.hide_phone_number) user.phone_number = '';
    return res.status(200).json(user);
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getUserByID(req, res) {
  try {
    let userIDObj;
    try { userIDObj = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'Invalid user ID' }); }

    const db = getDB();
    const user = await db.collection('users').findOne({ _id: userIDObj });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.hide_phone_number) user.phone_number = '';
    return res.status(200).json(user);
  } catch (err) {
    console.error('getUserByID error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function searchByUsername(req, res) {
  try {
    const username = req.query.q || req.query.username;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const db = getDB();
    const user = await db.collection('users').findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.hide_phone_number) user.phone_number = '';
    return res.status(200).json(user);
  } catch (err) {
    console.error('searchByUsername error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getUserByPhoneNumber(req, res) {
  try {
    const phoneNumber = req.query.phone_number || req.query.phone;
    if (!phoneNumber) return res.status(400).json({ error: 'phone_number required' });

    const db = getDB();
    const user = await db.collection('users').findOne({ phone_number: phoneNumber });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.hide_phone_number) user.phone_number = '';
    return res.status(200).json(user);
  } catch (err) {
    console.error('getUserByPhoneNumber error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getDevices(req, res) {
  try {
    const db = getDB();
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.userId) });
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json(user.active_devices || []);
  } catch (err) {
    console.error('getDevices error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateMe(req, res) {
  try {
    const updateData = req.body;
    updateData.updated_at = new Date();

    const db = getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.userId) },
      { $set: updateData }
    );

    return res.status(200).json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('updateMe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateLocation(req, res) {
  try {
    const { latitude, longitude, address } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }

    const db = getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.userId) },
      {
        $set: {
          location: { latitude, longitude, address: address || '' },
          updated_at: new Date(),
        },
      }
    );

    return res.status(200).json({ message: 'Location updated successfully' });
  } catch (err) {
    console.error('updateLocation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getNearbyUsers(req, res) {
  try {
    const db = getDB();
    const userIDObj = new ObjectId(req.userId);
    const currentUser = await db.collection('users').findOne({ _id: userIDObj });
    if (!currentUser) return res.status(404).json({ error: 'User not found' });

    let radius = 10.0;
    if (req.query.radius) {
      const parsed = parseFloat(req.query.radius);
      if (!isNaN(parsed) && parsed > 0) radius = parsed;
    }

    const professionQ = (req.query.profession || '').trim();
    const filter = { _id: { $ne: userIDObj }, location: { $exists: true } };
    if (professionQ) {
      filter.profession = { $regex: professionQ, $options: 'i' };
    }

    const allUsers = await db.collection('users').find(filter).toArray();
    const nearbyUsers = allUsers.filter((u) => {
      if (!u.location) return false;
      const dist = calculateDistance(
        currentUser.location.latitude, currentUser.location.longitude,
        u.location.latitude, u.location.longitude
      );
      return dist <= radius;
    });

    return res.status(200).json(nearbyUsers);
  } catch (err) {
    console.error('getNearbyUsers error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function checkOnlineStatus(req, res) {
  try {
    const { id } = req.params;
    const isOnline = hub.isUserOnline(id);
    return res.status(200).json({ user_id: id, is_online: isOnline });
  } catch (err) {
    console.error('checkOnlineStatus error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getOnlineUsers(req, res) {
  try {
    const onlineIDs = hub.getOnlineUsers();
    return res.status(200).json({ online_users: onlineIDs });
  } catch (err) {
    console.error('getOnlineUsers error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getMe,
  getUserByID,
  searchByUsername,
  getUserByPhoneNumber,
  getDevices,
  updateMe,
  updateLocation,
  getNearbyUsers,
  checkOnlineStatus,
  getOnlineUsers,
};
