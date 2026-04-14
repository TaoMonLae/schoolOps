const express = require('express');
const bcrypt  = require('bcryptjs');
const { db, audit } = require('../db/database');
const { requireAuth, signToken } = require('../middleware/auth');

const router = express.Router();
const isProduction = process.env.NODE_ENV === 'production';

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProduction,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  };
}

function getClearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProduction,
  };
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    audit(null, 'LOGIN_FAILED', 'users', null, `Failed login attempt for username: ${username}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'Account is deactivated' });
  }
  if (user.login_disabled) {
    return res.status(403).json({ error: 'Login disabled for this account' });
  }

  const token = signToken(user);
  res.cookie('token', token, getCookieOptions());

  audit(user.id, 'LOGIN', 'users', user.id, `${user.username} logged in`);

  return res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    student_id: user.role === 'student'
      ? (db.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id)?.id || null)
      : null,
    must_change_password: !!user.must_change_password,
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', getClearCookieOptions());
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT id, name, username, role, is_active, login_disabled, must_change_password
    FROM users
    WHERE id = ?
  `).get(req.user.id);

  if (!user || !user.is_active || user.login_disabled) {
    res.clearCookie('token', getClearCookieOptions());
    return res.status(401).json({ error: 'Account is not allowed to access this session' });
  }

  res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    student_id: user.role === 'student'
      ? (db.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id)?.id || null)
      : null,
    must_change_password: !!user.must_change_password,
  });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.status(400).json({ error: 'current_password, new_password, and confirm_password are required' });
  }
  if (new_password !== confirm_password) {
    return res.status(400).json({ error: 'New password and confirmation do not match' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (new_password.length > 128) {
    return res.status(400).json({ error: 'Password must be 128 characters or fewer' });
  }
  if (new_password === current_password) {
    return res.status(400).json({ error: 'New password must differ from your current password' });
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);

  audit(req.user.id, 'CHANGE_PASSWORD', 'users', user.id, `Password changed for ${user.username}`);
  res.json({ ok: true });
});

module.exports = router;
