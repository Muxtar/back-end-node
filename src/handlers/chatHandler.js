'use strict';

const { ObjectId } = require('mongodb');
const { randomUUID } = require('crypto');
const { getDB } = require('../database');
const { hub } = require('../websocket/hub');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maskAnonymousSender(message, chatAnonymousFromUserId, userId) {
  if (!chatAnonymousFromUserId) return message;
  // The anonymous user is the one who set anonymous_from_user_id.
  // For the OTHER party (not the sender), mask sender info.
  const senderId = message.sender_id ? message.sender_id.toString() : null;
  const anonFromId = chatAnonymousFromUserId.toString();
  // If the sender is the anonymous user and the viewer is not the sender, mask
  if (senderId === anonFromId && userId !== anonFromId) {
    return { ...message, sender_id: null, is_anonymous: true };
  }
  return message;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function getChats(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;

    const chats = await db.collection('chats').find({
      members: userId,
    }).toArray();

    const result = [];

    for (const chat of chats) {
      const chatObj = {
        id: chat._id.toString(),
        type: chat.type,
        members: chat.members,
        group_name: chat.group_name,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
      };

      // Anonymous flag for direct chats
      if (
        chat.type === 'direct' &&
        chat.anonymous_from_user_id &&
        Array.isArray(chat.members) &&
        chat.members.length === 2
      ) {
        chatObj.other_party_anonymous = chat.anonymous_from_user_id.toString() !== userId;
      }

      // Last message
      if (chat.last_message_id) {
        try {
          const lastMsg = await db.collection('messages').findOne({
            _id: new ObjectId(chat.last_message_id),
            is_deleted: { $ne: true },
            deleted_for: { $nin: [userId] },
          });

          if (lastMsg) {
            let msgObj = {
              id: lastMsg._id.toString(),
              content: lastMsg.content,
              message_type: lastMsg.message_type,
              sender_id: lastMsg.sender_id,
              is_anonymous: lastMsg.is_anonymous || false,
              status: lastMsg.status,
              created_at: lastMsg.created_at,
            };

            // Mask anonymous sender
            if (chat.anonymous_from_user_id) {
              const senderId = lastMsg.sender_id ? lastMsg.sender_id.toString() : null;
              const anonFromId = chat.anonymous_from_user_id.toString();
              if (senderId === anonFromId && userId !== anonFromId) {
                msgObj.sender_id = null;
                msgObj.is_anonymous = true;
              }
            }

            chatObj.last_message = msgObj;
          }
        } catch (_) {
          // ignore invalid last_message_id
        }
      }

      // Unread count
      if (chat.unread_count && chat.unread_count[userId] !== undefined) {
        chatObj.unread_count = chat.unread_count[userId];
      }

      result.push(chatObj);
    }

    return res.json(result);
  } catch (err) {
    console.error('getChats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createChat(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { type, member_ids, group_name, is_anonymous } = req.body;

    const members = [userId];
    if (Array.isArray(member_ids)) {
      for (const mid of member_ids) {
        if (!members.includes(mid)) members.push(mid);
      }
    }

    const now = new Date();
    const chatDoc = {
      type: type || 'direct',
      members,
      group_name: group_name || null,
      created_at: now,
      updated_at: now,
    };

    if (is_anonymous && (type === 'direct' || !type)) {
      chatDoc.anonymous_from_user_id = userId;
    }

    const insertResult = await db.collection('chats').insertOne(chatDoc);
    chatDoc._id = insertResult.insertedId;
    const chatIdStr = insertResult.insertedId.toString();
    const now2 = chatDoc.created_at;

    // Notify every member EXCEPT the creator so their sidebar updates in real-time
    for (const memberId of members) {
      if (memberId !== userId) {
        hub.sendToUser(memberId.toString(), {
          type: 'new_chat',
          chat_id: chatIdStr,
          chat_type: chatDoc.type,
          group_name: chatDoc.group_name || null,
          members,
          created_by: userId,
          message_id: randomUUID(),
          timestamp: now2.toISOString(),
        });
      }
    }

    return res.status(201).json(chatDoc);
  } catch (err) {
    console.error('createChat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getChat(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const chatIdStr = req.params.chat_id;

    let chatObjId;
    try {
      chatObjId = new ObjectId(chatIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid chat ID' });
    }

    const chat = await db.collection('chats').findOne({ _id: chatObjId });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const chatObj = {
      id: chat._id.toString(),
      type: chat.type,
      members: chat.members,
      group_name: chat.group_name,
      created_at: chat.created_at,
      updated_at: chat.updated_at,
    };

    if (
      chat.type === 'direct' &&
      chat.anonymous_from_user_id &&
      Array.isArray(chat.members) &&
      chat.members.length === 2
    ) {
      chatObj.other_party_anonymous = chat.anonymous_from_user_id.toString() !== userId;
    }

    return res.json(chatObj);
  } catch (err) {
    console.error('getChat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMessages(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const chatIdStr = req.params.chat_id;

    let chatObjId;
    try {
      chatObjId = new ObjectId(chatIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid chat ID' });
    }

    // Verify chat exists and user is member
    const chat = await db.collection('chats').findOne({ _id: chatObjId });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // Check membership
    const isMember = Array.isArray(chat.members) && chat.members.some(m => m.toString() === userId);
    if (!isMember) return res.status(403).json({ error: 'Not a member of this chat' });

    const messages = await db.collection('messages').find({
      chat_id: chatIdStr,
      is_deleted: { $ne: true },
      deleted_for: { $nin: [userId] },
    }).sort({ created_at: 1 }).toArray();

    const result = [];

    for (const msg of messages) {
      let msgObj = {
        id: msg._id.toString(),
        chat_id: msg.chat_id,
        content: msg.content,
        message_type: msg.message_type,
        sender_id: msg.sender_id,
        is_anonymous: msg.is_anonymous || false,
        status: msg.status,
        created_at: msg.created_at,
        updated_at: msg.updated_at,
        is_edited: msg.is_edited || false,
        reactions: msg.reactions || [],
        file_url: msg.file_url,
        file_name: msg.file_name,
        file_size: msg.file_size,
        thumbnail_url: msg.thumbnail_url,
        duration: msg.duration,
        is_pinned: msg.is_pinned || false,
      };

      // Mask anonymous sender
      if (chat.anonymous_from_user_id) {
        const senderId = msg.sender_id ? msg.sender_id.toString() : null;
        const anonFromId = chat.anonymous_from_user_id.toString();
        if (senderId === anonFromId && userId !== anonFromId) {
          msgObj.sender_id = null;
          msgObj.is_anonymous = true;
        }
      }

      // Populate reply_to
      if (msg.reply_to_id) {
        try {
          const replyMsg = await db.collection('messages').findOne({
            _id: new ObjectId(msg.reply_to_id),
          });
          if (replyMsg) {
            msgObj.reply_to = {
              id: replyMsg._id.toString(),
              content: replyMsg.content,
              message_type: replyMsg.message_type,
              sender_id: replyMsg.sender_id,
            };
          }
        } catch (_) {
          // ignore
        }
      }

      result.push(msgObj);
    }

    return res.json(result);
  } catch (err) {
    console.error('getMessages error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function sendMessage(req, res) {
  // Delegate to messageHandler to avoid code duplication
  // Override the chat_id param to come from req.params.chat_id
  const messageHandler = require('./messageHandler');
  return messageHandler.sendMessage(req, res);
}

async function deleteMessage(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const messageIdStr = req.params.message_id;
    const { delete_for_everyone } = req.body;

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const message = await db.collection('messages').findOne({ _id: messageObjId });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (delete_for_everyone) {
      await db.collection('messages').updateOne(
        { _id: messageObjId },
        { $set: { is_deleted: true, updated_at: new Date() } }
      );
    } else {
      await db.collection('messages').updateOne(
        { _id: messageObjId },
        { $addToSet: { deleted_for: userId }, $set: { updated_at: new Date() } }
      );
    }

    return res.json({ message: 'Message deleted' });
  } catch (err) {
    console.error('deleteMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteChat(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const chatIdStr = req.params.chat_id;

    let chatObjId;
    try {
      chatObjId = new ObjectId(chatIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid chat ID' });
    }

    const chat = await db.collection('chats').findOne({ _id: chatObjId });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    if (!Array.isArray(chat.members) || !chat.members.some(m => m.toString() === userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date();

    // Pull userId from members
    await db.collection('chats').updateOne(
      { _id: chatObjId },
      { $pull: { members: userId }, $set: { updated_at: now } }
    );

    // Notify remaining members so their sidebar removes/updates this chat
    const remaining = chat.members.filter(m => m.toString() !== userId);
    for (const memberId of remaining) {
      hub.sendToUser(memberId.toString(), {
        type: 'chat_updated',
        chat_id: chatIdStr,
        event: 'member_left',
        left_user_id: userId,
        message_id: randomUUID(),
        timestamp: now.toISOString(),
      });
    }

    return res.json({ message: 'Left chat' });
  } catch (err) {
    console.error('deleteChat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getChats,
  createChat,
  getChat,
  getMessages,
  sendMessage,
  deleteMessage,
  deleteChat,
};
