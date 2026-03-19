'use strict';

/**
 * WebSocket Hub — mirrors Go's websocket/hub.go
 *
 * Manages:
 *  - clients map: clientId -> { ws, userId }
 *  - rooms map: roomId -> Set<clientId>
 *  - onlineUsers map: userId (string) -> Set<clientId>
 */
class Hub {
  constructor() {
    // clientId -> { ws, userId (string) }
    this.clients = new Map();
    // roomId (string) -> Set of clientIds
    this.rooms = new Map();
    // userId (string) -> Set of clientIds
    this.onlineUsers = new Map();

    this._nextId = 1;
  }

  /** Register a new WebSocket client. Returns clientId. */
  register(ws, userId) {
    const clientId = String(this._nextId++);
    this.clients.set(clientId, { ws, userId });

    // Track online status
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId).add(clientId);

    return clientId;
  }

  /** Unregister a client from hub, rooms, and online tracking. */
  unregister(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from all rooms
    for (const [roomId, members] of this.rooms) {
      members.delete(clientId);
      if (members.size === 0) {
        this.rooms.delete(roomId);
      }
    }

    // Remove from online tracking
    const { userId } = client;
    if (this.onlineUsers.has(userId)) {
      this.onlineUsers.get(userId).delete(clientId);
      if (this.onlineUsers.get(userId).size === 0) {
        this.onlineUsers.delete(userId);
      }
    }

    this.clients.delete(clientId);
  }

  /** Join a room (chat). */
  joinRoom(clientId, roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId).add(clientId);
  }

  /** Leave a room. */
  leaveRoom(clientId, roomId) {
    if (this.rooms.has(roomId)) {
      this.rooms.get(roomId).delete(clientId);
      if (this.rooms.get(roomId).size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  /** Send JSON payload to all clients in a room. */
  broadcastToRoom(roomId, payload) {
    const data = JSON.stringify(payload);
    const members = this.rooms.get(roomId);
    if (!members) return;
    for (const clientId of members) {
      this._sendRaw(clientId, data);
    }
  }

  /** Send JSON payload to all clients in a room except the sender. */
  broadcastToRoomExcluding(roomId, excludeClientId, payload) {
    const data = JSON.stringify(payload);
    const members = this.rooms.get(roomId);
    if (!members) return;
    for (const clientId of members) {
      if (clientId === excludeClientId) continue;
      this._sendRaw(clientId, data);
    }
  }

  /** Send JSON payload directly to all connections of a user by userId. */
  sendToUser(userId, payload) {
    const data = JSON.stringify(payload);
    const clientIds = this.onlineUsers.get(userId);
    if (!clientIds) return;
    for (const clientId of clientIds) {
      this._sendRaw(clientId, data);
    }
  }

  /** Check if a user has at least one active connection. */
  isUserOnline(userId) {
    return this.onlineUsers.has(userId) && this.onlineUsers.get(userId).size > 0;
  }

  /** Return array of online user IDs. */
  getOnlineUsers() {
    return Array.from(this.onlineUsers.keys());
  }

  _sendRaw(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;
    const { ws } = client;
    if (ws.readyState === 1 /* OPEN */) {
      try {
        ws.send(data);
      } catch (e) {
        // ignore send errors
      }
    }
  }
}

// Singleton hub instance shared across the app
const hub = new Hub();

module.exports = { Hub, hub };
