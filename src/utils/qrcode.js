'use strict';

const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

async function generateQRCode(userId) {
  const qrData = `CHATAPP:${userId}:${uuidv4()}`;

  const buffer = await QRCode.toBuffer(qrData, {
    errorCorrectionLevel: 'M',
    width: 256,
    type: 'png',
  });

  const qrBase64 = buffer.toString('base64');
  return { qrData, qrBase64 };
}

function parseQRCode(qrData) {
  // Format: CHATAPP:userId:uuid
  if (!qrData || !qrData.startsWith('CHATAPP:')) {
    return { userId: null, error: 'Invalid QR code format' };
  }
  const parts = qrData.split(':');
  if (parts.length < 2) {
    return { userId: null, error: 'Invalid QR code format' };
  }
  return { userId: parts[1], error: null };
}

module.exports = { generateQRCode, parseQRCode };
