/**
 * Production-safe admin bootstrap script.
 *
 * Required environment variables:
 *   BOOTSTRAP_ADMIN_NAME
 *   BOOTSTRAP_ADMIN_USERNAME
 *   BOOTSTRAP_ADMIN_PASSWORD
 *
 * Optional:
 *   BOOTSTRAP_ADMIN_RESET_PASSWORD=true
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const { db } = require('./database');

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} environment variable is required`);
  }
  return value.trim();
}

function validatePassword(password) {
  if (password.length < 12) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');
  }
}

function main() {
  const name = required('BOOTSTRAP_ADMIN_NAME');
  const username = required('BOOTSTRAP_ADMIN_USERNAME');
  const password = required('BOOTSTRAP_ADMIN_PASSWORD');
  const resetPassword = process.env.BOOTSTRAP_ADMIN_RESET_PASSWORD === 'true';

  validatePassword(password);

  const existingAdmins = db.prepare(`
    SELECT id, username
    FROM users
    WHERE role = 'admin' AND is_active = 1
    ORDER BY id ASC
  `).all();

  const existingUser = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
  const passwordHash = bcrypt.hashSync(password, 10);

  if (existingUser && existingUser.role !== 'admin') {
    throw new Error(`Username "${username}" already exists with non-admin role`);
  }

  if (existingAdmins.length > 0) {
    const sameAdmin = existingAdmins.find((row) => row.username === username);

    if (!sameAdmin) {
      console.log('ℹ️ Active admin user(s) already exist. No new admin was created.');
      console.log(`   Existing admin usernames: ${existingAdmins.map((a) => a.username).join(', ')}`);
      return;
    }

    if (resetPassword) {
      db.prepare(`
        UPDATE users
        SET name = ?, password_hash = ?, is_active = 1, login_disabled = 0, must_change_password = 0
        WHERE username = ?
      `).run(name, passwordHash, username);
      console.log(`✅ Admin "${username}" updated (name/password/status refreshed).`);
      return;
    }

    db.prepare(`
      UPDATE users
      SET name = ?, is_active = 1, login_disabled = 0
      WHERE username = ?
    `).run(name, username);
    console.log(`✅ Admin "${username}" already exists. No duplicate created.`);
    console.log('   To rotate password via this script, rerun with BOOTSTRAP_ADMIN_RESET_PASSWORD=true.');
    return;
  }

  if (existingUser) {
    db.prepare(`
      UPDATE users
      SET name = ?, password_hash = ?, role = 'admin', is_active = 1, login_disabled = 0, must_change_password = 0
      WHERE username = ?
    `).run(name, passwordHash, username);
    console.log(`✅ User "${username}" promoted to admin and activated.`);
    return;
  }

  db.prepare(`
    INSERT INTO users (name, username, password_hash, role, is_active, login_disabled, must_change_password)
    VALUES (?, ?, ?, 'admin', 1, 0, 0)
  `).run(name, username, passwordHash);

  console.log(`✅ Admin "${username}" created.`);
}

try {
  main();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
