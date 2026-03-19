'use strict';

const { ObjectId } = require('mongodb');
const { randomUUID } = require('crypto');
const { getDB } = require('../database');
const { hub } = require('../websocket/hub');

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function initiateCall(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { type, chat_id, members: memberIds } = req.body || {};

    if (!chat_id) return res.status(400).json({ error: 'chat_id is required' });

    let chatObjId;
    try {
      chatObjId = new ObjectId(chat_id);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid chat_id' });
    }

    const chat = await db.collection('chats').findOne({ _id: chatObjId });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    if (!Array.isArray(chat.members) || !chat.members.includes(userId)) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    // Build members set: caller + provided members + chat members
    const membersSet = new Set([userId]);
    if (Array.isArray(memberIds)) {
      for (const m of memberIds) membersSet.add(m.toString());
    }
    // Include all chat members
    for (const m of chat.members) membersSet.add(m.toString());

    const now = new Date();
    const callDoc = {
      type: type || 'voice',
      caller_id: userId,
      chat_id: chat_id.toString(),
      members: Array.from(membersSet),
      status: 'ringing',
      started_at: now,
      created_at: now,
      updated_at: now,
    };

    const insertResult = await db.collection('calls').insertOne(callDoc);
    callDoc._id = insertResult.insertedId;
    const callIdStr = insertResult.insertedId.toString();

    // Notify each member (except caller)
    for (const memberId of callDoc.members) {
      if (memberId !== userId) {
        hub.sendToUser(memberId, {
          type: 'call',
          call_id: callIdStr,
          chat_id: chat_id.toString(),
          call_type: callDoc.type,
          caller_id: userId,
          status: 'ringing',
          message_id: randomUUID(),
          timestamp: now.toISOString(),
          sender_id: userId,
        });
      }
    }

    return res.status(201).json({ ...callDoc, id: callIdStr });
  } catch (err) {
    console.error('initiateCall error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function answerCall(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const callIdStr = req.params.call_id;

    let callObjId;
    try {
      callObjId = new ObjectId(callIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid call ID' });
    }

    const call = await db.collection('calls').findOne({ _id: callObjId });
    if (!call) return res.status(404).json({ error: 'Call not found' });

    if (!Array.isArray(call.members) || !call.members.includes(userId)) {
      return res.status(403).json({ error: 'Not a member of this call' });
    }

    const now = new Date();
    await db.collection('calls').updateOne(
      { _id: callObjId },
      {
        $set: {
          status: 'active',
          answered_at: now,
          answered_by: userId,
          updated_at: now,
        },
      }
    );

    hub.sendToUser(call.caller_id, {
      type: 'call_answered',
      call_id: callIdStr,
      chat_id: call.chat_id,
      call_type: call.type,
      status: 'active',
      caller_id: call.caller_id,
      answered_by: userId,
      answered_at: now.toISOString(),
      message_id: randomUUID(),
      timestamp: now.toISOString(),
      sender_id: userId,
    });

    return res.json({ message: 'Call answered', call_id: callIdStr });
  } catch (err) {
    console.error('answerCall error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function endCall(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const callIdStr = req.params.call_id;

    let callObjId;
    try {
      callObjId = new ObjectId(callIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid call ID' });
    }

    const call = await db.collection('calls').findOne({ _id: callObjId });
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const now = new Date();
    await db.collection('calls').updateOne(
      { _id: callObjId },
      {
        $set: {
          status: 'ended',
          ended_at: now,
          updated_at: now,
        },
      }
    );

    const payload = {
      type: 'call_ended',
      call_id: callIdStr,
      chat_id: call.chat_id,
      call_type: call.type,
      status: 'ended',
      message_id: randomUUID(),
      timestamp: now.toISOString(),
    };

    if (Array.isArray(call.members)) {
      for (const memberId of call.members) {
        hub.sendToUser(memberId.toString(), payload);
      }
    }

    return res.json({ message: 'Call ended', call_id: callIdStr });
  } catch (err) {
    console.error('endCall error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function startCallTimeoutChecker() {
  setInterval(async () => {
    try {
      const db = getDB();
      const cutoff = new Date(Date.now() - 60 * 1000); // 60 seconds ago

      const timedOutCalls = await db.collection('calls').find({
        status: 'ringing',
        started_at: { $lt: cutoff },
      }).toArray();

      if (timedOutCalls.length === 0) return;

      const ids = timedOutCalls.map(c => c._id);
      const now = new Date();

      await db.collection('calls').updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'ended', ended_at: now, updated_at: now } }
      );

      for (const call of timedOutCalls) {
        const callIdStr = call._id.toString();
        const payload = {
          type: 'call_ended',
          call_id: callIdStr,
          chat_id: call.chat_id,
          call_type: call.type,
          status: 'ended',
          reason: 'timeout',
          message_id: randomUUID(),
          timestamp: now.toISOString(),
        };

        if (Array.isArray(call.members)) {
          for (const memberId of call.members) {
            hub.sendToUser(memberId.toString(), payload);
          }
        }
      }

      console.log(`Call timeout checker: ended ${timedOutCalls.length} ringing call(s)`);
    } catch (err) {
      console.error('startCallTimeoutChecker error:', err);
    }
  }, 30 * 1000); // every 30 seconds
}

module.exports = {
  initiateCall,
  answerCall,
  endCall,
  startCallTimeoutChecker,
};
