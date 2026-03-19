'use strict';

const WebSocket = require('ws');
const { validateToken } = require('../utils/jwt');
const { hub } = require('./hub');

/**
 * HandleWebSocket — mirrors Go's websocket/websocket.go
 *
 * Attaches to an Express server upgrade event.
 * Handles:
 *  - Token validation from query param ?token=...
 *  - ping/pong keepalive (every 49 seconds, Railway keepalive)
 *  - join_chat / leave_chat room management
 *  - webrtc_offer / webrtc_answer / webrtc_ice relay
 */
function setupWebSocket(server) {
  const wss = new WebSocket.Server({ noServer: true });

  // Handle HTTP → WebSocket upgrade
  server.on('upgrade', (req, socket, head) => {
    // Extract token from query string
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

    ws.on('message', (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch (e) {
        return; // ignore malformed messages
      }

      const { type, payload } = msg || {};

      switch (type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'join_chat': {
          const roomId = payload && payload.chat_id;
          if (roomId) {
            hub.joinRoom(clientId, roomId);
          }
          break;
        }

        case 'leave_chat': {
          const roomId = payload && payload.chat_id;
          if (roomId) {
            hub.leaveRoom(clientId, roomId);
          }
          break;
        }

        case 'webrtc_offer': {
          // Relay offer to target user
          const targetUserId = payload && payload.target_user_id;
          if (targetUserId) {
            hub.sendToUser(targetUserId, {
              type: 'webrtc_offer',
              payload: {
                ...payload,
                sender_id: userId,
              },
            });
          }
          break;
        }

        case 'webrtc_answer': {
          const targetUserId = payload && payload.target_user_id;
          if (targetUserId) {
            hub.sendToUser(targetUserId, {
              type: 'webrtc_answer',
              payload: {
                ...payload,
                sender_id: userId,
              },
            });
          }
          break;
        }

        case 'webrtc_ice': {
          const targetUserId = payload && payload.target_user_id;
          if (targetUserId) {
            hub.sendToUser(targetUserId, {
              type: 'webrtc_ice',
              payload: {
                ...payload,
                sender_id: userId,
              },
            });
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
