const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth, requireRole } = require('../middleware/auth');
const { db, dbPath, audit } = require('../db/database');
const { getSettings, touchLastBackup } = require('../services/settings');
const { BACKUP_DIR, UPLOAD_DIR, ensureDir } = require('../config/paths');

const router = express.Router();
const VERSION = require('../../package.json').version;

function backupDir() {
  return BACKUP_DIR;
}

function ensureBackupDir() {
  const dir = backupDir();
  ensureDir(dir);
  return dir;
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function createBackupSnapshot(targetPath) {
  await db.backup(targetPath);
  return targetPath;
}

router.get('/status', requireAuth, requireRole('admin'), (req, res) => {
  const settings = getSettings();
  res.json({
    db_path: dbPath,
    app_version: VERSION,
    environment: process.env.NODE_ENV || 'development',
    backup_dir: backupDir(),
    last_backup_at: settings.last_backup_at || null,
  });
});

router.get('/backup/download', requireAuth, requireRole('admin'), async (req, res, next) => {
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Database file not found' });

  try {
    const dir = ensureBackupDir();
    const nowIso = new Date().toISOString();
    const stamp = nowIso.slice(0, 19).replace(/[:T]/g, '-');
    const snapshotPath = path.join(dir, `ledger-download-${timestampName()}.sqlite`);
    const filename = `ledger-backup-${stamp}.sqlite`;

    await createBackupSnapshot(snapshotPath);
    touchLastBackup(nowIso);
    audit(req.user.id, 'DOWNLOAD_BACKUP', 'settings', null, `Database backup downloaded: ${snapshotPath}`);

    // Stream the file and clean up regardless of success or failure
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const fileStream = fs.createReadStream(snapshotPath);

    const cleanup = () => {
      try {
        if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
      } catch (cleanupErr) {
        console.error('Failed to clean up backup snapshot:', cleanupErr);
      }
    };

    fileStream.on('error', (streamErr) => {
      cleanup();
      if (!res.headersSent) next(streamErr);
    });

    res.on('finish', cleanup);
    res.on('close', cleanup); // handles client disconnect

    fileStream.pipe(res);
  } catch (err) {
    next(err);
  }
});

router.post('/backup/create', requireAuth, requireRole('admin'), async (req, res) => {
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Database file not found' });

  const dir = ensureBackupDir();
  const name = `ledger-backup-${timestampName()}.sqlite`;
  const target = path.join(dir, name);

  await createBackupSnapshot(target);

  const nowIso = new Date().toISOString();
  touchLastBackup(nowIso);
  audit(req.user.id, 'CREATE_BACKUP', 'settings', null, `Manual backup created: ${target}`);

  res.json({ ok: true, backup_file: target, last_backup_at: nowIso });
});

router.get('/backup/instructions', requireAuth, requireRole('admin'), (req, res) => {
  res.json({
    db_path: dbPath,
    backup_dir: backupDir(),
    instructions: [
      '1. Stop the app before replacing the SQLite file.',
      `2. Keep a copy of upload files (${UPLOAD_DIR}) together with the database backup.`,
      '3. Use the built-in backup create/download actions for a safe snapshot while the app is running.',
    ],
  });
});

module.exports = router;
