const crypto = require('crypto');

function generateRequestId() {
  return crypto.randomBytes(16).toString('hex');
}

function createLogger(req) {
  const base = {
    timestamp: new Date().toISOString(),
    requestId: req?.id || 'unknown',
    ...(req.user && { userId: req.user.id, username: req.user.username }),
    method: req?.method,
    path: req?.path,
    ip: req?.ip,
  };
  return {
    info: (msg, meta = {}) => console.log(JSON.stringify({ ...base, level: 'info', message: msg, ...meta })),
    warn: (msg, meta = {}) => console.warn(JSON.stringify({ ...base, level: 'warn', message: msg, ...meta })),
    error: (msg, meta = {}) => console.error(JSON.stringify({ ...base, level: 'error', message: msg, ...meta })),
    debug: (msg, meta = {}) => console.debug(JSON.stringify({ ...base, level: 'debug', message: msg, ...meta })),
  };
}

module.exports = { generateRequestId, createLogger };
