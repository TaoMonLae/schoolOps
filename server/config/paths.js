const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function resolveAppPath(value, fallbackRelativePath) {
  return value
    ? path.resolve(value)
    : path.resolve(PROJECT_ROOT, fallbackRelativePath);
}

const DB_PATH = resolveAppPath(process.env.DB_PATH, 'server/db/ledger.sqlite');
const UPLOAD_DIR = resolveAppPath(process.env.UPLOAD_DIR, 'uploads');
const BACKUP_DIR = resolveAppPath(process.env.BACKUP_DIR, 'backups');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureRuntimeDirectories() {
  ensureDir(path.dirname(DB_PATH));
  ensureDir(UPLOAD_DIR);
  ensureDir(path.join(UPLOAD_DIR, 'expenditures'));
  ensureDir(path.join(UPLOAD_DIR, 'duty_logs'));
  ensureDir(BACKUP_DIR);
}

module.exports = {
  PROJECT_ROOT,
  DB_PATH,
  UPLOAD_DIR,
  BACKUP_DIR,
  ensureDir,
  ensureRuntimeDirectories,
};
