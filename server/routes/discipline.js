const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_SEVERITIES = ['minor', 'moderate', 'serious'];
const VALID_STATUSES   = ['pending', 'reviewed', 'confirmed', 'resolved', 'appealed'];
const RULE_CSV_HEADERS = ['rule_code', 'title', 'category', 'article_reference', 'severity', 'default_action', 'description', 'active'];

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSeverity(value) {
  return normalizeText(value).toLowerCase();
}

function parseBooleanLike(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return 1;
  if (['0', 'false', 'no'].includes(normalized)) return 0;
  return null;
}

function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((col) => normalizeText(col) !== ''));
}

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

// POST /api/discipline/rules/import-csv
router.post('/rules/import-csv', requireAuth, requireRole('admin'), (req, res) => {
  const csvRaw = normalizeText(req.body?.csv);
  if (!csvRaw) return res.status(400).json({ error: 'CSV content is required in body.csv' });

  const rows = parseCsvRows(csvRaw);
  if (!rows.length) return res.status(400).json({ error: 'CSV appears empty.' });

  const headers = rows[0].map((h) => normalizeText(h).toLowerCase());
  if (headers.length !== RULE_CSV_HEADERS.length || !RULE_CSV_HEADERS.every((h, idx) => h === headers[idx])) {
    return res.status(400).json({
      error: `Invalid headers. Expected exactly: ${RULE_CSV_HEADERS.join(', ')}`,
      received_headers: headers,
    });
  }

  const errors = [];
  const seenRuleCodes = new Set();
  const parsedRows = [];

  for (let i = 1; i < rows.length; i += 1) {
    const rowNum = i + 1;
    const source = rows[i];
    const rowObj = {};
    headers.forEach((header, idx) => { rowObj[header] = source[idx] ?? ''; });

    const rowErrors = [];
    const ruleCode = normalizeText(rowObj.rule_code).toUpperCase();
    const title = normalizeText(rowObj.title);
    const category = normalizeText(rowObj.category);
    const articleReference = normalizeText(rowObj.article_reference) || null;
    const severity = normalizeSeverity(rowObj.severity);
    const defaultAction = normalizeText(rowObj.default_action) || null;
    const description = normalizeText(rowObj.description) || null;
    const active = parseBooleanLike(rowObj.active);

    if (!ruleCode) rowErrors.push('rule_code is required');
    if (!title) rowErrors.push('title is required');
    if (!category) rowErrors.push('category is required');
    if (!VALID_SEVERITIES.includes(severity)) rowErrors.push('severity must be minor, moderate, or serious');
    if (active === null) rowErrors.push('active must be true/false/1/0/yes/no');

    if (ruleCode) {
      if (seenRuleCodes.has(ruleCode)) rowErrors.push(`duplicate rule_code "${ruleCode}" in this upload`);
      seenRuleCodes.add(ruleCode);
    }

    if (rowErrors.length) {
      errors.push({ row: rowNum, rule_code: ruleCode || null, errors: rowErrors });
      continue;
    }

    parsedRows.push({
      rule_code: ruleCode,
      title,
      category,
      article_reference: articleReference,
      severity,
      default_action: defaultAction,
      description,
      active,
    });
  }

  const hasBlockingErrors = errors.some((e) => e.errors.some((msg) => msg.startsWith('duplicate rule_code')));
  if (hasBlockingErrors) {
    return res.status(400).json({
      error: 'Upload contains duplicate rule_code values in the same CSV.',
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: errors.length,
      row_errors: errors,
    });
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const insertStmt = db.prepare(`
    INSERT INTO disciplinary_rules
      (rule_code, title, category, article_reference, severity, default_action, description, active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE disciplinary_rules
    SET title = ?, category = ?, article_reference = ?, severity = ?, default_action = ?,
        description = ?, active = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const tx = db.transaction((records) => {
    for (const row of records) {
      const existing = db.prepare('SELECT * FROM disciplinary_rules WHERE rule_code = ?').get(row.rule_code);
      if (!existing) {
        insertStmt.run(
          row.rule_code, row.title, row.category, row.article_reference,
          row.severity, row.default_action, row.description, row.active, req.user.id,
        );
        inserted += 1;
        continue;
      }

      const changed = (
        existing.title !== row.title
        || existing.category !== row.category
        || (existing.article_reference || null) !== row.article_reference
        || existing.severity !== row.severity
        || (existing.default_action || null) !== row.default_action
        || (existing.description || null) !== row.description
        || Number(existing.active) !== Number(row.active)
      );

      if (!changed) {
        skipped += 1;
        continue;
      }

      updateStmt.run(
        row.title, row.category, row.article_reference, row.severity,
        row.default_action, row.description, row.active, existing.id,
      );
      updated += 1;
    }
  });

  tx(parsedRows);
  if (parsedRows.length) {
    audit(
      req.user.id,
      'import',
      'disciplinary_rules',
      null,
      `CSV import: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${errors.length} row errors`,
    );
  }

  res.json({
    inserted,
    updated,
    skipped,
    errors: errors.length,
    row_errors: errors,
    total_rows: rows.length - 1,
    processed_rows: parsedRows.length,
  });
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

// GET /api/discipline/students/:studentId/records
router.get('/students/:studentId/records', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const studentId = Number(req.params.studentId);
  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const records = db.prepare(
    `${RECORDS_BASE_SQL} WHERE dr.student_id = ? ORDER BY dr.incident_date DESC, dr.id DESC`,
  ).all(studentId).map(enrichRecord);
  res.json(records);
});

// GET /api/discipline/records/:id
router.get('/records/:id', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const row = db.prepare(RECORDS_BASE_SQL + ' WHERE dr.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found.' });
  res.json(enrichRecord(row));
});

// POST /api/discipline/records
router.post('/records', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { student_id, rule_id, incident_date, location, details, action_taken, warning_level, parent_guardian_notified, attachment_url, attachment_path } = req.body;
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
       severity_at_time, status, action_taken, warning_level, parent_guardian_notified, attachment)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    student_id, rule_id, incident_date, req.user.id,
    location  || null,
    details   || null,
    rule.severity,
    action_taken        || null,
    warning_level       ? Number(warning_level) : null,
    parent_guardian_notified ? 1 : 0,
    normalizeText(attachment_url || attachment_path) || null,
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

  const { status, action_taken, warning_level, parent_guardian_notified, details, location, attachment_url, attachment_path } = req.body;
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  db.prepare(`
    UPDATE disciplinary_records
    SET status = ?, action_taken = ?, warning_level = ?,
        parent_guardian_notified = ?, details = ?, location = ?, attachment = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    status                   !== undefined ? status                            : existing.status,
    action_taken             !== undefined ? (action_taken || null)            : existing.action_taken,
    warning_level            !== undefined ? (warning_level ? Number(warning_level) : null) : existing.warning_level,
    parent_guardian_notified !== undefined ? (parent_guardian_notified ? 1 : 0) : existing.parent_guardian_notified,
    details                  !== undefined ? (details || null)                 : existing.details,
    location                 !== undefined ? (location || null)                : existing.location,
    (attachment_url !== undefined || attachment_path !== undefined)
      ? (normalizeText(attachment_url || attachment_path) || null)
      : existing.attachment,
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
