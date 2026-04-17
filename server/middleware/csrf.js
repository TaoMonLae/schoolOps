const crypto = require('crypto');

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getCsrfCookieOptions(isProduction) {
  // Intentionally NOT httpOnly — the SPA reads this cookie and echoes it in
  // the X-CSRF-Token request header. The double-submit check is the defense.
  return {
    httpOnly: false,
    sameSite: 'Lax',
    secure: !!isProduction,
    path: '/',
  };
}

function issueCsrfToken(req, res, next) {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, getCsrfCookieOptions(isProduction));
    req.cookies[CSRF_COOKIE] = token;
  }
  next();
}

function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.cookies?.token) return next(); // no session = no CSRF target

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }
  next();
}

module.exports = { issueCsrfToken, requireCsrf, CSRF_COOKIE, CSRF_HEADER };
