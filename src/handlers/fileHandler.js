'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { loadConfig } = require('../config');

const config = loadConfig();
const uploadDir = config.uploadDir;

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ─── Multer setup ─────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize || 10 * 1024 * 1024 }, // 10 MB
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function uploadFile(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { filename, originalname, size, mimetype } = req.file;

    return res.json({
      url: `/api/v1/files/${filename}`,
      filename,
      original_name: originalname,
      size,
      content_type: mimetype,
    });
  } catch (err) {
    console.error('uploadFile error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);

async function serveFile(req, res) {
  try {
    const filename = req.params.filename;

    // Prevent path traversal — use only basename and block encoded characters
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')
        || filename.includes('%2e') || filename.includes('%2f') || filename.includes('%5c')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const safeFilename = path.basename(filename);
    const filePath = path.join(uploadDir, safeFilename);

    // Verify the resolved path is still within uploadDir
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(uploadDir))) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Allow cross-origin loading (frontend may be on a different domain)
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const ext = path.extname(filename).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache images 24h
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    return res.sendFile(resolved);
  } catch (err) {
    console.error('serveFile error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  upload,
  uploadFile,
  serveFile,
};
