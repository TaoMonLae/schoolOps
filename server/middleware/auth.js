const jwt = require('jsonwebtoken');
const { db } = require('../db/database');

const SECRET = process.env.JWT_SECRET;

function getSecret() {
  if (!SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return SECRET;
}

/**
 * Attach verified user payload to req.user.
 * Returns 401 if token is missing or invalid.
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, getSecret());
    const user = db.prepare(`
      SELECT id, username, name, role, is_active, login_disabled
      FROM users
      WHERE id = ?
    `).get(payload.id);

    if (!user || !user.is_active || user.login_disabled) {
      return res.status(401).json({ error: 'Account is not allowed to access this session' });
    }

    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Factory: only allow users whose role is in the given array.
 * Requires requireAuth to run first.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    getSecret(),
    { expiresIn: '8h' }
  );
}

module.exports = { requireAuth, requireRole, signToken };
