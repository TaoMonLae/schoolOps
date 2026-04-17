const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('../db/database');
const { UPLOAD_DIR } = require('../config/paths');

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXT_BY_MIME = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const UPLOAD_ROOT = UPLOAD_DIR;
const ENTITY_DIR = {
  expenditure: 'expenditures',
  duty_log: 'duty_logs',
};

function sniffMime(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer.slice(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 8
      && buffer[0] === 0x89 && buffer[1] === 0x50
      && buffer[2] === 0x4E && buffer[3] === 0x47
      && buffer[4] === 0x0D && buffer[5] === 0x0A
      && buffer[6] === 0x1A && buffer[7] === 0x0A) return 'image/png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer.length >= 12
      && buffer.slice(0, 4).toString('ascii') === 'RIFF'
      && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function sanitizeFilename(name) {
  return path.basename(name || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 120) || 'file';
}

function ensureEntityExists(entityType, entityId) {
  if (entityType === 'expenditure') {
    return db.prepare('SELECT id FROM expenditures WHERE id = ?').get(entityId);
  }
  if (entityType === 'duty_log') {
    return db.prepare('SELECT id, submitted_by FROM duty_logs WHERE id = ?').get(entityId);
  }
  return null;
}

function canView(user, entityType, entity) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'teacher') return true;
  if (user.role === 'student' && entityType === 'duty_log') {
    return entity.submitted_by === user.id;
  }
  return false;
}

function canManage(user, entityType, entity) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'student' && entityType === 'duty_log') {
    return entity.submitted_by === user.id;
  }
  return false;
}

function resolveStoragePath(entityType, storedName) {
  const subdir = ENTITY_DIR[entityType];
  const full = path.resolve(UPLOAD_ROOT, subdir, storedName);
  const allowedPrefix = path.resolve(UPLOAD_ROOT, subdir) + path.sep;
  if (!full.startsWith(allowedPrefix)) throw new Error('Invalid storage path');
  return full;
}

function writeAttachmentFile(entityType, originalName, claimedMimeType, buffer) {
  // Ignore the client-provided Content-Type. Use only what the actual
  // file bytes prove the type to be.
  const realMime = sniffMime(buffer);
  if (!realMime || !ALLOWED_MIME.has(realMime)) {
    throw new Error('Unsupported file type');
  }
  const mimeType = realMime;
  const cleaned = sanitizeFilename(originalName);
  const ext = EXT_BY_MIME[mimeType];
  const storedName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
  const destDir = path.resolve(UPLOAD_ROOT, ENTITY_DIR[entityType]);
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = resolveStoragePath(entityType, storedName);
  fs.writeFileSync(destPath, buffer);
  return { storedName, cleanedOriginalName: cleaned, mimeType };
}

module.exports = {
  ALLOWED_MIME,
  UPLOAD_ROOT,
  sniffMime,
  sanitizeFilename,
  ensureEntityExists,
  canView,
  canManage,
  writeAttachmentFile,
  resolveStoragePath,
};
