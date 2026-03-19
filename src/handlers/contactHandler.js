'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function getContacts(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;

    const contacts = await db.collection('contacts').find({ owner_id: userId }).toArray();

    const result = [];
    for (const contact of contacts) {
      let userInfo = null;
      if (contact.user_id) {
        try {
          const user = await db.collection('users').findOne(
            { _id: new ObjectId(contact.user_id) },
            { projection: { _id: 1, username: 1, phone_number: 1, avatar: 1 } }
          );
          if (user) {
            userInfo = {
              id: user._id.toString(),
              username: user.username,
              phone_number: user.phone_number,
              avatar: user.avatar,
            };
          }
        } catch (_) {
          // ignore
        }
      }

      result.push({
        contact_id: contact._id.toString(),
        user_id: contact.user_id || null,
        display_name: contact.display_name,
        user: userInfo,
        created_at: contact.created_at,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('getContacts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function addContact(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { user_id, phone_number, display_name } = req.body || {};

    const now = new Date();
    let targetUserId = null;
    let resolvedDisplayName = display_name || null;

    if (user_id) {
      // Look up user by ID
      let targetUser;
      try {
        targetUser = await db.collection('users').findOne({ _id: new ObjectId(user_id) });
      } catch (_) {
        return res.status(400).json({ error: 'Invalid user_id' });
      }
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
      targetUserId = targetUser._id.toString();
      if (!resolvedDisplayName) {
        resolvedDisplayName = targetUser.username || targetUser.phone_number;
      }
    } else if (phone_number) {
      // Look up user by phone
      const targetUser = await db.collection('users').findOne({ phone_number });
      if (targetUser) {
        targetUserId = targetUser._id.toString();
        if (!resolvedDisplayName) resolvedDisplayName = targetUser.username || phone_number;
      } else {
        resolvedDisplayName = resolvedDisplayName || phone_number;
      }
    } else {
      return res.status(400).json({ error: 'user_id or phone_number is required' });
    }

    // Create contact for current user
    const contactDoc = {
      owner_id: userId,
      user_id: targetUserId,
      display_name: resolvedDisplayName,
      phone_number: phone_number || null,
      created_at: now,
      updated_at: now,
    };
    const insertResult = await db.collection('contacts').insertOne(contactDoc);
    contactDoc._id = insertResult.insertedId;

    // Create reverse contact (bidirectional) if targetUserId exists and is different
    if (targetUserId && targetUserId !== userId) {
      // Find current user info for reverse display name
      let currentUser;
      try {
        currentUser = await db.collection('users').findOne({ _id: new ObjectId(userId) });
      } catch (_) {}

      const reverseDoc = {
        owner_id: targetUserId,
        user_id: userId,
        display_name: currentUser ? (currentUser.username || currentUser.phone_number) : userId,
        phone_number: currentUser ? currentUser.phone_number : null,
        created_at: now,
        updated_at: now,
      };

      // Only insert reverse if it doesn't already exist
      const existing = await db.collection('contacts').findOne({
        owner_id: targetUserId,
        user_id: userId,
      });
      if (!existing) {
        await db.collection('contacts').insertOne(reverseDoc);
      }
    }

    return res.status(201).json({ ...contactDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('addContact error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function scanQRCode(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { qr_data } = req.body || {};

    if (!qr_data) return res.status(400).json({ error: 'qr_data is required' });

    // Expected format: "CHATAPP:userId:uuid"
    const parts = qr_data.split(':');
    if (parts.length < 2 || parts[0] !== 'CHATAPP') {
      return res.status(400).json({ error: 'Invalid QR code format' });
    }

    const targetUserIdStr = parts[1];

    let targetUser;
    try {
      targetUser = await db.collection('users').findOne({ _id: new ObjectId(targetUserIdStr) });
    } catch (_) {
      return res.status(400).json({ error: 'Invalid user ID in QR code' });
    }

    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser._id.toString() === userId) {
      return res.status(400).json({ error: 'Cannot add yourself as contact' });
    }

    const now = new Date();
    const targetUserId = targetUser._id.toString();

    // Upsert contact
    const existing = await db.collection('contacts').findOne({
      owner_id: userId,
      user_id: targetUserId,
    });

    if (!existing) {
      const contactDoc = {
        owner_id: userId,
        user_id: targetUserId,
        display_name: targetUser.username || targetUser.phone_number || targetUserId,
        phone_number: targetUser.phone_number || null,
        created_at: now,
        updated_at: now,
      };
      await db.collection('contacts').insertOne(contactDoc);
    }

    return res.json({
      user: {
        id: targetUser._id.toString(),
        username: targetUser.username,
        phone_number: targetUser.phone_number,
        avatar: targetUser.avatar,
      },
    });
  } catch (err) {
    console.error('scanQRCode error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteContact(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const contactIdStr = req.params.contact_id;

    let contactObjId;
    try {
      contactObjId = new ObjectId(contactIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid contact ID' });
    }

    const deleteResult = await db.collection('contacts').deleteOne({
      _id: contactObjId,
      owner_id: userId,
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    return res.json({ message: 'Contact deleted' });
  } catch (err) {
    console.error('deleteContact error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getContacts,
  addContact,
  scanQRCode,
  deleteContact,
};
