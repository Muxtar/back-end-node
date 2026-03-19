'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const { loadConfig } = require('./src/config');
const { initialize: initDB, close: closeDB } = require('./src/database');
const { createCorsMiddleware } = require('./src/middleware/cors');
const { setupWebSocket } = require('./src/websocket/handler');
const { startCallTimeoutChecker } = require('./src/handlers/callHandler');
const routes = require('./src/routes');

async function main() {
  const cfg = loadConfig();

  // Connect to MongoDB with retry
  await initDB(cfg);

  const app = express();

  // ── Middleware ─────────────────────────────────────────────────────────────
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── Store services on app for handlers to access ───────────────────────────
  const { TwilioService } = require('./src/utils/twilio');
  const twilioService = new TwilioService(cfg);
  app.set('twilioService', twilioService);
  app.set('config', cfg);

  // ── API Routes ─────────────────────────────────────────────────────────────
  app.use('/api/v1', routes);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // ── HTTP server ───────────────────────────────────────────────────────────
  const server = http.createServer(app);

  // ── WebSocket (attaches to the same HTTP server) ──────────────────────────
  setupWebSocket(server);

  // ── Call timeout checker ───────────────────────────────────────────────────
  startCallTimeoutChecker();

  // ── Start listening ───────────────────────────────────────────────────────
  const port = cfg.port || 8080;
  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on 0.0.0.0:${port}`);
    console.log(`📡 WebSocket endpoint: ws://0.0.0.0:${port}/ws`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      await closeDB();
      console.log('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
