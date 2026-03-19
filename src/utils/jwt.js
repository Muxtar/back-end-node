'use strict';

const jwt = require('jsonwebtoken');

let _secret = null;

function setSecret(secret) {
  _secret = secret;
}

function getSecret() {
  if (!_secret) throw new Error('JWT secret not set');
  return _secret;
}

function generateToken(userId) {
  const secret = getSecret();
  return jwt.sign(
    { user_id: userId.toString() },
    secret,
    { expiresIn: '24h', algorithm: 'HS256' }
  );
}

function validateToken(tokenString) {
  const secret = getSecret();
  try {
    const decoded = jwt.verify(tokenString, secret, { algorithms: ['HS256'] });
    return { userId: decoded.user_id, error: null };
  } catch (err) {
    return { userId: null, error: err.message };
  }
}

module.exports = { setSecret, generateToken, validateToken };
