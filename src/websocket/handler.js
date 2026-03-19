'use strict';

const WebSocket = require('ws');
const { ObjectId } = require('mongodb');
const { validateToken } = require('../utils/jwt');
const { hub } = require('./hub');
const { getDB } = require('../database');

/**
 * HandleWebSocket — mirrors Go's websocket/websocket.go
 *
 * IMPORTANT: The frontend sends ALL WebSocket messages with fields at ROOT level
 * (no nested "payload" wrapper). Example:
 *   { type: 'webrtc_offer', chat_id: '...', call_id: '...', offer: '...' }
 *
 * For WebRTC relay messages the frontend does NOT include target_user_id —
 * we look up the call document in MongoDB (by call_id) to find the other member(s).
 *
 * Handles:
 *  - Token validation from query param ?token=...
 *  - ping/pong keepalive (every 49 seconds, Railway keepalive)
 *  - join_chat / leave_chat room management
 *  - webrtc_offer / webrtc_answer / webrtc_ice relay (with DB lookup)
 */
function setupWebSocket(server) {
  const wss = new WebSocket.Server({ noServer: true });

  // Handle HTTP → WebSocket upgrade
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const { userId, error } = validateToken(token);
    if (error || !userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, userId);
    });
  });

  wss.on('connection', (ws, req, userId) => {
    const clientId = hub.register(ws, userId);

    console.log(`🔌 WebSocket connected: userId=${userId}, clientId=${clientId}`);

    // Keepalive ping every 49 seconds (Railway keepalive)
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 49000);

    ws.on('pong', () => {
      // Connection is alive
    });

    ws.on('message', async (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch (e) {
        return; // ignore malformed messages
      }

      // Frontend sends messages with fields at ROOT level — no payload wrapper.
      // e.g. { type: 'join_chat', chat_id: '...' }
      //      { type: 'webrtc_offer', call_id: '...', chat_id: '...', offer: '...' }
      const type = msg?.type;

      switch (type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'join_chat': {
          // Frontend: { type: 'join_chat', chat_id: '...' }
          const roomId = msg.chat_id;
          if (roomId) {
            hub.joinRoom(clientId, roomId);
            console.log(`📌 User ${userId} joined room ${roomId}`);
          }
          break;
        }

        case 'leave_chat': {
          // Frontend: { type: 'leave_chat', chat_id: '...' }
          const roomId = msg.chat_id;
          if (roomId) {
            hub.leaveRoom(clientId, roomId);
            console.log(`📌 User ${userId} left room ${roomId}`);
          }
          break;
        }

        case 'webrtc_offer':
        case 'webrtc_answer':
        case 'webrtc_ice': {
          // Frontend sends: { type, chat_id, call_id, offer|answer|candidate, message_id, sender_id, timestamp }
          // No target_user_id — look up call members from DB to find the other party.
          const callId = msg.call_id;
          if (!callId) {
            console.warn(`⚠️ ${type} received without call_id from userId=${userId}`);
            break;
          }

          try {
            const db = getDB();
            const call = await db.collection('calls').findOne({ _id: new ObjectId(callId) });
            if (!call) {
              console.warn(`⚠️ ${type} relay: call ${callId} not found`);
              break;
            }

            if (!Array.isArray(call.members)) {
              console.warn(`⚠️ ${type} relay: call ${callId} has no members`);
              break;
            }

            // Build flat relay payload (fields at root level, matching frontend expectations)
            const relayPayload = {
              type,
              chat_id: msg.chat_id || call.chat_id,
              call_id: callId,
              sender_id: userId,
              message_id: msg.message_id || null,
              timestamp: msg.timestamp || Date.now(),
            };

            if (type === 'webrtc_offer')  relayPayload.offer      = msg.offer;
            if (type === 'webrtc_answer') relayPayload.answer     = msg.answer;
            if (type === 'webrtc_ice')    relayPayload.candidate  = msg.candidate;

            // Relay to all call members except the sender
            let relayCount = 0;
            for (const memberId of call.members) {
              if (memberId.toString() !== userId.toString()) {
                hub.sendToUser(memberId.toString(), relayPayload);
                relayCount++;
              }
            }

            console.log(`📡 Relayed ${type} from ${userId} to ${relayCount} member(s) (call_id=${callId})`);
          } catch (e) {
            console.error(`❌ ${type} relay error (call_id=${callId}):`, e.message);
          }
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      hub.unregister(clientId);
      console.log(`🔌 WebSocket disconnected: userId=${userId}, clientId=${clientId}`);
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error for clientId=${clientId}:`, err.message);
      clearInterval(pingInterval);
      hub.unregister(clientId);
    });
  });

  return wss;
}

module.exports = { setupWebSocket };
