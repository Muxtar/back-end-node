'use strict';

const { ObjectId } = require('mongodb');
const { randomUUID } = require('crypto');
const { getDB } = require('../database');
const { hub } = require('../websocket/hub');

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createGroup(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { group_name, group_icon, member_ids } = req.body || {};

    if (!group_name) return res.status(400).json({ error: 'group_name is required' });

    const members = [userId];
    if (Array.isArray(member_ids)) {
      for (const mid of member_ids) {
        const midStr = mid.toString();
        if (!members.includes(midStr)) members.push(midStr);
      }
    }

    const now = new Date();
    const groupDoc = {
      type: 'group',
      group_name,
      group_icon: group_icon || null,
      members,
      admins: [
        {
          user_id: userId,
          role: 'owner',
          permissions: ['all'],
          granted_at: now,
          granted_by: userId,
        },
      ],
      max_members: 200000,
      statistics: {
        last_calculated: now,
      },
      created_at: now,
      updated_at: now,
    };

    const insertResult = await db.collection('chats').insertOne(groupDoc);
    groupDoc._id = insertResult.insertedId;
    const groupIdStr = insertResult.insertedId.toString();

    // Notify each member EXCEPT the creator so their sidebar shows the new group
    for (const memberId of members) {
      if (memberId !== userId) {
        hub.sendToUser(memberId.toString(), {
          type: 'new_chat',
          chat_id: groupIdStr,
          chat_type: 'group',
          group_name: group_name,
          members,
          created_by: userId,
          message_id: randomUUID(),
          timestamp: now.toISOString(),
        });
      }
    }

    return res.status(201).json({ ...groupDoc, id: groupIdStr });
  } catch (err) {
    console.error('createGroup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getGroups(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;

    const groups = await db.collection('chats').find({
      type: 'group',
      members: userId,
    }).toArray();

    return res.json(groups.map(g => ({ ...g, id: g._id.toString() })));
  } catch (err) {
    console.error('getGroups error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getGroup(req, res) {
  try {
    const db = getDB();
    const groupIdStr = req.params.group_id;

    let groupObjId;
    try {
      groupObjId = new ObjectId(groupIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    const group = await db.collection('chats').findOne({ _id: groupObjId, type: 'group' });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    return res.json({ ...group, id: group._id.toString() });
  } catch (err) {
    console.error('getGroup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateGroup(req, res) {
  try {
    const db = getDB();
    const groupIdStr = req.params.group_id;
    const updates = req.body || {};

    let groupObjId;
    try {
      groupObjId = new ObjectId(groupIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    const setFields = { ...updates, updated_at: new Date() };
    // Remove protected fields
    delete setFields._id;
    delete setFields.type;
    delete setFields.members;
    delete setFields.admins;

    await db.collection('chats').updateOne(
      { _id: groupObjId, type: 'group' },
      { $set: setFields }
    );

    return res.json({ message: 'Group updated' });
  } catch (err) {
    console.error('updateGroup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteGroup(req, res) {
  try {
    const db = getDB();
    const groupIdStr = req.params.group_id;

    let groupObjId;
    try {
      groupObjId = new ObjectId(groupIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    // Fetch group BEFORE deleting so we can notify all members
    const group = await db.collection('chats').findOne({ _id: groupObjId, type: 'group' });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const formerMembers = Array.isArray(group.members) ? [...group.members] : [];

    const deleteResult = await db.collection('chats').deleteOne({
      _id: groupObjId,
      type: 'group',
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Notify ALL former members (including the deleter) so they remove it from their sidebar
    const now = new Date();
    const notifyPayload = {
      type: 'group_deleted',
      chat_id: groupIdStr,
      group_name: group.group_name || null,
      message_id: randomUUID(),
      timestamp: now.toISOString(),
    };
    for (const memberId of formerMembers) {
      hub.sendToUser(memberId.toString(), notifyPayload);
    }

    return res.json({ message: 'Group deleted' });
  } catch (err) {
    console.error('deleteGroup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function addMember(req, res) {
  try {
    const db = getDB();
    const groupIdStr = req.params.group_id;
    const { member_id } = req.body || {};

    if (!member_id) return res.status(400).json({ error: 'member_id is required' });

    let groupObjId;
    try {
      groupObjId = new ObjectId(groupIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    await db.collection('chats').updateOne(
      { _id: groupObjId, type: 'group' },
      {
        $addToSet: { members: member_id.toString() },
        $set: { updated_at: new Date() },
      }
    );

    return res.json({ message: 'Member added' });
  } catch (err) {
    console.error('addMember error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function removeMember(req, res) {
  try {
    const db = getDB();
    const groupIdStr = req.params.group_id;
    const memberIdStr = req.params.member_id;

    let groupObjId;
    try {
      groupObjId = new ObjectId(groupIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    await db.collection('chats').updateOne(
      { _id: groupObjId, type: 'group' },
      {
        $pull: { members: memberIdStr },
        $set: { updated_at: new Date() },
      }
    );

    return res.json({ message: 'Member removed' });
  } catch (err) {
    console.error('removeMember error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getStatistics(req, res) {
  try {
    const db = getDB();
    const groupIdStr = req.params.group_id;

    let groupObjId;
    try {
      groupObjId = new ObjectId(groupIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    const group = await db.collection('chats').findOne({ _id: groupObjId, type: 'group' });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const chatIdStr = groupObjId.toString();
    const now = new Date();

    const messageCount = await db.collection('messages').countDocuments({
      chat_id: chatIdStr,
      is_deleted: { $ne: true },
    });

    const mediaCount = await db.collection('messages').countDocuments({
      chat_id: chatIdStr,
      is_deleted: { $ne: true },
      message_type: { $in: ['image', 'video', 'audio', 'file'] },
    });

    const stats = {
      member_count: Array.isArray(group.members) ? group.members.length : 0,
      message_count: messageCount,
      media_count: mediaCount,
      last_calculated: now,
    };

    await db.collection('chats').updateOne(
      { _id: groupObjId },
      { $set: { statistics: stats, updated_at: now } }
    );

    return res.json(stats);
  } catch (err) {
    console.error('getStatistics error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createGroup,
  getGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  addMember,
  removeMember,
  getStatistics,
};
