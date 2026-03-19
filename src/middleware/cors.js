'use strict';

const cors = require('cors');
const { loadConfig } = require('../config');

function createCorsMiddleware() {
  const cfg = loadConfig();
  const allowedOrigins = cfg.corsAllowedOrigins;

  return cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
}

module.exports = { createCorsMiddleware };
