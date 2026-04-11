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

function writeAttachmentFile(entityType, originalName, mimeType, buffer) {
  if (!ALLOWED_MIME.has(mimeType)) throw new Error('Unsupported file type');
  const cleaned = sanitizeFilename(originalName);
  const ext = EXT_BY_MIME[mimeType] || path.extname(cleaned) || '';
  const storedName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
  const destDir = path.resolve(UPLOAD_ROOT, ENTITY_DIR[entityType]);
  fs.mkdirSync(destDir, { recursive: true });

  const destPath = resolveStoragePath(entityType, storedName);
  fs.writeFileSync(destPath, buffer);

  return { storedName, cleanedOriginalName: cleaned };
}

module.exports = {
  ALLOWED_MIME,
  UPLOAD_ROOT,
  sanitizeFilename,
  ensureEntityExists,
  canView,
  canManage,
  writeAttachmentFile,
  resolveStoragePath,
};
