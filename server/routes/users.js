const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createNotification } = require('../services/notifications');

const router = express.Router();

function countOtherActiveAdmins(excludeUserId = null) {
  let sql = `
    SELECT COUNT(*) AS count
    FROM users
    WHERE role = 'admin'
      AND is_active = 1
      AND login_disabled = 0
  `;
  const params = [];
  if (excludeUserId) {
    sql += ' AND id != ?';
    params.push(excludeUserId);
  }
  const row = db.prepare(sql).get(...params);
  return row?.count || 0;
}

function parseBoolean(value) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return null;
}

// GET /api/users
router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  const users = db.prepare(`
    SELECT id, name, username, role, created_at, is_active, login_disabled, must_change_password
    FROM users
    ORDER BY id ASC
  `).all();
  res.json(users);
});

// POST /api/users
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const {
    name,
    username,
    role,
    password,
    is_active,
    login_disabled,
    must_change_password,
  } = req.body;

  if (!name || !username || !role || !password) {
    return res.status(400).json({ error: 'name, username, role, and password are required' });
  }
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (name.trim().length > 150)
    return res.status(400).json({ error: 'Name must be 150 characters or fewer' });
  if (username.trim().length > 50)
    return res.status(400).json({ error: 'Username must be 50 characters or fewer' });
  if (password.length > 128)
    return res.status(400).json({ error: 'Password must be 128 characters or fewer' });
  if (!['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const activeFlag = parseBoolean(is_active);
  const loginDisabledFlag = parseBoolean(login_disabled);
  const mustChangeFlag = parseBoolean(must_change_password);

  const result = db.prepare(`
    INSERT INTO users (name, username, password_hash, role, is_active, login_disabled, must_change_password)
    VALUES (?, ?, ?, ?, COALESCE(?, 1), COALESCE(?, 0), COALESCE(?, 1))
  `).run(
    name.trim(),
    username.trim(),
    passwordHash,
    role,
    activeFlag,
    loginDisabledFlag,
    mustChangeFlag
  );

  const newUserId = Number(result.lastInsertRowid);
  createNotification({
    userId: newUserId,
    type: 'first_login_password_change_needed',
    title: 'Password change required',
    message: 'Your account requires a password change on first login.',
    entityType: 'user',
    entityId: newUserId,
  });

  audit(req.user.id, 'CREATE_USER', 'users', newUserId, `Created user ${username} (${role})`);
  res.status(201).json({ id: newUserId });
});

// PUT /api/users/:id
router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const existing = db.prepare('SELECT id, username, role, is_active, login_disabled FROM users WHERE id = ?').get(userId);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const { name, username, role, is_active, login_disabled } = req.body;

  if (role && !['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  if (username && username !== existing.username) {
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
    if (clash) return res.status(409).json({ error: 'Username already exists' });
  }

  const nextRole = role || existing.role;
  const activeFlag = parseBoolean(is_active);
  const loginDisabledFlag = parseBoolean(login_disabled);
  const nextActive = activeFlag === null ? existing.is_active : activeFlag;
  const nextLoginDisabled = loginDisabledFlag === null ? existing.login_disabled : loginDisabledFlag;

  const adminWouldBeDisabled = existing.role === 'admin' && (nextRole !== 'admin' || nextActive === 0 || nextLoginDisabled === 1);
  if (adminWouldBeDisabled && countOtherActiveAdmins(existing.id) === 0) {
    return res.status(400).json({ error: 'Cannot lock out the only active admin account' });
  }

  db.prepare(`
    UPDATE users
    SET name = COALESCE(?, name),
        username = COALESCE(?, username),
        role = COALESCE(?, role),
        is_active = COALESCE(?, is_active),
        login_disabled = COALESCE(?, login_disabled)
    WHERE id = ?
  `).run(
    name ? name.trim() : null,
    username ? username.trim() : null,
    role || null,
    activeFlag,
    loginDisabledFlag,
    userId
  );

  audit(req.user.id, 'UPDATE_USER', 'users', userId, `Updated user ${userId}`);
  res.json({ ok: true });
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', requireAuth, requireRole('admin'), (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const { new_password, temporary } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'new_password must be at least 6 characters' });
  }

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const mustChange = parseBoolean(temporary);
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare(`
    UPDATE users
    SET password_hash = ?,
        must_change_password = COALESCE(?, 1)
    WHERE id = ?
  `).run(hash, mustChange, userId);

  createNotification({
    userId,
    type: 'password_reset',
    title: 'Password was reset',
    message: mustChange === 1
      ? 'Your password was reset. Please change it at first login.'
      : 'Your password was reset by an administrator.',
    entityType: 'user',
    entityId: userId,
  });

  if (mustChange === 1) {
    createNotification({
      userId,
      type: 'first_login_password_change_needed',
      title: 'Password change required',
      message: 'Please change your temporary password after signing in.',
      entityType: 'user',
      entityId: userId,
    });
  }

  audit(req.user.id, 'RESET_PASSWORD', 'users', userId, `Reset password for ${user.username}`);
  res.json({ ok: true });
});

module.exports = router;
