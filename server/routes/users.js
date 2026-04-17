const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createNotification } = require('../services/notifications');
const { buildPatchUpdate } = require('../services/patch');

const router = express.Router();
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

function countOtherActiveAdmins(excludeUserId = null) {
  let sql = `
    SELECT COUNT(*) AS count
    FROM users
    WHERE role = 'admin'
      AND is_active = 1
      AND login_disabled = 0
      AND COALESCE(is_retired, 0) = 0
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

function parseOptionalStudentId(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getUserWithLink(userId) {
  return db.prepare(`
    SELECT
      u.id,
      u.name,
      u.username,
      u.role,
      u.is_active,
      u.login_disabled,
      u.must_change_password,
      COALESCE(u.is_retired, 0) AS is_retired,
      u.retired_at,
      u.retired_by,
      u.retired_reason,
      s.id AS linked_student_id,
      s.name AS linked_student_name,
      s.level AS linked_student_level
    FROM users u
    LEFT JOIN students s ON s.user_id = u.id
    WHERE u.id = ?
  `).get(userId);
}

function ensureStudentLinkAvailable(studentId, userId = null) {
  if (studentId === null) return null;
  const student = db.prepare(`
    SELECT id, name, level, user_id
    FROM students
    WHERE id = ?
  `).get(studentId);
  if (!student) {
    const err = new Error('Selected student profile does not exist');
    err.status = 400;
    throw err;
  }
  if (student.user_id && student.user_id !== userId) {
    const err = new Error('Selected student profile is already linked to another user');
    err.status = 409;
    throw err;
  }
  return student;
}

// GET /api/users
router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  const users = db.prepare(`
    SELECT
      u.id,
      u.name,
      u.username,
      u.role,
      u.created_at,
      u.is_active,
      u.login_disabled,
      u.must_change_password,
      COALESCE(u.is_retired, 0) AS is_retired,
      u.retired_at,
      u.retired_by,
      u.retired_reason,
      s.id AS linked_student_id,
      s.name AS linked_student_name,
      s.level AS linked_student_level
    FROM users u
    LEFT JOIN students s ON s.user_id = u.id
    ORDER BY u.id ASC
  `).all();
  res.json(users.map((row) => ({
    ...row,
    linked_student_label: row.linked_student_id
      ? `${row.linked_student_name}${row.linked_student_level ? ` (${row.linked_student_level})` : ''}`
      : null,
    is_linked: !!row.linked_student_id,
    account_state: row.is_retired ? 'retired' : (row.is_active ? 'active' : 'inactive'),
  })));
});

// GET /api/users/student-options
router.get('/student-options', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.level,
      s.status,
      s.user_id AS linked_user_id
    FROM students s
    ORDER BY s.name COLLATE NOCASE ASC
  `).all();
  res.json(rows.map((row) => ({
    ...row,
    is_linked: !!row.linked_user_id,
    display_label: `${row.name}${row.level ? ` (${row.level})` : ''}`,
  })));
});

// POST /api/users
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const {
    name,
    username,
    role,
    password,
    confirm_password,
    student_id,
    is_active,
    login_disabled,
    must_change_password,
  } = req.body;

  if (!name || !username || !role || !password) {
    return res.status(400).json({ error: 'name, username, role, and password are required' });
  }
  if (password.length < PASSWORD_MIN_LENGTH)
    return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` });
  if (name.trim().length > 150)
    return res.status(400).json({ error: 'Name must be 150 characters or fewer' });
  if (username.trim().length > 50)
    return res.status(400).json({ error: 'Username must be 50 characters or fewer' });
  if (password.length > PASSWORD_MAX_LENGTH)
    return res.status(400).json({ error: `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer` });
  if (confirm_password !== undefined && password !== confirm_password) {
    return res.status(400).json({ error: 'Password and confirmation do not match' });
  }
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
  const studentId = parseOptionalStudentId(student_id);

  if (role === 'student' && studentId === null) {
    return res.status(400).json({ error: 'Student role requires a linked student profile' });
  }
  if (role !== 'student' && studentId !== null) {
    return res.status(400).json({ error: 'Only student users can be linked to a student profile' });
  }

  let linkedStudent = null;
  if (studentId !== null) {
    try {
      linkedStudent = ensureStudentLinkAvailable(studentId);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }

  const tx = db.transaction(() => {
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
    if (studentId !== null) {
      const linkResult = db.prepare(`
        UPDATE students
        SET user_id = ?
        WHERE id = ?
          AND (user_id IS NULL OR user_id = ?)
      `).run(newUserId, studentId, newUserId);
      if (linkResult.changes !== 1) {
        throw new Error('Selected student profile is already linked to another user');
      }
    }
    return newUserId;
  });

  let newUserId;
  try {
    newUserId = tx();
  } catch (err) {
    return res.status(409).json({ error: err.message || 'Unable to create linked account due to uniqueness conflict' });
  }
  createNotification({
    userId: newUserId,
    type: 'first_login_password_change_needed',
    title: 'Password change required',
    message: 'Your account requires a password change on first login.',
    entityType: 'user',
    entityId: newUserId,
  });

  audit(req.user.id, 'CREATE_USER', 'users', newUserId, `Created user ${username} (${role})`);
  if (linkedStudent) {
    audit(req.user.id, 'LINK_STUDENT_USER', 'users', newUserId,
      `Linked user "${username}" to student "${linkedStudent.name}" (${linkedStudent.id})`);
  }
  res.status(201).json({ id: newUserId });
});

// PUT /api/users/:id
router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const existing = getUserWithLink(userId);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const { name, username, role, is_active, login_disabled, student_id } = req.body;

  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty' });
    if (String(name).trim().length > 150) return res.status(400).json({ error: 'Name must be 150 characters or fewer' });
  }
  if (username !== undefined) {
    if (!String(username).trim()) return res.status(400).json({ error: 'Username cannot be empty' });
    if (String(username).trim().length > 50) return res.status(400).json({ error: 'Username must be 50 characters or fewer' });
  }

  if (role && !['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const nextUsername = username ? String(username).trim() : existing.username;
  if (nextUsername !== existing.username) {
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(nextUsername, userId);
    if (clash) return res.status(409).json({ error: 'Username already exists' });
  }

  const nextRole = role || existing.role;
  const activeFlag = parseBoolean(is_active);
  const loginDisabledFlag = parseBoolean(login_disabled);
  const requestedStudentId = Object.prototype.hasOwnProperty.call(req.body, 'student_id')
    ? parseOptionalStudentId(student_id)
    : existing.linked_student_id;

  let nextStudentId = requestedStudentId;
  if (nextRole !== 'student') nextStudentId = null;

  if (nextRole === 'student' && nextStudentId === null) {
    return res.status(400).json({ error: 'Student role requires a linked student profile' });
  }

  let nextStudent = null;
  if (nextStudentId !== null) {
    try {
      nextStudent = ensureStudentLinkAvailable(nextStudentId, userId);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }

  const nextActive = activeFlag === null ? existing.is_active : activeFlag;
  const nextLoginDisabled = loginDisabledFlag === null ? existing.login_disabled : loginDisabledFlag;

  const adminWouldBeDisabled = existing.role === 'admin'
    && (nextRole !== 'admin' || nextActive === 0 || nextLoginDisabled === 1);
  if (adminWouldBeDisabled && countOtherActiveAdmins(existing.id) === 0) {
    return res.status(400).json({ error: 'Cannot lock out the only active admin account' });
  }

  const tx = db.transaction(() => {
    const { sql, values } = buildPatchUpdate(
      'users',
      {
        name: name === undefined ? undefined : name.trim(),
        username: username === undefined ? undefined : nextUsername,
        role,
        is_active: activeFlag,
        login_disabled: loginDisabledFlag,
      },
      'id = ?',
      [userId],
    );
    if (sql) db.prepare(sql).run(...values);

    db.prepare('UPDATE students SET user_id = NULL WHERE user_id = ? AND id != COALESCE(?, -1)')
      .run(userId, nextStudentId);
    if (nextStudentId !== null) {
      const linkResult = db.prepare(`
        UPDATE students
        SET user_id = ?
        WHERE id = ?
          AND (user_id IS NULL OR user_id = ?)
      `).run(userId, nextStudentId, userId);
      if (linkResult.changes !== 1) {
        throw new Error('Selected student profile is already linked to another user');
      }
    }
  });

  try {
    tx();
  } catch (err) {
    return res.status(409).json({ error: err.message || 'Unable to update user safely' });
  }

  audit(req.user.id, 'UPDATE_USER', 'users', userId, `Updated user ${userId}`);
  if (existing.linked_student_id !== nextStudentId) {
    if (existing.linked_student_id) {
      audit(req.user.id, 'UNLINK_STUDENT_USER', 'users', userId,
        `Unlinked user "${existing.username}" from student ${existing.linked_student_id}`);
    }
    if (nextStudent) {
      audit(req.user.id, 'LINK_STUDENT_USER', 'users', userId,
        `Linked user "${username || existing.username}" to student "${nextStudent.name}" (${nextStudent.id})`);
    }
  }
  res.json({ ok: true });
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', requireAuth, requireRole('admin'), (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const { new_password, temporary } = req.body;
  if (!new_password || new_password.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `new_password must be at least ${PASSWORD_MIN_LENGTH} characters` });
  }
  if (new_password.length > PASSWORD_MAX_LENGTH) {
    return res.status(400).json({ error: `new_password must be ${PASSWORD_MAX_LENGTH} characters or fewer` });
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

  audit(req.user.id, 'ADMIN_PASSWORD_RESET', 'users', user.id,
    `Admin reset password for user: ${user.username}`);

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

// POST /api/users/:id/retire
router.post('/:id/retire', requireAuth, requireRole('admin'), (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });
  if (req.user.id === userId) return res.status(400).json({ error: 'You cannot retire your own account' });

  const user = db.prepare(`
    SELECT id, username, role, is_active, login_disabled, COALESCE(is_retired, 0) AS is_retired
    FROM users
    WHERE id = ?
  `).get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.is_retired) return res.status(400).json({ error: 'User is already retired' });

  if (user.role === 'admin' && countOtherActiveAdmins(userId) === 0) {
    return res.status(400).json({ error: 'Cannot retire the last active admin account' });
  }

  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!reason) return res.status(400).json({ error: 'Retirement reason is required' });

  db.prepare(`
    UPDATE users
    SET is_retired = 1,
        retired_at = datetime('now'),
        retired_by = ?,
        retired_reason = ?,
        is_active = 0,
        login_disabled = 1
    WHERE id = ?
  `).run(req.user.id, reason, userId);

  audit(req.user.id, 'RETIRE_USER', 'users', userId, `Retired user ${user.username}: ${reason}`);
  res.json({ ok: true });
});

module.exports = router;
