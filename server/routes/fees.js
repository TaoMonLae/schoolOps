const express = require('express');
const PDFDoc = require('pdfkit');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSettings } = require('../services/settings');
const { generateUnpaidFeeReminderBatch } = require('../services/notifications');
const { drawPdfLogo, getPdfThemeTokens } = require('../services/pdfBranding');
const { assertPeriodOpen } = require('../services/financeControls');

const router = express.Router();
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const COUNCIL_FEE_PERMISSION_MAP = {
  treasurer: ['fees.view', 'fees.record_payment', 'fees.upload_proof', 'fees.view_schoolwide_summary', 'fees.view_followups'],
  president: ['fees.view', 'fees.approve_payment', 'fees.view_schoolwide_summary', 'fees.view_followups'],
  secretary: ['fees.view', 'fees.view_schoolwide_summary', 'fees.view_followups', 'fees.manage_followups'],
  boys_hostel_monitor: ['fees.view_hostel_scope', 'fees.view_followups', 'fees.manage_followups'],
  girls_hostel_monitor: ['fees.view_hostel_scope', 'fees.view_followups', 'fees.manage_followups'],
};

function getLinkedStudentId(userId) {
  const row = db.prepare('SELECT id FROM students WHERE user_id = ?').get(userId);
  return row?.id || null;
}

function getCurrentCouncilRole(studentId) {
  if (!studentId) return null;
  const row = db.prepare(`
    SELECT council_role
    FROM council_assignments
    WHERE student_id = ?
      AND active = 1
      AND date(start_date) <= date('now')
      AND (end_date IS NULL OR date(end_date) >= date('now'))
    ORDER BY date(start_date) DESC, id DESC
    LIMIT 1
  `).get(studentId);
  return row?.council_role || null;
}

function getFeeAccessContext(req) {
  if (req.feeAccessContext) return req.feeAccessContext;
  const linkedStudentId = getLinkedStudentId(req.user.id);
  const councilRole = getCurrentCouncilRole(linkedStudentId);
  const isStaff = req.user.role === 'admin' || req.user.role === 'teacher';
  const permissions = new Set(isStaff ? [
    'fees.view',
    'fees.record_payment',
    'fees.upload_proof',
    'fees.approve_payment',
    'fees.view_followups',
    'fees.manage_followups',
    'fees.view_hostel_scope',
    'fees.view_schoolwide_summary',
  ] : (COUNCIL_FEE_PERMISSION_MAP[councilRole] || []));
  req.feeAccessContext = { isStaff, linkedStudentId, councilRole, permissions };
  return req.feeAccessContext;
}

function hasFeePermission(req, permission) {
  return getFeeAccessContext(req).permissions.has(permission);
}

function requireFeePermission(...permissions) {
  return (req, res, next) => {
    const allowed = permissions.some((permission) => hasFeePermission(req, permission));
    if (!allowed) return res.status(403).json({ error: 'Insufficient fee permissions.' });
    return next();
  };
}

function hostelScopeForRole(role) {
  if (role === 'boys_hostel_monitor') return 'boys_hostel';
  if (role === 'girls_hostel_monitor') return 'girls_hostel';
  return null;
}

function sqlInPlaceholders(values) {
  return values.map(() => '?').join(',');
}

function formatMoney(currency, amount) {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

function paymentReceiptCode(payment) {
  return `RCP-${payment.period_year}${String(payment.period_month).padStart(2, '0')}-${String(payment.id).padStart(6, '0')}`;
}

function paymentVerificationCode(payment) {
  return `VER-${String(payment.id).padStart(6, '0')}-${payment.period_year}${String(payment.period_month).padStart(2, '0')}`;
}

// GET /api/fees — all payments, filterable by ?month=&year=&student_id=
router.get('/', requireAuth, requireFeePermission('fees.view', 'fees.view_hostel_scope'), (req, res) => {
  const access = getFeeAccessContext(req);
  const { month, year, student_id } = req.query;
  let sql = `
    SELECT fp.*, s.name AS student_name, s.gender, s.hostel_status, u.name AS received_by_name
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.voided = 0
  `;
  const params = [];
  if (month) {
    const m = Number.parseInt(month, 10);
    if (!Number.isInteger(m) || m < 1 || m > 12)
      return res.status(400).json({ error: 'month must be between 1 and 12' });
    sql += ' AND fp.period_month = ?';
    params.push(m);
  }
  if (year) {
    const y = Number.parseInt(year, 10);
    if (!Number.isInteger(y) || y < 2000 || y > 2100)
      return res.status(400).json({ error: 'year must be between 2000 and 2100' });
    sql += ' AND fp.period_year = ?';
    params.push(y);
  }
  if (student_id) {
    const sid = Number.parseInt(student_id, 10);
    if (!Number.isInteger(sid) || sid <= 0)
      return res.status(400).json({ error: 'student_id must be a positive integer' });
    sql += ' AND fp.student_id = ?';
    params.push(sid);
  }
  if (!hasFeePermission(req, 'fees.view')) {
    const hostelScope = hostelScopeForRole(access.councilRole);
    const gender = hostelScope === 'boys_hostel' ? 'male' : 'female';
    sql += " AND s.hostel_status = 'boarder' AND s.gender = ?";
    params.push(gender);
  }
  sql += ' ORDER BY fp.paid_date DESC';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/fees/:id — payment details
router.get('/:id(\\d+)', requireAuth, requireFeePermission('fees.view', 'fees.view_hostel_scope'), (req, res) => {
  const access = getFeeAccessContext(req);
  const payment = db.prepare(`
    SELECT fp.*, s.name AS student_name, s.gender, s.hostel_status, u.name AS received_by_name
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.id = ? AND fp.voided = 0
  `).get(req.params.id);

  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (!hasFeePermission(req, 'fees.view')) {
    const hostelScope = hostelScopeForRole(access.councilRole);
    const allowedGender = hostelScope === 'boys_hostel' ? 'male' : 'female';
    if (payment.hostel_status !== 'boarder' || payment.gender !== allowedGender) {
      return res.status(403).json({ error: 'Payment is outside your hostel scope.' });
    }
  }
  res.json({
    ...payment,
    receipt_code: paymentReceiptCode(payment),
    verification_code: paymentVerificationCode(payment),
  });
});

// GET /api/fees/verify/:code — verify receipt verification code
router.get('/verify/:code', requireAuth, requireFeePermission('fees.view', 'fees.view_hostel_scope'), (req, res) => {
  const access = getFeeAccessContext(req);
  const rawCode = String(req.params.code || '').trim().toUpperCase();
  const match = /^VER-(\d{6})-(\d{4})(\d{2})$/.exec(rawCode);
  if (!match) return res.status(400).json({ error: 'Invalid verification code format' });

  const paymentId = Number(match[1]);
  const year = Number(match[2]);
  const month = Number(match[3]);

  const payment = db.prepare(`
    SELECT fp.*, s.name AS student_name, s.gender, s.hostel_status, u.name AS received_by_name
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.id = ? AND fp.voided = 0
  `).get(paymentId);

  if (!payment) return res.status(404).json({ error: 'No payment found for this verification code' });
  if (!hasFeePermission(req, 'fees.view')) {
    const hostelScope = hostelScopeForRole(access.councilRole);
    const allowedGender = hostelScope === 'boys_hostel' ? 'male' : 'female';
    if (payment.hostel_status !== 'boarder' || payment.gender !== allowedGender) {
      return res.status(403).json({ error: 'Payment is outside your hostel scope.' });
    }
  }
  if (payment.period_year !== year || payment.period_month !== month) {
    return res.status(404).json({ error: 'Verification code does not match payment period' });
  }

  return res.json({
    valid: true,
    id: payment.id,
    student_name: payment.student_name,
    amount: payment.amount,
    paid_date: payment.paid_date,
    period_month: payment.period_month,
    period_year: payment.period_year,
    method: payment.method,
    receipt_code: paymentReceiptCode(payment),
    verification_code: paymentVerificationCode(payment),
  });
});

// GET /api/fees/student/:id — per-student payment history
router.get('/student/:id', requireAuth, requireFeePermission('fees.view', 'fees.view_hostel_scope'), (req, res) => {
  const access = getFeeAccessContext(req);
  const student = db.prepare('SELECT id, gender, hostel_status FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (!hasFeePermission(req, 'fees.view')) {
    const hostelScope = hostelScopeForRole(access.councilRole);
    const allowedGender = hostelScope === 'boys_hostel' ? 'male' : 'female';
    if (student.hostel_status !== 'boarder' || student.gender !== allowedGender) {
      return res.status(403).json({ error: 'Student is outside your hostel scope.' });
    }
  }
  const rows = db.prepare(`
    SELECT fp.*, u.name AS received_by_name
    FROM fee_payments fp
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.student_id = ?
      AND fp.voided = 0
      AND fp.id IN (
        SELECT MAX(fp2.id)
        FROM fee_payments fp2
        WHERE fp2.student_id = fp.student_id
          AND fp2.voided = 0
        GROUP BY fp2.period_month, fp2.period_year
      )
    ORDER BY fp.period_year DESC, fp.period_month DESC
  `).all(req.params.id);
  res.json(rows);
});

// POST /api/fees — record payment
router.post('/', requireAuth, requireFeePermission('fees.record_payment'), (req, res) => {
  const { student_id, amount, paid_date, method, period_month, period_year, notes } = req.body;
  if (student_id == null || amount == null || !paid_date || period_month == null || period_year == null)
    return res.status(400).json({ error: 'student_id, amount, paid_date, period_month, period_year required' });

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return res.status(400).json({ error: 'Amount must be a positive number' });
  if (notes && notes.length > 500)
    return res.status(400).json({ error: 'Notes must be 500 characters or fewer' });

  const parsedMonth = Number(period_month);
  const parsedYear = Number(period_year);
  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12)
    return res.status(400).json({ error: 'period_month must be between 1 and 12' });
  if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100)
    return res.status(400).json({ error: 'period_year must be between 2000 and 2100' });

  const validMethods = ['cash', 'bank_transfer', 'online'];
  if (method && !validMethods.includes(method))
    return res.status(400).json({ error: 'Invalid payment method' });

  // Check student exists
  const student = db.prepare('SELECT id, name FROM students WHERE id = ?').get(student_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const closedError = assertPeriodOpen({ year: parsedYear, month: parsedMonth, action: 'posting fee payments' });
  if (closedError) return res.status(409).json({ error: closedError });

  let result;
  try {
    result = db.prepare(`
      INSERT INTO fee_payments
        (student_id, amount, paid_date, method, period_month, period_year, received_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      student_id, parsedAmount, paid_date, method || 'cash',
      parsedMonth, parsedYear, req.user.id, notes || null
    );
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Fee payment already exists for this student/month/year' });
    }
    throw err;
  }

  const currency = getSettings().currency || 'RM';
  audit(req.user.id, 'CREATE', 'fee_payments', result.lastInsertRowid,
    `Payment ${currency}${parsedAmount.toFixed(2)} for ${student.name} ${parsedMonth}/${parsedYear}`);

  generateUnpaidFeeReminderBatch({ actorId: req.user.id });

  res.status(201).json({ id: result.lastInsertRowid });
});

// GET /api/fees/council/summary — council fee workflow dashboard metrics
router.get('/council/summary', requireAuth, requireFeePermission('fees.view_schoolwide_summary', 'fees.view_hostel_scope'), (req, res) => {
  const access = getFeeAccessContext(req);
  const month = Number.parseInt(req.query.month || String(new Date().getMonth() + 1), 10);
  const year = Number.parseInt(req.query.year || String(new Date().getFullYear()), 10);

  let studentScopeWhere = '';
  const scopeParams = [];
  if (hasFeePermission(req, 'fees.view_hostel_scope') && !hasFeePermission(req, 'fees.view_schoolwide_summary')) {
    const hostelScope = hostelScopeForRole(access.councilRole);
    const gender = hostelScope === 'boys_hostel' ? 'male' : 'female';
    studentScopeWhere = " AND s.hostel_status = 'boarder' AND s.gender = ?";
    scopeParams.push(gender);
  }

  const paymentsAwaitingReview = db.prepare(`
    SELECT COUNT(*) AS count
    FROM fee_payments fp
    LEFT JOIN fee_payment_reviews fpr ON fpr.payment_id = fp.id
    WHERE fp.voided = 0
      AND fp.period_month = ?
      AND fp.period_year = ?
      AND fp.received_by IN (
        SELECT user_id
        FROM students
        WHERE id IN (
          SELECT student_id FROM council_assignments
          WHERE council_role = 'treasurer'
            AND active = 1
            AND date(start_date) <= date('now')
            AND (end_date IS NULL OR date(end_date) >= date('now'))
        )
      )
      AND fpr.id IS NULL
  `).get(month, year)?.count || 0;

  const disputedPayments = db.prepare(`
    SELECT COUNT(*) AS count
    FROM fee_payment_reviews
    WHERE decision IN ('rejected','needs_clarification')
  `).get()?.count || 0;

  const unpaidSummary = db.prepare(`
    SELECT
      COUNT(*) AS total_students,
      SUM(CASE WHEN p.id IS NULL THEN 1 ELSE 0 END) AS unpaid_students
    FROM students s
    LEFT JOIN fee_payments p
      ON p.student_id = s.id
      AND p.period_month = ?
      AND p.period_year = ?
      AND p.voided = 0
    WHERE s.status = 'active'
    ${studentScopeWhere}
  `).get(month, year, ...scopeParams);

  const missingProof = db.prepare(`
    SELECT COUNT(*) AS count
    FROM fee_payments fp
    WHERE fp.voided = 0
      AND fp.period_month = ?
      AND fp.period_year = ?
      AND (fp.notes IS NULL OR trim(fp.notes) = '')
  `).get(month, year)?.count || 0;

  const followupOpen = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM fee_followups
    GROUP BY status
  `).all();

  res.json({
    month,
    year,
    role: access.councilRole,
    permissions: Array.from(access.permissions),
    widgets: {
      pending_payments: unpaidSummary?.unpaid_students || 0,
      unpaid_students_overview: unpaidSummary?.unpaid_students || 0,
      payments_awaiting_review: paymentsAwaitingReview,
      disputed_payments: disputedPayments,
      missing_proof: missingProof,
      followups_by_status: followupOpen,
    },
  });
});

// GET /api/fees/council/followups
router.get('/council/followups', requireAuth, requireFeePermission('fees.view_followups'), (req, res) => {
  const access = getFeeAccessContext(req);
  const statuses = String(req.query.status || '').split(',').map((v) => v.trim()).filter(Boolean);
  const params = [];
  let where = ' WHERE 1=1 ';

  if (statuses.length) {
    where += ` AND ff.status IN (${sqlInPlaceholders(statuses)})`;
    params.push(...statuses);
  }

  if (access.councilRole === 'boys_hostel_monitor' || access.councilRole === 'girls_hostel_monitor') {
    const scope = hostelScopeForRole(access.councilRole);
    where += ' AND ff.hostel_scope = ?';
    params.push(scope);
  }

  const rows = db.prepare(`
    SELECT ff.*, s.name AS student_name, s.gender, s.level,
           cu.name AS created_by_user_name,
           cs.name AS created_by_student_name
    FROM fee_followups ff
    JOIN students s ON s.id = ff.student_id
    LEFT JOIN users cu ON cu.id = ff.created_by_user_id
    LEFT JOIN students cs ON cs.id = ff.created_by_student_id
    ${where}
    ORDER BY ff.created_at DESC
  `).all(...params);

  res.json(rows);
});

// POST /api/fees/council/followups
router.post('/council/followups', requireAuth, requireFeePermission('fees.manage_followups'), (req, res) => {
  const access = getFeeAccessContext(req);
  const studentId = Number.parseInt(req.body.student_id, 10);
  const followupType = String(req.body.followup_type || '').trim();
  const status = String(req.body.status || 'open').trim();
  const note = String(req.body.note || '').trim();
  const validTypes = ['reminder', 'student_contacted', 'guardian_contacted', 'payment_issue', 'escalation'];
  const validStatuses = ['open', 'done', 'escalated'];

  if (!Number.isInteger(studentId)) return res.status(400).json({ error: 'student_id is required.' });
  if (!validTypes.includes(followupType)) return res.status(400).json({ error: 'Invalid followup_type.' });
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (!note) return res.status(400).json({ error: 'note is required.' });

  const student = db.prepare('SELECT id, gender, hostel_status FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  let hostelScope = req.body.hostel_scope ? String(req.body.hostel_scope).trim() : null;
  if (access.councilRole === 'boys_hostel_monitor' || access.councilRole === 'girls_hostel_monitor') {
    hostelScope = hostelScopeForRole(access.councilRole);
    const expectedGender = hostelScope === 'boys_hostel' ? 'male' : 'female';
    if (student.hostel_status !== 'boarder' || student.gender !== expectedGender) {
      return res.status(403).json({ error: 'Student is outside your hostel scope.' });
    }
  }

  const result = db.prepare(`
    INSERT INTO fee_followups
      (student_id, hostel_scope, created_by_student_id, created_by_user_id, council_role, followup_type, note, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    studentId,
    hostelScope,
    access.linkedStudentId,
    req.user.id,
    access.councilRole || req.user.role,
    followupType,
    note,
    status
  );

  audit(req.user.id, 'CREATE', 'fee_followups', result.lastInsertRowid, `${access.councilRole || req.user.role} logged ${followupType}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch('/council/followups/:id(\\d+)', requireAuth, requireFeePermission('fees.manage_followups'), (req, res) => {
  const access = getFeeAccessContext(req);
  const row = db.prepare(`
    SELECT ff.*, s.gender, s.hostel_status
    FROM fee_followups ff
    JOIN students s ON s.id = ff.student_id
    WHERE ff.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Follow-up not found.' });

  if (access.councilRole === 'boys_hostel_monitor' || access.councilRole === 'girls_hostel_monitor') {
    const scope = hostelScopeForRole(access.councilRole);
    const expectedGender = scope === 'boys_hostel' ? 'male' : 'female';
    if (row.hostel_scope !== scope || row.gender !== expectedGender || row.hostel_status !== 'boarder') {
      return res.status(403).json({ error: 'Follow-up is outside your hostel scope.' });
    }
  }

  const updates = [];
  const params = [];
  if (req.body.note !== undefined) {
    const note = String(req.body.note || '').trim();
    if (!note) return res.status(400).json({ error: 'note cannot be empty.' });
    updates.push('note = ?');
    params.push(note);
  }
  if (req.body.status !== undefined) {
    const status = String(req.body.status || '').trim();
    if (!['open', 'done', 'escalated'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    updates.push('status = ?');
    params.push(status);
  }
  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update.' });
  updates.push('updated_at = datetime(\'now\')');

  db.prepare(`UPDATE fee_followups SET ${updates.join(', ')} WHERE id = ?`).run(...params, req.params.id);
  audit(req.user.id, 'UPDATE', 'fee_followups', req.params.id, `${access.councilRole || req.user.role} updated follow-up`);
  res.json({ ok: true });
});

router.post('/council/payments/:id(\\d+)/review', requireAuth, requireFeePermission('fees.approve_payment'), (req, res) => {
  const access = getFeeAccessContext(req);
  const payment = db.prepare('SELECT * FROM fee_payments WHERE id = ? AND voided = 0').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });

  const decision = String(req.body.decision || '').trim();
  if (!['approved', 'rejected', 'needs_clarification'].includes(decision)) {
    return res.status(400).json({ error: 'Invalid decision.' });
  }
  const notes = req.body.notes ? String(req.body.notes).trim() : null;

  const result = db.prepare(`
    INSERT INTO fee_payment_reviews
      (payment_id, reviewed_by_student_id, reviewed_by_user_id, review_role, decision, notes, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(payment.id, access.linkedStudentId, req.user.id, access.councilRole || req.user.role, decision, notes);

  audit(req.user.id, 'REVIEW', 'fee_payments', payment.id, `${access.councilRole || req.user.role} marked payment ${decision}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.get('/council/my-scope', requireAuth, requireFeePermission('fees.view_followups', 'fees.view_schoolwide_summary', 'fees.view_hostel_scope'), (req, res) => {
  const access = getFeeAccessContext(req);
  const hostelScope = hostelScopeForRole(access.councilRole);
  const students = hostelScope ? db.prepare(`
    SELECT id, name, gender, level, dorm_house, room
    FROM students
    WHERE hostel_status = 'boarder' AND gender = ?
    ORDER BY name
  `).all(hostelScope === 'boys_hostel' ? 'male' : 'female') : db.prepare(`
    SELECT id, name, gender, level, dorm_house, room
    FROM students
    WHERE status = 'active'
    ORDER BY name
    LIMIT 300
  `).all();

  res.json({
    linked_student_id: access.linkedStudentId,
    council_role: access.councilRole,
    permissions: Array.from(access.permissions),
    hostel_scope: hostelScope,
    scope_students: students,
  });
});

// GET /api/fees/:id/receipt/pdf — printable payment receipt
router.get('/:id(\\d+)/receipt/pdf', requireAuth, requireFeePermission('fees.view', 'fees.view_hostel_scope'), (req, res) => {
  const access = getFeeAccessContext(req);
  const payment = db.prepare(`
    SELECT fp.*, s.name AS student_name, s.gender, s.hostel_status, u.name AS received_by_name
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.id = ? AND fp.voided = 0
  `).get(req.params.id);

  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (!hasFeePermission(req, 'fees.view')) {
    const hostelScope = hostelScopeForRole(access.councilRole);
    const allowedGender = hostelScope === 'boys_hostel' ? 'male' : 'female';
    if (payment.hostel_status !== 'boarder' || payment.gender !== allowedGender) {
      return res.status(403).json({ error: 'Payment is outside your hostel scope.' });
    }
  }

  const settings = getSettings();
  const currency = settings.currency || 'RM';
  const receiptCode = paymentReceiptCode(payment);
  const verificationCode = paymentVerificationCode(payment);
  const duplicateCopy = (req.query.copy || '').toString().toLowerCase() === 'duplicate';
  const palette = getPdfThemeTokens(settings.theme);

  const filename = `Receipt_${receiptCode}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  const doc = new PDFDoc({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const schoolName = settings.school_name || 'School';
  const subtitle = settings.subtitle || '';
  const contactBlock = settings.contact_block || '';
  const paidDate = payment.paid_date;
  const periodLabel = `${MONTHS[payment.period_month - 1]} ${payment.period_year}`;

  doc.rect(0, 0, doc.page.width, doc.page.height).fill(palette.pageBg);
  doc.rect(0, 0, doc.page.width, 88).fill(palette.header);
  const titleX = drawPdfLogo(doc, settings.logo_url, { x: 50, y: 18, size: 46, background: palette.pageBg }) || 50;
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(schoolName, titleX, 22);
  doc.font('Helvetica').fontSize(11).text(subtitle || 'Payment Receipt', titleX, 48);
  doc.font('Helvetica-Bold').fontSize(13).text('OFFICIAL FEE PAYMENT RECEIPT', titleX, 65);

  doc.fillColor(palette.text);
  let y = 108;
  doc.save();
  doc.roundedRect(50, 95, doc.page.width - 100, 4, 2).fill(palette.accent);
  doc.restore();


  if (duplicateCopy) {
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.fillColor(palette.watermark).opacity(0.16).font('Helvetica-Bold').fontSize(72)
      .text('DUPLICATE COPY', 65, 360, { align: 'center', width: doc.page.width - 130 });
    doc.restore();
    doc.fillColor(palette.text).opacity(1);
  }

  doc.roundedRect(50, y, doc.page.width - 100, 120, 8).fillAndStroke(palette.cardBg, palette.cardBorder);
  doc.fillColor(palette.text).font('Helvetica-Bold').fontSize(11).text('Receipt Information', 64, y + 14);
  doc.font('Helvetica').fontSize(10)
    .text(`Receipt No: ${receiptCode}`, 64, y + 38)
    .text(`Verification Code: ${verificationCode}`, 64, y + 56)
    .text(`Payment Date: ${paidDate}`, 64, y + 74)
    .text(`Payment Period: ${periodLabel}`, 64, y + 92);
  doc.font('Helvetica').fontSize(10)
    .text(`Method: ${String(payment.method || 'cash').replace('_', ' ').toUpperCase()}`, 320, y + 38)
    .text(`Received By: ${payment.received_by_name || 'N/A'}`, 320, y + 56)
    .text(`Amount Paid: ${formatMoney(currency, payment.amount)}`, 320, y + 74);

  y += 145;
  doc.roundedRect(50, y, doc.page.width - 100, 145, 8).fillAndStroke(palette.cardBg, palette.cardBorder);
  doc.fillColor(palette.text).font('Helvetica-Bold').fontSize(11).text('Payer Details', 64, y + 14);
  doc.font('Helvetica').fontSize(10)
    .text(`Student: ${payment.student_name}`, 64, y + 40)
    .text(`Coverage Month/Year: ${periodLabel}`, 64, y + 58)
    .text(`Notes: ${payment.notes || '—'}`, 64, y + 76, { width: doc.page.width - 130 });

  y += 170;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(palette.cardBorder).stroke();
  y += 12;
  doc.fillColor(palette.muted).font('Helvetica').fontSize(9)
    .text(contactBlock || 'Contact information is configured in Settings.', 50, y, { width: doc.page.width - 100, align: 'left' });
  y += 30;
  doc.text(settings.report_footer_text || 'Generated by SchoolOps', 50, y, { width: doc.page.width - 100, align: 'center' });

  doc.end();
});

// DELETE /api/fees/:id — void payment (admin only)
router.delete('/:id(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const payment = db.prepare('SELECT * FROM fee_payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.voided) return res.status(400).json({ error: 'Already voided' });
  const { void_reason } = req.body;
  if (!void_reason || !String(void_reason).trim())
    return res.status(400).json({ error: 'Void reason is required' });
  const closedError = assertPeriodOpen({
    year: payment.period_year,
    month: payment.period_month,
    action: 'voiding fee payments',
  });
  if (closedError) return res.status(409).json({ error: closedError });

  db.prepare(`
    UPDATE fee_payments
    SET voided = 1, void_reason = ?, voided_by = ?, voided_at = datetime('now')
    WHERE id = ?
  `).run(String(void_reason).trim(), req.user.id, req.params.id);
  audit(req.user.id, 'VOID', 'fee_payments', req.params.id, `Voided payment ${req.params.id}: ${String(void_reason).trim()}`);
  res.json({ ok: true });
});

module.exports = router;
