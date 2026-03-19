'use strict';

const { validateToken } = require('../utils/jwt');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Invalid authorization header format' });
  }

  const tokenString = authHeader.slice(7);
  const { userId, error } = validateToken(tokenString);

  if (error || !userId) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.userId = userId;
  next();
}

module.exports = { authMiddleware };
