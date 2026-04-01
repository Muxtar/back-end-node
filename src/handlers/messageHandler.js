'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');
const { hub } = require('../websocket/hub');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function broadcastChatMessageEvent(chat, chatIdStr, senderIdStr, messageIdStr, event, extra) {
  const payload = {
    type: 'message',
    event,
    chat_id: chatIdStr,
    message_id: messageIdStr,
    sender_id: senderIdStr,
    timestamp: new Date().toISOString(),
    ...(extra || {}),
  };

  hub.broadcastToRoom(chatIdStr, payload);

  if (Array.isArray(chat.members)) {
    for (const memberId of chat.members) {
      const memberStr = memberId.toString();
      if (memberStr !== senderIdStr) {
        hub.sendToUser(memberStr, payload);
      }
    }
  }
}

async function getChat(db, chatIdStr) {
  try {
    return await db.collection('chats').findOne({ _id: new ObjectId(chatIdStr) });
  } catch (_) {
    return null;
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function sendMessage(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    // Support chat_id from either route param location
    const chatIdStr = req.params.chat_id || req.params.chatId;

    if (!chatIdStr) {
      return res.status(400).json({ error: 'chat_id is required' });
    }

    let chatObjId;
    try {
      chatObjId = new ObjectId(chatIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid chat ID' });
    }

    const chat = await db.collection('chats').findOne({ _id: chatObjId });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    if (!Array.isArray(chat.members) || !chat.members.includes(userId)) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    // Slow mode check
    if (chat.slow_mode_interval && chat.slow_mode_interval > 0) {
      const lastMsg = await db.collection('messages').findOne(
        { chat_id: chatIdStr, sender_id: userId },
        { sort: { created_at: -1 } }
      );
      if (lastMsg) {
        const elapsed = (Date.now() - new Date(lastMsg.created_at).getTime()) / 1000;
        if (elapsed < chat.slow_mode_interval) {
          return res.status(429).json({ error: 'Slow mode: wait before sending another message' });
        }
      }
    }

    const {
      content,
      message_type,
      file_url,
      thumbnail_url,
      file_name,
      file_size,
      duration,
      is_anonymous,
      is_secret,
      self_destruct_ttl,
      reply_to_id,
      location,
      contact,
      poll,
      mentions,
      formatting,
      link_preview,
      scheduled_for,
      is_draft,
      bot_command,
    } = req.body || {};

    const now = new Date();
    const messageDoc = {
      chat_id: chatIdStr,
      sender_id: userId,
      content: content || '',
      message_type: message_type || 'text',
      file_url: file_url || null,
      thumbnail_url: thumbnail_url || null,
      file_name: file_name || null,
      file_size: file_size || null,
      duration: duration || null,
      is_anonymous: is_anonymous || false,
      is_secret: is_secret || false,
      self_destruct_ttl: self_destruct_ttl || null,
      reply_to_id: reply_to_id || null,
      location: location || null,
      contact: contact || null,
      poll: poll || null,
      mentions: mentions || [],
      formatting: formatting || null,
      link_preview: link_preview || null,
      scheduled_for: scheduled_for || null,
      is_draft: is_draft || false,
      bot_command: bot_command || null,
      reactions: [],
      is_deleted: false,
      deleted_for: [],
      is_edited: false,
      is_pinned: false,
      status: 'sent',
      created_at: now,
      updated_at: now,
    };

    const insertResult = await db.collection('messages').insertOne(messageDoc);
    messageDoc._id = insertResult.insertedId;

    const messageIdStr = insertResult.insertedId.toString();

    // Update chat's last_message_id and updated_at
    await db.collection('chats').updateOne(
      { _id: chatObjId },
      {
        $set: {
          last_message_id: messageIdStr,
          updated_at: now,
        },
        $inc: buildUnreadIncrements(chat.members, userId),
      }
    );

    // Broadcast — include content preview so Sidebar can update without an extra API call
    await broadcastChatMessageEvent(chat, chatIdStr, userId, messageIdStr, 'created', {
      content: messageDoc.content,
      message_type: messageDoc.message_type,
    });

    return res.status(201).json({ ...messageDoc, id: messageIdStr });
  } catch (err) {
    console.error('sendMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function buildUnreadIncrements(members, senderId) {
  const inc = {};
  if (!Array.isArray(members)) return inc;
  for (const memberId of members) {
    const memberStr = memberId.toString();
    if (memberStr !== senderId) {
      inc[`unread_count.${memberStr}`] = 1;
    }
  }
  return inc;
}

async function editMessage(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const messageIdStr = req.params.message_id;
    const { content } = req.body || {};

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const message = await db.collection('messages').findOne({ _id: messageObjId });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: not the sender' });
    }

    const now = new Date();
    await db.collection('messages').updateOne(
      { _id: messageObjId },
      {
        $set: {
          content,
          is_edited: true,
          edited_at: now,
          updated_at: now,
        },
      }
    );

    const chat = await getChat(db, message.chat_id);
    if (chat) {
      await broadcastChatMessageEvent(chat, message.chat_id, userId, messageIdStr, 'updated');
    }

    return res.json({ message: 'Message updated' });
  } catch (err) {
    console.error('editMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteMessage(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const messageIdStr = req.params.message_id;
    const { delete_for_everyone } = req.body || {};

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const message = await db.collection('messages').findOne({ _id: messageObjId });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const now = new Date();

    if (delete_for_everyone && message.sender_id === userId) {
      await db.collection('messages').updateOne(
        { _id: messageObjId },
        { $set: { is_deleted: true, updated_at: now } }
      );

      const chat = await getChat(db, message.chat_id);
      if (chat) {
        await broadcastChatMessageEvent(chat, message.chat_id, userId, messageIdStr, 'deleted');
      }
    } else {
      await db.collection('messages').updateOne(
        { _id: messageObjId },
        { $addToSet: { deleted_for: userId }, $set: { updated_at: now } }
      );
    }

    return res.json({ message: 'Message deleted' });
  } catch (err) {
    console.error('deleteMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function forwardMessage(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const messageIdStr = req.params.message_id;
    const { chat_ids } = req.body || {};

    if (!Array.isArray(chat_ids) || chat_ids.length === 0) {
      return res.status(400).json({ error: 'chat_ids array is required' });
    }

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const originalMessage = await db.collection('messages').findOne({ _id: messageObjId });
    if (!originalMessage) return res.status(404).json({ error: 'Message not found' });

    const now = new Date();
    const insertedMessages = [];

    for (const chatIdStr of chat_ids) {
      let chatObjId;
      try {
        chatObjId = new ObjectId(chatIdStr);
      } catch (_) {
        continue;
      }

      const chat = await db.collection('chats').findOne({ _id: chatObjId });
      if (!chat) continue;
      if (!Array.isArray(chat.members) || !chat.members.includes(userId)) continue;

      const forwardedDoc = {
        chat_id: chatIdStr,
        sender_id: userId,
        content: originalMessage.content,
        message_type: originalMessage.message_type,
        file_url: originalMessage.file_url || null,
        file_name: originalMessage.file_name || null,
        file_size: originalMessage.file_size || null,
        thumbnail_url: originalMessage.thumbnail_url || null,
        duration: originalMessage.duration || null,
        forwarded_from: originalMessage._id,
        forwarded_from_chat: originalMessage.chat_id,
        reactions: [],
        is_deleted: false,
        deleted_for: [],
        is_edited: false,
        is_pinned: false,
        status: 'sent',
        created_at: now,
        updated_at: now,
      };

      const insertResult = await db.collection('messages').insertOne(forwardedDoc);
      forwardedDoc._id = insertResult.insertedId;

      await db.collection('chats').updateOne(
        { _id: chatObjId },
        { $set: { last_message_id: insertResult.insertedId.toString(), updated_at: now } }
      );

      await broadcastChatMessageEvent(
        chat,
        chatIdStr,
        userId,
        insertResult.insertedId.toString(),
        'created'
      );

      insertedMessages.push({ ...forwardedDoc, id: insertResult.insertedId.toString() });
    }

    return res.json(insertedMessages);
  } catch (err) {
    console.error('forwardMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function addReaction(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const messageIdStr = req.params.message_id;
    const { emoji } = req.body || {};

    if (!emoji) return res.status(400).json({ error: 'emoji is required' });

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const message = await db.collection('messages').findOne({ _id: messageObjId });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const now = new Date();

    // Remove existing user reaction, then add new
    await db.collection('messages').updateOne(
      { _id: messageObjId },
      {
        $pull: { reactions: { user_id: userId } },
      }
    );

    await db.collection('messages').updateOne(
      { _id: messageObjId },
      {
        $push: { reactions: { user_id: userId, emoji, created_at: now } },
        $set: { updated_at: now },
      }
    );

    const chat = await getChat(db, message.chat_id);
    if (chat) {
      await broadcastChatMessageEvent(chat, message.chat_id, userId, messageIdStr, 'updated');
    }

    return res.json({ message: 'Reaction added' });
  } catch (err) {
    console.error('addReaction error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function removeReaction(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const messageIdStr = req.params.message_id;

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const message = await db.collection('messages').findOne({ _id: messageObjId });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const now = new Date();

    await db.collection('messages').updateOne(
      { _id: messageObjId },
      {
        $pull: { reactions: { user_id: userId } },
        $set: { updated_at: now },
      }
    );

    const chat = await getChat(db, message.chat_id);
    if (chat) {
      await broadcastChatMessageEvent(chat, message.chat_id, userId, messageIdStr, 'updated');
    }

    return res.json({ message: 'Reaction removed' });
  } catch (err) {
    console.error('removeReaction error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function markAsRead(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { chat_id, message_ids } = req.body || {};

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

    const now = new Date();

    if (Array.isArray(message_ids) && message_ids.length > 0) {
      const msgObjIds = message_ids.map(id => {
        try { return new ObjectId(id); } catch (_) { return null; }
      }).filter(Boolean);

      await db.collection('messages').updateMany(
        { _id: { $in: msgObjIds }, chat_id: chat_id.toString() },
        { $set: { status: 'read', updated_at: now } }
      );
    } else {
      await db.collection('messages').updateMany(
        { chat_id: chat_id.toString(), sender_id: { $ne: userId }, status: { $ne: 'read' } },
        { $set: { status: 'read', updated_at: now } }
      );
    }

    // Reset unread count for this user
    await db.collection('chats').updateOne(
      { _id: chatObjId },
      { $set: { [`unread_count.${userId}`]: 0 } }
    );

    // Broadcast read event
    const payload = {
      type: 'message_read',
      event: 'message_read',
      chat_id: chat_id.toString(),
      reader_id: userId,
      timestamp: now.toISOString(),
    };
    hub.broadcastToRoom(chat_id.toString(), payload);

    return res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error('markAsRead error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function pinMessage(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const messageIdStr = req.params.message_id;
    const chatIdStr = req.body.chat_id || req.query.chat_id;

    if (!chatIdStr) return res.status(400).json({ error: 'chat_id is required' });

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    let chatObjId;
    try {
      chatObjId = new ObjectId(chatIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid chat_id' });
    }

    // For group/channel chats, verify user is admin
    const chat = await db.collection('chats').findOne({ _id: chatObjId });
    if (chat && (chat.type === 'group' || chat.type === 'channel')) {
      const admins = Array.isArray(chat.admins) ? chat.admins : [];
      const isAdmin = admins.some(a => (a.user_id || a.userId || '').toString() === userId);
      if (!isAdmin) return res.status(403).json({ error: 'Only admins can pin messages' });
    }

    const now = new Date();

    await db.collection('messages').updateOne(
      { _id: messageObjId },
      { $set: { is_pinned: true, pinned_at: now, updated_at: now } }
    );

    await db.collection('chats').updateOne(
      { _id: chatObjId },
      {
        $addToSet: { pinned_messages: messageIdStr },
        $set: { updated_at: now },
      }
    );

    return res.json({ message: 'Message pinned' });
  } catch (err) {
    console.error('pinMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function unpinMessage(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const messageIdStr = req.params.message_id;
    const chatIdStr = req.body.chat_id || req.query.chat_id;

    if (!chatIdStr) return res.status(400).json({ error: 'chat_id is required' });

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    let chatObjId;
    try {
      chatObjId = new ObjectId(chatIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid chat_id' });
    }

    const now = new Date();

    await db.collection('messages').updateOne(
      { _id: messageObjId },
      { $set: { is_pinned: false, updated_at: now }, $unset: { pinned_at: '' } }
    );

    await db.collection('chats').updateOne(
      { _id: chatObjId },
      {
        $pull: { pinned_messages: messageIdStr },
        $set: { updated_at: now },
      }
    );

    return res.json({ message: 'Message unpinned' });
  } catch (err) {
    console.error('unpinMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function votePoll(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const messageIdStr = req.params.message_id;
    const { option_id } = req.body || {};

    if (!option_id) return res.status(400).json({ error: 'option_id is required' });

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const message = await db.collection('messages').findOne({ _id: messageObjId });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (!message.poll) return res.status(400).json({ error: 'Message has no poll' });

    const now = new Date();

    // Remove user vote from all options
    const poll = message.poll;
    if (Array.isArray(poll.options)) {
      for (const option of poll.options) {
        if (Array.isArray(option.votes)) {
          option.votes = option.votes.filter(v => v.toString() !== userId);
        }
      }
      // Add vote to selected option
      const targetOption = poll.options.find(o => o.id === option_id || o._id?.toString() === option_id);
      if (targetOption) {
        if (!Array.isArray(targetOption.votes)) targetOption.votes = [];
        targetOption.votes.push(userId);
      }
    }

    await db.collection('messages').updateOne(
      { _id: messageObjId },
      { $set: { poll, updated_at: now } }
    );

    const chat = await getChat(db, message.chat_id);
    if (chat) {
      await broadcastChatMessageEvent(chat, message.chat_id, userId, messageIdStr, 'updated');
    }

    return res.json({ message: 'Vote recorded', poll });
  } catch (err) {
    console.error('votePoll error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function searchMessages(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { q, chat_id } = req.query;

    if (!q) return res.status(400).json({ error: 'q query param is required' });

    const filter = {
      is_deleted: { $ne: true },
      deleted_for: { $nin: [userId] },
      $or: [
        { content: { $regex: q, $options: 'i' } },
        { file_name: { $regex: q, $options: 'i' } },
      ],
    };

    if (chat_id) {
      filter.chat_id = chat_id;
    }

    const messages = await db
      .collection('messages')
      .find(filter)
      .sort({ created_at: -1 })
      .limit(50)
      .toArray();

    return res.json(messages.map(m => ({ ...m, id: m._id.toString() })));
  } catch (err) {
    console.error('searchMessages error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function translateMessage(req, res) {
  try {
    const db = getDB();
    const messageIdStr = req.params.message_id;
    const lang = req.query.lang || 'en';

    let messageObjId;
    try {
      messageObjId = new ObjectId(messageIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const message = await db.collection('messages').findOne({ _id: messageObjId });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const translatedText = `[Translation to ${lang}: ${message.content}]`;

    await db.collection('messages').updateOne(
      { _id: messageObjId },
      {
        $set: {
          translated_text: translatedText,
          translated_to: lang,
          updated_at: new Date(),
        },
      }
    );

    return res.json({ translated_text: translatedText, language: lang });
  } catch (err) {
    console.error('translateMessage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  sendMessage,
  editMessage,
  deleteMessage,
  forwardMessage,
  addReaction,
  removeReaction,
  markAsRead,
  pinMessage,
  unpinMessage,
  votePoll,
  searchMessages,
  translateMessage,
};
