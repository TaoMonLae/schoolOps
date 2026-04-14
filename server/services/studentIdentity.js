const { db } = require('../db/database');

function getStudentByUserId(userId, { activeOnly = false } = {}) {
  if (!userId) return null;
  const whereActive = activeOnly ? "AND s.status = 'active'" : '';
  return db.prepare(`
    SELECT s.id, s.user_id, s.name, s.level, s.status, s.hostel_status, s.dorm_house, s.room, s.bed_number, s.fee_amount, s.fee_frequency, s.enroll_date
    FROM students s
    WHERE s.user_id = ?
    ${whereActive}
    LIMIT 1
  `).get(userId);
}

function resolveStudentForRequest(req, options = {}) {
  const { requireActive = false } = options;
  if (!req.user || req.user.role !== 'student') {
    return { ok: false, status: 403, error: 'Student access only', student: null };
  }

  const student = getStudentByUserId(req.user.id, { activeOnly: requireActive });
  if (!student) {
    return {
      ok: false,
      status: 409,
      error: requireActive
        ? 'No active student profile is linked to this account. Please contact an administrator.'
        : 'No student profile is linked to this account. Please contact an administrator.',
      student: null,
    };
  }

  return { ok: true, status: 200, student };
}

function requireLinkedStudent(options = {}) {
  return (req, res, next) => {
    const resolved = resolveStudentForRequest(req, options);
    if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.error });
    req.student = resolved.student;
    return next();
  };
}

module.exports = {
  getStudentByUserId,
  resolveStudentForRequest,
  requireLinkedStudent,
};
