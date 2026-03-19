'use strict';

const jwt = require('jsonwebtoken');

// Read secret directly from env — set once at startup, fast on every call
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

function generateToken(userId) {
  return jwt.sign(
    { user_id: userId.toString() },
    getSecret(),
    { expiresIn: '24h', algorithm: 'HS256' }
  );
}

function validateToken(tokenString) {
  try {
    const decoded = jwt.verify(tokenString, getSecret(), { algorithms: ['HS256'] });
    return { userId: decoded.user_id, error: null };
  } catch (err) {
    return { userId: null, error: err.message };
  }
}

module.exports = { generateToken, validateToken };
