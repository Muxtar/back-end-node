'use strict';

const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDB } = require('../database');
const { generateToken } = require('../utils/jwt');
const { generateQRCode } = require('../utils/qrcode');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function storeVerificationCode(phone, code, ttlMs) {
  const db = getDB();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.collection('verification_codes').insertOne({
    phone_number: phone,
    code,
    expires_at: expiresAt,
    created_at: new Date(),
  });
}

async function checkVerificationCode(phone, code) {
  const db = getDB();
  const doc = await db.collection('verification_codes').findOne({
    phone_number: phone,
    code,
    expires_at: { $gt: new Date() },
  });
  return !!doc;
}

async function consumeVerificationCode(phone, code) {
  const valid = await checkVerificationCode(phone, code);
  if (!valid) return false;
  const db = getDB();
  await db.collection('verification_codes').deleteMany({ phone_number: phone });
  return true;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function register(req, res) {
  try {
    const { phone_number, username, password, user_type, company_name, company_category } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

    const db = getDB();

    const existing = await db.collection('users').findOne({ phone_number });
    if (existing) return res.status(409).json({ error: 'User already exists' });

    // Hash password if provided (for future use)
    if (password) {
      await bcrypt.hash(password, 10); // stored if password field added to model
    }

    const userID = new ObjectId();
    const { qrData, qrBase64 } = await generateQRCode(userID.toHexString());

    const userType = user_type || 'normal';
    const now = new Date();
    const user = {
      _id: userID,
      phone_number,
      qr_code: qrBase64,
      username: username || '',
      user_type: userType,
      company_name: company_name || '',
      company_category: company_category || '',
      is_anonymous: false,
      account_status: 'active',
      created_at: now,
      updated_at: now,
      last_active: now,
    };

    await db.collection('users').insertOne(user);

    // Cache QR data
    await db.collection('qr_code_cache').updateOne(
      { qr_data: qrData },
      { $set: { qr_data: qrData, user_id: userID.toHexString(), created_at: now } },
      { upsert: true }
    );

    const token = generateToken(userID.toHexString());

    return res.status(201).json({ token, user, qr: qrBase64 });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function login(req, res) {
  try {
    const { phone_number } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

    const db = getDB();
    const user = await db.collection('users').findOne({ phone_number });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken(user._id.toHexString());
    return res.status(200).json({ token, user });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getQRCode(req, res) {
  try {
    const { user_id } = req.params;
    let userIDObj;
    try { userIDObj = new ObjectId(user_id); } catch { return res.status(400).json({ error: 'Invalid user ID' }); }

    const db = getDB();
    const user = await db.collection('users').findOne({ _id: userIDObj });
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json({ qr_code: user.qr_code });
  } catch (err) {
    console.error('getQRCode error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function sendCode(req, res) {
  try {
    const { phone_number } = req.body;
    if (!phone_number || phone_number.length < 10) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Generate 6-digit code
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

    // Store with 5 minute TTL
    await storeVerificationCode(phone_number, code, 5 * 60 * 1000);

    // Send SMS via Twilio
    let twilioSent = false;
    const twilioService = req.app.get('twilioService');
    if (twilioService && twilioService.isEnabled()) {
      try {
        await twilioService.sendVerificationCode(phone_number, code);
        twilioSent = true;
      } catch (twilioErr) {
        console.error('Failed to send SMS via Twilio:', twilioErr.message);
      }
    }

    const response = { message: 'Verification code sent', success: true };
    if (!twilioService || !twilioService.isEnabled() || !twilioSent) {
      response.code = code; // development mode
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error('sendCode error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function verifyCode(req, res) {
  try {
    const { phone_number, code } = req.body;
    if (!phone_number || !code) {
      return res.status(400).json({ error: 'phone_number and code are required' });
    }

    // Check code without consuming
    const ok = await checkVerificationCode(phone_number, code);
    if (!ok) return res.status(401).json({ error: 'Invalid or expired code' });

    const db = getDB();
    const user = await db.collection('users').findOne({ phone_number });

    if (!user) {
      // User not found — do NOT consume code (it will be used for register-with-code)
      return res.status(404).json({ error: 'User not found. Please register first.' });
    }

    // Consume code on successful login
    await consumeVerificationCode(phone_number, code);

    const token = generateToken(user._id.toHexString());
    return res.status(200).json({ token, user });
  } catch (err) {
    console.error('verifyCode error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function registerWithCode(req, res) {
  try {
    const {
      phone_number, code, username, profession,
      user_type, company_name, company_category,
    } = req.body;

    if (!phone_number || !code) {
      return res.status(400).json({ error: 'phone_number and code are required' });
    }

    if (user_type !== 'normal' && user_type !== 'company') {
      return res.status(400).json({ error: "user_type must be 'normal' or 'company'" });
    }

    if (user_type === 'company') {
      if (!company_name) return res.status(400).json({ error: 'company_name is required for company users' });
      if (!company_category) return res.status(400).json({ error: 'company_category is required for company users' });
    }

    // Verify and consume code
    const ok = await consumeVerificationCode(phone_number, code);
    if (!ok) return res.status(401).json({ error: 'Invalid or expired code' });

    const db = getDB();
    const existing = await db.collection('users').findOne({ phone_number });
    if (existing) return res.status(409).json({ error: 'User already exists' });

    const userID = new ObjectId();
    const { qrData, qrBase64 } = await generateQRCode(userID.toHexString());

    const now = new Date();
    const user = {
      _id: userID,
      phone_number,
      qr_code: qrBase64,
      username: username || '',
      profession: profession || '',
      user_type: user_type || 'normal',
      company_name: company_name || '',
      company_category: company_category || '',
      is_anonymous: false,
      account_status: 'active',
      created_at: now,
      updated_at: now,
      last_active: now,
    };

    await db.collection('users').insertOne(user);

    await db.collection('qr_code_cache').updateOne(
      { qr_data: qrData },
      { $set: { qr_data: qrData, user_id: userID.toHexString(), created_at: now } },
      { upsert: true }
    );

    const token = generateToken(userID.toHexString());
    return res.status(201).json({ token, user, qr: qrBase64 });
  } catch (err) {
    console.error('registerWithCode error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Legacy endpoint — same as sendCode
const verifyPhone = sendCode;

module.exports = {
  register,
  login,
  getQRCode,
  sendCode,
  verifyCode,
  registerWithCode,
  verifyPhone,
};
