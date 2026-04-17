const express = require('express');
const PDFDoc = require('pdfkit');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { buildArrearsRecords } = require('../services/arrears');
const { getSettings } = require('../services/settings');
const { createNotification } = require('../services/notifications');
const { multipartUpload } = require('../middleware/multipartUpload');
const { drawPdfLogo, getPdfThemeTokens } = require('../services/pdfBranding');
const { buildPatchUpdate } = require('../services/patch');

const router = express.Router();
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const CONTACT_TYPES = ['parent', 'guardian', 'emergency_contact', 'sponsor_other'];
const HOSTEL_STATUSES = ['boarder', 'non_boarder', 'inactive'];

function formatMoney(currency, amount) {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

function resolvePeriod(req) {
  const now = new Date();
  const parsedMonth = Number.parseInt(req.query.month, 10);
  const parsedYear = Number.parseInt(req.query.year, 10);
  return {
    month: Number.isNaN(parsedMonth) ? now.getMonth() + 1 : parsedMonth,
    year: Number.isNaN(parsedYear) ? now.getFullYear() : parsedYear,
  };
}

function mapContactRow(row) {
  return {
    ...row,
    emergency_contact: !!row.emergency_contact,
    preferred_contact: !!row.preferred_contact,
    is_active: !!row.is_active,
  };
}

function normalizeContactPayload(payload = {}) {
  return {
    contact_name: (payload.contact_name || '').toString().trim(),
    relationship: payload.relationship ? payload.relationship.toString().trim() : null,
    contact_type: (payload.contact_type || 'parent').toString().trim(),
    phone: payload.phone ? payload.phone.toString().trim() : null,
    whatsapp: payload.whatsapp ? payload.whatsapp.toString().trim() : null,
    address: payload.address ? payload.address.toString().trim() : null,
    emergency_contact: payload.emergency_contact ? 1 : 0,
    preferred_contact: payload.preferred_contact ? 1 : 0,
    is_active: payload.is_active === false ? 0 : 1,
    notes: payload.notes ? payload.notes.toString().trim() : null,
  };
}

// GET /api/students — list with current-month fee and arrears status
router.get('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = resolvePeriod(req);
  res.json(buildArrearsRecords(month, year));
});

// GET /api/students/arrears?month=&year=&status=current|overdue|serious&search=
router.get('/arrears', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = resolvePeriod(req);
  const { status, search } = req.query;

  let rows = buildArrearsRecords(month, year, { activeOnly: true });

  if (status && ['current', 'overdue', 'serious'].includes(status)) {
    rows = rows.filter((r) => r.arrears_status === status);
  }

  const q = (search || '').toString().trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => (
      r.name.toLowerCase().includes(q) ||
      r.level.toLowerCase().includes(q) ||
      (r.main_contact_name || '').toLowerCase().includes(q) ||
      (r.main_contact_phone || '').toLowerCase().includes(q)
    ));
  }

  res.json(rows);
});

// GET /api/students/contacts/search?search=
router.get('/contacts/search', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const q = `%${(req.query.search || '').toString().trim().toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT c.*, s.name AS student_name, s.level AS student_level, s.status AS student_status
    FROM student_contacts c
    JOIN students s ON s.id = c.student_id
    WHERE (
      lower(s.name) LIKE ?
      OR lower(c.contact_name) LIKE ?
      OR lower(COALESCE(c.phone, '')) LIKE ?
      OR lower(COALESCE(c.whatsapp, '')) LIKE ?
    )
    ORDER BY s.name, c.preferred_contact DESC, c.emergency_contact DESC, c.contact_name
    LIMIT 250
  `).all(q, q, q, q);
  res.json(rows.map(mapContactRow));
});

// ─── Excel helpers ────────────────────────────────────────────────────────────
const IMPORT_HEADERS = [
  'Name', 'Gender', 'Level', 'Enroll Date (YYYY-MM-DD)',
  'Fee Amount', 'Fee Frequency', 'Status', 'Hostel Status',
  'Dorm House', 'Room', 'Bed Number', 'Notes',
];

const IMPORT_COL_WIDTHS = [
  { wch: 26 }, { wch: 8 }, { wch: 14 }, { wch: 22 },
  { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
  { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 28 },
];

function parseExcelDate(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'number') {
    // XLSX serial date → JS Date
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  return String(val).trim();
}

// GET /api/students/export/template — blank import template
router.get('/export/template', requireAuth, requireRole('admin'), (req, res) => {
  const wb = XLSX.utils.book_new();
  const example = [
    'Ahmad bin Ali', 'male', 'Tahfiz 1', '2025-01-15',
    200, 'monthly', 'active', 'boarder',
    'House A', '2B', '12', 'Optional notes',
  ];
  const ws = XLSX.utils.aoa_to_sheet([IMPORT_HEADERS, example]);
  ws['!cols'] = IMPORT_COL_WIDTHS;
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="Student_Import_Template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/students/export/excel — export all students
router.get('/export/excel', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const students = db.prepare('SELECT * FROM students ORDER BY name').all();
  const wb = XLSX.utils.book_new();
  const rows = students.map((s) => [
    s.name, s.gender, s.level, s.enroll_date,
    s.fee_amount, s.fee_frequency, s.status, s.hostel_status || 'non_boarder',
    s.dorm_house || '', s.room || '', s.bed_number || '', s.notes || '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([IMPORT_HEADERS, ...rows]);
  ws['!cols'] = IMPORT_COL_WIDTHS;
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `Students_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// POST /api/students/import — bulk import from Excel
router.post(
  '/import',
  requireAuth,
  requireRole('admin'),
  multipartUpload({ fileField: 'file', maxFileSize: 5 * 1024 * 1024 }),
  (req, res) => {
    const file = req.uploadedFile;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    let wb;
    try {
      wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
    } catch {
      return res.status(400).json({ error: 'Could not read file — make sure it is a valid .xlsx or .xls file' });
    }

    const sheetName = wb.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'Excel file has no sheets' });

    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (data.length < 2) return res.status(400).json({ error: 'No data rows found. Row 1 must be headers, data starts at row 2.' });

    const results = { imported: 0, skipped: 0, errors: [] };

    const insertStmt = db.prepare(`
      INSERT INTO students (name, gender, level, enroll_date, fee_amount, fee_frequency, status, dorm_house, room, bed_number, hostel_status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowNum = i + 1;

        const name = String(row[0] || '').trim();
        const gender = String(row[1] || 'male').trim().toLowerCase();
        const level = String(row[2] || '').trim();
        const enrollDateStr = parseExcelDate(row[3]);
        const feeAmount = Number.parseFloat(row[4]) || 0;
        const feeFrequency = String(row[5] || 'monthly').trim().toLowerCase();
        const status = String(row[6] || 'active').trim().toLowerCase();
        const hostelStatus = String(row[7] || 'non_boarder').trim().toLowerCase().replace(/ /g, '_');
        const dormHouse = String(row[8] || '').trim() || null;
        const room = String(row[9] || '').trim() || null;
        const bedNumber = String(row[10] || '').trim() || null;
        const notes = String(row[11] || '').trim() || null;

        // Skip empty rows silently
        if (!name && !level) { results.skipped++; continue; }

        const rowErrors = [];
        if (!name) rowErrors.push('Name is required');
        if (!level) rowErrors.push('Level/Class is required');
        if (!['male', 'female'].includes(gender)) rowErrors.push(`Invalid gender "${gender}" — use: male or female`);
        if (!['monthly', 'yearly', 'one-time'].includes(feeFrequency)) rowErrors.push(`Invalid fee frequency "${feeFrequency}" — use: monthly, yearly, or one-time`);
        if (!['active', 'inactive'].includes(status)) rowErrors.push(`Invalid status "${status}" — use: active or inactive`);
        if (!HOSTEL_STATUSES.includes(hostelStatus)) rowErrors.push(`Invalid hostel status "${hostelStatus}" — use: boarder, non_boarder, or inactive`);
        if (!enrollDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(enrollDateStr)) rowErrors.push(`Invalid enroll date "${enrollDateStr}" — use YYYY-MM-DD format`);
        if (feeAmount < 0) rowErrors.push('Fee Amount cannot be negative');

        if (rowErrors.length) {
          results.errors.push({ row: rowNum, name: name || '(empty)', errors: rowErrors });
          results.skipped++;
          continue;
        }

        insertStmt.run(name, gender, level, enrollDateStr, feeAmount, feeFrequency, status, dormHouse, room, bedNumber, hostelStatus, notes);
        results.imported++;
      }
    });

    tx();

    if (results.imported > 0) {
      audit(req.user.id, 'IMPORT', 'students', null, `Bulk imported ${results.imported} student(s) from Excel`);
    }

    res.json(results);
  },
);

// GET /api/students/:id/fee-slip/pdf?month=&year=
router.get('/:id(\\d+)/fee-slip/pdf', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = resolvePeriod(req);
  const studentId = Number.parseInt(req.params.id, 10);
  const records = buildArrearsRecords(month, year, { activeOnly: false });
  const student = records.find(r => r.id === studentId);

  if (!student) return res.status(404).json({ error: 'Student not found' });

  const settings = getSettings();
  const currency = settings.currency || 'RM';
  const monthLabel = `${MONTHS[month - 1]} ${year}`;
  const filename = `Fee_Slip_${student.name.replace(/\s+/g, '_')}_${year}_${String(month).padStart(2, '0')}.pdf`;
  const palette = getPdfThemeTokens(settings.theme);

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  const doc = new PDFDoc({ margin: 50, size: 'A4' });
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, doc.page.height).fill(palette.pageBg);
  doc.rect(0, 0, doc.page.width, 88).fill(palette.header);
  const titleX = drawPdfLogo(doc, settings.logo_url, { x: 50, y: 18, size: 46, background: palette.pageBg }) || 50;
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(settings.school_name || 'School', titleX, 24);
  doc.font('Helvetica').fontSize(11).text('Fee Payment Slip / Billing Notice', titleX, 50);
  doc.save();
  doc.roundedRect(50, 95, doc.page.width - 100, 4, 2).fill(palette.accent);
  doc.restore();

  let y = 108;
  doc.roundedRect(50, y, doc.page.width - 100, 180, 8).fillAndStroke(palette.cardBg, palette.cardBorder);
  doc.fillColor(palette.text).font('Helvetica-Bold').fontSize(12).text('Student Billing Summary', 64, y + 16);
  doc.font('Helvetica').fontSize(10)
    .text(`Student Name: ${student.name}`, 64, y + 44)
    .text(`Billing Period: ${monthLabel}`, 64, y + 62)
    .text(`Amount Due (Current Month): ${formatMoney(currency, student.fee_amount)}`, 64, y + 80)
    .text(`Overdue Months: ${student.overdue_months}`, 64, y + 98)
    .text(`Outstanding Total: ${formatMoney(currency, student.outstanding_amount)}`, 64, y + 116)
    .text(`Status: ${student.arrears_status.toUpperCase()}`, 64, y + 134);

  y += 205;
  doc.roundedRect(50, y, doc.page.width - 100, 95, 8).fillAndStroke(palette.cardBg, palette.cardBorder);
  doc.fillColor(palette.text).font('Helvetica-Bold').fontSize(11).text('School Contact', 64, y + 14);
  doc.font('Helvetica').fontSize(10).text(
    settings.contact_block || 'Please update contact details in Settings > Branding.',
    64,
    y + 36,
    { width: doc.page.width - 130 }
  );

  y += 120;
  doc.font('Helvetica').fontSize(9).fillColor(palette.muted)
    .text('Please present this slip when making payment. Thank you for your prompt attention.', 50, y, { width: doc.page.width - 100, align: 'center' })
    .text(settings.report_footer_text || 'Generated by SchoolOps', 50, y + 18, { width: doc.page.width - 100, align: 'center' });

  doc.end();
});

// GET /api/students/:id
router.get('/:id(\\d+)', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json(student);
});

// GET /api/students/:id/contacts
router.get('/:id(\\d+)/contacts', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const rows = db.prepare(`
    SELECT *
    FROM student_contacts
    WHERE student_id = ?
    ORDER BY is_active DESC, preferred_contact DESC, emergency_contact DESC, contact_name
  `).all(req.params.id);

  res.json(rows.map(mapContactRow));
});

// POST /api/students/:id/contacts
router.post('/:id(\\d+)/contacts', requireAuth, requireRole('admin'), (req, res) => {
  const student = db.prepare('SELECT id, name FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const payload = normalizeContactPayload(req.body);
  if (!payload.contact_name) return res.status(400).json({ error: 'contact_name is required' });
  if (!CONTACT_TYPES.includes(payload.contact_type)) return res.status(400).json({ error: 'Invalid contact_type' });

  const tx = db.transaction(() => {
    if (payload.preferred_contact) {
      db.prepare('UPDATE student_contacts SET preferred_contact = 0, updated_at = datetime(\'now\') WHERE student_id = ?').run(req.params.id);
    }
    return db.prepare(`
      INSERT INTO student_contacts (
        student_id, contact_name, relationship, contact_type, phone, whatsapp, address,
        emergency_contact, preferred_contact, is_active, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      req.params.id,
      payload.contact_name,
      payload.relationship,
      payload.contact_type,
      payload.phone,
      payload.whatsapp,
      payload.address,
      payload.emergency_contact,
      payload.preferred_contact,
      payload.is_active,
      payload.notes,
    );
  });

  const result = tx();
  audit(req.user.id, 'CREATE', 'student_contacts', result.lastInsertRowid, `Added contact for student ${student.name}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/students/:id/contacts/:contactId
router.put('/:id(\\d+)/contacts/:contactId(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const existing = db.prepare(`
    SELECT c.id, c.student_id, s.name AS student_name
    FROM student_contacts c
    JOIN students s ON s.id = c.student_id
    WHERE c.id = ? AND c.student_id = ?
  `).get(req.params.contactId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  const payload = normalizeContactPayload(req.body);
  if (!payload.contact_name) return res.status(400).json({ error: 'contact_name is required' });
  if (!CONTACT_TYPES.includes(payload.contact_type)) return res.status(400).json({ error: 'Invalid contact_type' });

  const tx = db.transaction(() => {
    if (payload.preferred_contact) {
      db.prepare(`
        UPDATE student_contacts
        SET preferred_contact = 0, updated_at = datetime('now')
        WHERE student_id = ? AND id != ?
      `).run(req.params.id, req.params.contactId);
    }
    db.prepare(`
      UPDATE student_contacts
      SET contact_name = ?,
          relationship = ?,
          contact_type = ?,
          phone = ?,
          whatsapp = ?,
          address = ?,
          emergency_contact = ?,
          preferred_contact = ?,
          is_active = ?,
          notes = ?,
          updated_at = datetime('now')
      WHERE id = ? AND student_id = ?
    `).run(
      payload.contact_name,
      payload.relationship,
      payload.contact_type,
      payload.phone,
      payload.whatsapp,
      payload.address,
      payload.emergency_contact,
      payload.preferred_contact,
      payload.is_active,
      payload.notes,
      req.params.contactId,
      req.params.id,
    );
  });

  tx();
  audit(req.user.id, 'UPDATE', 'student_contacts', req.params.contactId, `Updated contact for student ${existing.student_name}`);
  res.json({ ok: true });
});

// DELETE /api/students/:id/contacts/:contactId — soft deactivate contact
router.delete('/:id(\\d+)/contacts/:contactId(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const existing = db.prepare(`
    SELECT c.id, c.contact_name, s.name AS student_name
    FROM student_contacts c
    JOIN students s ON s.id = c.student_id
    WHERE c.id = ? AND c.student_id = ?
  `).get(req.params.contactId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  db.prepare(`
    UPDATE student_contacts
    SET is_active = 0, preferred_contact = 0, updated_at = datetime('now')
    WHERE id = ? AND student_id = ?
  `).run(req.params.contactId, req.params.id);
  audit(req.user.id, 'DEACTIVATE', 'student_contacts', req.params.contactId, `Deactivated contact ${existing.contact_name} for student ${existing.student_name}`);
  res.json({ ok: true });
});

// POST /api/students — enroll
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { name, gender, level, enroll_date, fee_amount, fee_frequency, notes, dorm_house, room, bed_number, hostel_status } = req.body;
  if (!name || !gender || !level || !enroll_date)
    return res.status(400).json({ error: 'name, gender, level, enroll_date required' });
  if (name && name.length > 150)
    return res.status(400).json({ error: 'Name must be 150 characters or fewer' });
  if (notes && notes.length > 1000)
    return res.status(400).json({ error: 'Notes must be 1000 characters or fewer' });
  if (dorm_house && dorm_house.length > 100)
    return res.status(400).json({ error: 'Dorm house must be 100 characters or fewer' });
  if (hostel_status && !HOSTEL_STATUSES.includes(hostel_status)) {
    return res.status(400).json({ error: 'Invalid hostel_status' });
  }

  const result = db.prepare(`
    INSERT INTO students (name, gender, level, enroll_date, fee_amount, fee_frequency, status, dorm_house, room, bed_number, hostel_status, notes)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `).run(
    name,
    gender,
    level,
    enroll_date,
    fee_amount || 0,
    fee_frequency || 'monthly',
    dorm_house || null,
    room || null,
    bed_number || null,
    hostel_status || 'non_boarder',
    notes || null,
  );

  audit(req.user.id, 'CREATE', 'students', result.lastInsertRowid, `Enrolled ${name}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/students/:id — update
router.put('/:id(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const { name, gender, level, enroll_date, fee_amount, fee_frequency, status, notes, dorm_house, room, bed_number, hostel_status } = req.body;
  const existing = db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Student not found' });
  if (name && name.length > 150)
    return res.status(400).json({ error: 'Name must be 150 characters or fewer' });
  if (notes && notes.length > 1000)
    return res.status(400).json({ error: 'Notes must be 1000 characters or fewer' });
  if (dorm_house && dorm_house.length > 100)
    return res.status(400).json({ error: 'Dorm house must be 100 characters or fewer' });
  if (hostel_status && !HOSTEL_STATUSES.includes(hostel_status)) {
    return res.status(400).json({ error: 'Invalid hostel_status' });
  }

  const { sql, values } = buildPatchUpdate(
    'students',
    { name, gender, level, enroll_date, fee_amount, fee_frequency, status,
      dorm_house, room, bed_number, hostel_status, notes },
    'id = ?',
    [req.params.id],
  );
  if (sql) db.prepare(sql).run(...values);

  audit(req.user.id, 'UPDATE', 'students', req.params.id, `Updated student ${req.params.id}`);
  res.json({ ok: true });
});

// DELETE /api/students/:id — deactivate (soft delete)
router.delete('/:id(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT id, name FROM students WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  db.prepare("UPDATE students SET status = 'inactive' WHERE id = ?").run(req.params.id);
  audit(req.user.id, 'DEACTIVATE', 'students', req.params.id, `Deactivated ${existing.name}`);
  res.json({ ok: true });
});

// DELETE /api/students/:id/permanent — hard delete (blocked if payment records exist)
router.delete('/:id(\\d+)/permanent', requireAuth, requireRole('admin'), (req, res) => {
  const student = db.prepare('SELECT id, name FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const paymentCount = db.prepare('SELECT COUNT(*) AS c FROM fee_payments WHERE student_id = ?').get(req.params.id).c;
  if (paymentCount > 0) {
    return res.status(409).json({
      error: `Cannot permanently delete "${student.name}" — they have ${paymentCount} payment record(s). Deactivate instead to preserve financial history.`,
    });
  }

  db.transaction(() => {
    db.prepare('DELETE FROM attendance_records WHERE student_id = ?').run(req.params.id);
    db.prepare('DELETE FROM student_contacts WHERE student_id = ?').run(req.params.id);
    db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  })();

  audit(req.user.id, 'DELETE', 'students', req.params.id, `Permanently deleted student "${student.name}"`);
  res.json({ ok: true });
});


function slugUsername(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 32);
}

// POST /api/students/:id/create-login
router.post('/:id(\\d+)/create-login', requireAuth, requireRole('admin'), (req, res) => {
  const studentId = Number.parseInt(req.params.id, 10);
  const student = db.prepare('SELECT id, name, level, user_id FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (student.user_id) return res.status(409).json({ error: 'Student already has a linked login account' });

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const mustChangePassword = req.body?.must_change_password === false ? 0 : 1;

  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (!password) return res.status(400).json({ error: 'Password is required' });
  if (username.length > 50) return res.status(400).json({ error: 'Username must be 50 characters or fewer' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (password.length > 128) return res.status(400).json({ error: 'Password must be 128 characters or fewer' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const passwordHash = bcrypt.hashSync(password, 10);

  const tx = db.transaction(() => {
    const userResult = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, is_active, login_disabled, must_change_password)
      VALUES (?, ?, ?, 'student', 1, 0, ?)
    `).run(student.name, username, passwordHash, mustChangePassword);

    const userId = Number(userResult.lastInsertRowid);
    const linkResult = db.prepare('UPDATE students SET user_id = ? WHERE id = ? AND user_id IS NULL').run(userId, student.id);
    if (linkResult.changes !== 1) {
      throw new Error('Student already linked');
    }
    if (mustChangePassword === 1) {
      createNotification({
        userId,
        type: 'first_login_password_change_needed',
        title: 'Password change required',
        message: 'Your account requires a password change on first login.',
        entityType: 'student',
        entityId: student.id,
      });
    }
    return userId;
  });

  try {
    const userId = tx();
    audit(req.user.id, 'CREATE_STUDENT_LOGIN', 'students', student.id, `Created linked student login "${username}" for ${student.name}`);
    audit(req.user.id, 'LINK_STUDENT_USER', 'users', userId, `Linked student "${student.name}" (${student.level}) to user "${username}"`);
    return res.status(201).json({
      ok: true,
      student_id: student.id,
      user_id: userId,
      username,
      must_change_password: mustChangePassword === 1,
    });
  } catch (err) {
    if (err.message === 'Student already linked') {
      return res.status(409).json({ error: 'Student already has a linked login account' });
    }
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Unable to create linked account due to uniqueness conflict' });
    }
    throw err;
  }
});

// POST /api/students/:id/unlink-login
router.post('/:id(\\d+)/unlink-login', requireAuth, requireRole('admin'), (req, res) => {
  const studentId = Number.parseInt(req.params.id, 10);
  const student = db.prepare('SELECT id, name, user_id FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (!student.user_id) return res.status(400).json({ error: 'Student has no linked login account' });

  db.prepare('UPDATE students SET user_id = NULL WHERE id = ?').run(studentId);
  audit(req.user.id, 'UNLINK_STUDENT_LOGIN', 'students', student.id, `Unlinked login account from ${student.name}`);
  res.json({ ok: true });
});


module.exports = router;
