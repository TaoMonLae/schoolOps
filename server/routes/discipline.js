const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_SEVERITIES = ['minor', 'moderate', 'serious'];
const VALID_STATUSES   = ['pending', 'reviewed', 'confirmed', 'resolved', 'appealed'];

// ── Admin: Rules ──────────────────────────────────────────────────────────────

// GET /api/discipline/rules
router.get('/rules', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { active } = req.query;
  let sql = 'SELECT * FROM disciplinary_rules';
  const params = [];
  if (active !== undefined) {
    sql += ' WHERE active = ?';
    params.push(active === '1' || active === 'true' ? 1 : 0);
  }
  sql += ' ORDER BY category, rule_code';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/discipline/rules
router.post('/rules', requireAuth, requireRole('admin'), (req, res) => {
  const { rule_code, title, category, article_reference, description, severity, default_action } = req.body;
  if (!rule_code || !title || !category || !severity) {
    return res.status(400).json({ error: 'rule_code, title, category and severity are required.' });
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: 'Invalid severity value.' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO disciplinary_rules (rule_code, title, category, article_reference, description, severity, default_action, active, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      rule_code.trim(), title.trim(), category.trim(),
      article_reference ? article_reference.trim() : null,
      description ? description.trim() : null,
      severity,
      default_action ? default_action.trim() : null,
      req.user.id,
    );
    audit(req.user.id, 'create', 'disciplinary_rules', result.lastInsertRowid, `Created rule ${rule_code}`);
    res.status(201).json(db.prepare('SELECT * FROM disciplinary_rules WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Rule code already exists.' });
    throw e;
  }
});

// PUT /api/discipline/rules/:id
router.put('/rules/:id', requireAuth, requireRole('admin'), (req, res) => {
  const rule = db.prepare('SELECT * FROM disciplinary_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found.' });

  const { title, category, article_reference, description, severity, default_action, active } = req.body;
  if (severity && !VALID_SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: 'Invalid severity value.' });
  }

  db.prepare(`
    UPDATE disciplinary_rules
    SET title = ?, category = ?, article_reference = ?, description = ?,
        severity = ?, default_action = ?, active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title             !== undefined ? title.trim()                   : rule.title,
    category          !== undefined ? category.trim()                : rule.category,
    article_reference !== undefined ? (article_reference || null)    : rule.article_reference,
    description       !== undefined ? (description || null)          : rule.description,
    severity          !== undefined ? severity                       : rule.severity,
    default_action    !== undefined ? (default_action || null)       : rule.default_action,
    active            !== undefined ? (active ? 1 : 0)              : rule.active,
    req.params.id,
  );
  audit(req.user.id, 'update', 'disciplinary_rules', req.params.id, `Updated rule ${rule.rule_code}`);
  res.json(db.prepare('SELECT * FROM disciplinary_rules WHERE id = ?').get(req.params.id));
});

// ── Admin: Records ────────────────────────────────────────────────────────────

function enrichRecord(r) {
  return { ...r, parent_guardian_notified: !!r.parent_guardian_notified };
}

const RECORDS_BASE_SQL = `
  SELECT dr.*,
         s.name  AS student_name,
         s.level AS student_level,
         rl.rule_code,
         rl.title             AS rule_title,
         rl.category          AS rule_category,
         rl.description       AS rule_description,
         rl.article_reference AS rule_article,
         rl.default_action    AS rule_default_action,
         u.name  AS reported_by_name
  FROM disciplinary_records dr
  JOIN students          s  ON s.id  = dr.student_id
  JOIN disciplinary_rules rl ON rl.id = dr.rule_id
  LEFT JOIN users        u  ON u.id  = dr.reported_by
`;

// GET /api/discipline/records
router.get('/records', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { student_id, status, severity, search } = req.query;
  let sql = RECORDS_BASE_SQL + ' WHERE 1=1';
  const params = [];

  if (student_id) { sql += ' AND dr.student_id = ?';       params.push(Number(student_id)); }
  if (status)     { sql += ' AND dr.status = ?';           params.push(status); }
  if (severity)   { sql += ' AND dr.severity_at_time = ?'; params.push(severity); }
  if (search) {
    const q = `%${search.toString().trim().toLowerCase()}%`;
    sql += ' AND (lower(s.name) LIKE ? OR lower(rl.title) LIKE ? OR lower(rl.rule_code) LIKE ?)';
    params.push(q, q, q);
  }
  sql += ' ORDER BY dr.incident_date DESC, dr.id DESC';
  res.json(db.prepare(sql).all(...params).map(enrichRecord));
});

// GET /api/discipline/records/:id
router.get('/records/:id', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const row = db.prepare(RECORDS_BASE_SQL + ' WHERE dr.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found.' });
  res.json(enrichRecord(row));
});

// POST /api/discipline/records
router.post('/records', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { student_id, rule_id, incident_date, location, details, action_taken, warning_level, parent_guardian_notified } = req.body;
  if (!student_id || !rule_id || !incident_date) {
    return res.status(400).json({ error: 'student_id, rule_id and incident_date are required.' });
  }

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(Number(student_id));
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const rule = db.prepare('SELECT * FROM disciplinary_rules WHERE id = ? AND active = 1').get(Number(rule_id));
  if (!rule) return res.status(404).json({ error: 'Rule not found or is inactive.' });

  const result = db.prepare(`
    INSERT INTO disciplinary_records
      (student_id, rule_id, incident_date, reported_by, location, details,
       severity_at_time, status, action_taken, warning_level, parent_guardian_notified)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    student_id, rule_id, incident_date, req.user.id,
    location  || null,
    details   || null,
    rule.severity,
    action_taken        || null,
    warning_level       ? Number(warning_level) : null,
    parent_guardian_notified ? 1 : 0,
  );

  audit(req.user.id, 'create', 'disciplinary_records', result.lastInsertRowid,
    `Violation recorded for student ${student_id}, rule ${rule.rule_code}`);

  const record = db.prepare(RECORDS_BASE_SQL + ' WHERE dr.id = ?').get(result.lastInsertRowid);
  res.status(201).json(enrichRecord(record));
});

// PUT /api/discipline/records/:id
router.put('/records/:id', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const existing = db.prepare('SELECT * FROM disciplinary_records WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Record not found.' });

  const { status, action_taken, warning_level, parent_guardian_notified, details, location } = req.body;
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  db.prepare(`
    UPDATE disciplinary_records
    SET status = ?, action_taken = ?, warning_level = ?,
        parent_guardian_notified = ?, details = ?, location = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    status                   !== undefined ? status                            : existing.status,
    action_taken             !== undefined ? (action_taken || null)            : existing.action_taken,
    warning_level            !== undefined ? (warning_level ? Number(warning_level) : null) : existing.warning_level,
    parent_guardian_notified !== undefined ? (parent_guardian_notified ? 1 : 0) : existing.parent_guardian_notified,
    details                  !== undefined ? (details || null)                 : existing.details,
    location                 !== undefined ? (location || null)                : existing.location,
    req.params.id,
  );
  audit(req.user.id, 'update', 'disciplinary_records', req.params.id,
    `Updated record status: ${status || existing.status}`);

  const updated = db.prepare(RECORDS_BASE_SQL + ' WHERE dr.id = ?').get(req.params.id);
  res.json(enrichRecord(updated));
});

// ── Student: own records ──────────────────────────────────────────────────────

// GET /api/discipline/me/records
router.get('/me/records', requireAuth, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only.' });
  const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) return res.status(404).json({ error: 'Student profile not found.' });

  const records = db.prepare(`
    SELECT dr.*,
           rl.rule_code, rl.title AS rule_title, rl.category AS rule_category,
           rl.description AS rule_description, rl.article_reference,
           u.name AS reported_by_name
    FROM disciplinary_records dr
    JOIN disciplinary_rules rl ON rl.id = dr.rule_id
    LEFT JOIN users u ON u.id = dr.reported_by
    WHERE dr.student_id = ?
    ORDER BY dr.incident_date DESC, dr.id DESC
  `).all(student.id).map(enrichRecord);

  res.json(records);
});

// POST /api/discipline/records/:id/acknowledge
router.post('/records/:id/acknowledge', requireAuth, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only.' });
  const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) return res.status(404).json({ error: 'Student profile not found.' });

  const record = db.prepare(
    'SELECT * FROM disciplinary_records WHERE id = ? AND student_id = ?'
  ).get(req.params.id, student.id);
  if (!record) return res.status(404).json({ error: 'Record not found.' });

  if (record.student_acknowledged_at) {
    return res.json({ already: true, acknowledged_at: record.student_acknowledged_at });
  }

  db.prepare(`
    UPDATE disciplinary_records
    SET student_acknowledged_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(req.params.id);

  audit(req.user.id, 'acknowledge', 'disciplinary_records', req.params.id,
    'Student acknowledged violation record');
  res.json({ acknowledged_at: new Date().toISOString() });
});

module.exports = router;
