'use strict';

function normalizePhoneNumber(phone) {
  if (!phone) return '';
  phone = phone.trim();
  let normalized = '';
  if (phone.startsWith('+')) normalized = '+';
  for (const ch of phone.replace('+', '')) {
    if (ch >= '0' && ch <= '9') normalized += ch;
  }
  return normalized.startsWith('+') ? normalized : '+' + normalized.replace(/^\+/, '');
}

class TwilioService {
  constructor(cfg) {
    this.enabled = false;
    this.from = '';
    this.client = null;

    if (
      !cfg.twilioEnabled ||
      !cfg.twilioAccountSID ||
      !cfg.twilioAuthToken ||
      !cfg.twilioPhoneNumber
    ) {
      console.log('Twilio is disabled or not configured. SMS will not be sent.');
      return;
    }

    try {
      const twilio = require('twilio');
      this.client = twilio(cfg.twilioAccountSID, cfg.twilioAuthToken);
      this.from = cfg.twilioPhoneNumber;
      this.enabled = true;
      console.log('✅ Twilio service initialized');
    } catch (err) {
      console.log('Twilio module not available:', err.message);
    }
  }

  isEnabled() {
    return this.enabled;
  }

  async sendSMS(to, message) {
    if (!this.enabled) {
      throw new Error('Twilio is not enabled or configured');
    }
    if (!to) throw new Error('Recipient phone number is required');
    if (!message) throw new Error('Message body is required');

    const normalizedTo = normalizePhoneNumber(to);
    if (!normalizedTo.startsWith('+')) {
      throw new Error('Invalid phone number format. Must be E.164 (e.g. +18777804236)');
    }

    const resp = await this.client.messages.create({
      to: normalizedTo,
      from: this.from,
      body: message,
    });

    console.log(`SMS sent successfully. SID: ${resp.sid}, To: ${normalizedTo}`);
    return resp;
  }

  async sendVerificationCode(phoneNumber, code) {
    const message = `Your verification code is: ${code}. This code will expire in 5 minutes.`;
    return this.sendSMS(phoneNumber, message);
  }
}

module.exports = { TwilioService };
