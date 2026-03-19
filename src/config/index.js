'use strict';

const path = require('path');

function getEnv(key, defaultValue = '') {
  return process.env[key] || defaultValue;
}

function splitAndTrim(str, sep = ',') {
  return str.split(sep).map(s => s.trim()).filter(s => s && s !== '*');
}

function loadConfig() {
  let mongoURI = getEnv('MONGODB_URI') || getEnv('MONGO_URL') || 'mongodb://localhost:27017';

  const jwtSecret = getEnv('JWT_SECRET', '');
  if (!jwtSecret || jwtSecret === 'your-secret-key') {
    console.error('FATAL: JWT_SECRET environment variable is not set or is using the insecure default value.');
    process.exit(1);
  }

  const corsOriginsRaw = getEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000');
  const corsOrigins = splitAndTrim(corsOriginsRaw);

  const twilioEnabled = getEnv('TWILIO_ENABLED', 'false') === 'true';

  return {
    port: getEnv('PORT', '8080'),
    mongodbURI: mongoURI,
    mongodbName: getEnv('MONGODB_DB', getEnv('MONGO_DATABASE', 'chat_app')),
    jwtSecret,
    jwtExpiration: getEnv('JWT_EXPIRATION', '24h'),
    uploadDir: path.resolve(getEnv('UPLOAD_DIR', './uploads')),
    maxFileSize: parseInt(getEnv('MAX_FILE_SIZE', '10485760'), 10), // 10MB
    corsAllowedOrigins: corsOrigins.length ? corsOrigins : ['http://localhost:3000'],
    twilioAccountSID: getEnv('TWILIO_ACCOUNT_SID', ''),
    twilioAuthToken: getEnv('TWILIO_AUTH_TOKEN', ''),
    twilioPhoneNumber: getEnv('TWILIO_PHONE_NUMBER', ''),
    twilioEnabled,
  };
}

module.exports = { loadConfig };
