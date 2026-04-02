'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createProposal(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { receiver_id, message, is_anonymous } = req.body || {};

    if (!receiver_id) return res.status(400).json({ error: 'receiver_id is required' });
    if (receiver_id === userId) return res.status(400).json({ error: 'Cannot send proposal to yourself' });

    // Verify receiver exists
    let receiverObjId;
    try { receiverObjId = new ObjectId(receiver_id); } catch (_) {
      return res.status(400).json({ error: 'Invalid receiver_id' });
    }
    const receiver = await db.collection('users').findOne({ _id: receiverObjId });
    if (!receiver) return res.status(404).json({ error: 'Receiver user not found' });

    const now = new Date();
    const proposalDoc = {
      sender_id: userId,
      receiver_id: receiver_id.toString(),
      message: message || '',
      is_anonymous: is_anonymous || false,
      status: 'pending',
      created_at: now,
      updated_at: now,
    };

    const insertResult = await db.collection('proposals').insertOne(proposalDoc);
    proposalDoc._id = insertResult.insertedId;

    return res.status(201).json({ ...proposalDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('createProposal error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getProposals(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;

    const proposals = await db.collection('proposals').find({
      $or: [{ receiver_id: userId }, { sender_id: userId }],
    }).sort({ created_at: -1 }).toArray();

    return res.json(proposals.map(p => ({ ...p, id: p._id.toString() })));
  } catch (err) {
    console.error('getProposals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function acceptProposal(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const proposalIdStr = req.params.proposal_id;

    let proposalObjId;
    try {
      proposalObjId = new ObjectId(proposalIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    const proposal = await db.collection('proposals').findOne({ _id: proposalObjId });
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

    if (proposal.receiver_id !== userId) {
      return res.status(403).json({ error: 'Only the receiver can accept this proposal' });
    }

    const now = new Date();
    await db.collection('proposals').updateOne(
      { _id: proposalObjId },
      { $set: { status: 'accepted', updated_at: now } }
    );

    // Create direct chat between sender and receiver
    const members = [proposal.sender_id, proposal.receiver_id];
    const chatDoc = {
      type: 'direct',
      members,
      created_at: now,
      updated_at: now,
    };

    if (proposal.is_anonymous) {
      chatDoc.anonymous_from_user_id = proposal.sender_id;
    }

    const chatInsert = await db.collection('chats').insertOne(chatDoc);
    const chatIdStr = chatInsert.insertedId.toString();

    return res.json({
      message: 'Proposal accepted',
      chat_id: chatIdStr,
    });
  } catch (err) {
    console.error('acceptProposal error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function rejectProposal(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const proposalIdStr = req.params.proposal_id;

    let proposalObjId;
    try {
      proposalObjId = new ObjectId(proposalIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    const proposal = await db.collection('proposals').findOne({ _id: proposalObjId });
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

    if (proposal.receiver_id !== userId) {
      return res.status(403).json({ error: 'Only the receiver can reject this proposal' });
    }

    await db.collection('proposals').updateOne(
      { _id: proposalObjId },
      { $set: { status: 'rejected', updated_at: new Date() } }
    );

    return res.json({ message: 'Proposal rejected' });
  } catch (err) {
    console.error('rejectProposal error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteProposal(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const proposalIdStr = req.params.proposal_id;

    let proposalObjId;
    try {
      proposalObjId = new ObjectId(proposalIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    const deleteResult = await db.collection('proposals').deleteOne({
      _id: proposalObjId,
      sender_id: userId,
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: 'Proposal not found or not owned by you' });
    }

    return res.json({ message: 'Proposal deleted' });
  } catch (err) {
    console.error('deleteProposal error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createProposal,
  getProposals,
  acceptProposal,
  rejectProposal,
  deleteProposal,
};
