const express = require('express');
const PDFDoc = require('pdfkit');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSettings } = require('../services/settings');
const { generateUnpaidFeeReminderBatch } = require('../services/notifications');
const { drawPdfLogo } = require('../services/pdfBranding');

const router = express.Router();
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function formatMoney(currency, amount) {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

function paymentReceiptCode(payment) {
  return `RCP-${payment.period_year}${String(payment.period_month).padStart(2, '0')}-${String(payment.id).padStart(6, '0')}`;
}

// GET /api/fees — all payments, filterable by ?month=&year=&student_id=
router.get('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year, student_id } = req.query;
  let sql = `
    SELECT fp.*, s.name AS student_name, u.name AS received_by_name
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.voided = 0
  `;
  const params = [];
  if (month)      { sql += ' AND fp.period_month = ?'; params.push(month); }
  if (year)       { sql += ' AND fp.period_year = ?';  params.push(year); }
  if (student_id) { sql += ' AND fp.student_id = ?';   params.push(student_id); }
  sql += ' ORDER BY fp.paid_date DESC';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/fees/:id — payment details
router.get('/:id(\\d+)', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const payment = db.prepare(`
    SELECT fp.*, s.name AS student_name, u.name AS received_by_name
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.id = ? AND fp.voided = 0
  `).get(req.params.id);

  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json({ ...payment, receipt_code: paymentReceiptCode(payment) });
});

// GET /api/fees/student/:id — per-student payment history
router.get('/student/:id', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
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
router.post('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
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

// GET /api/fees/:id/receipt/pdf — printable payment receipt
router.get('/:id(\\d+)/receipt/pdf', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const payment = db.prepare(`
    SELECT fp.*, s.name AS student_name, u.name AS received_by_name
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.id = ? AND fp.voided = 0
  `).get(req.params.id);

  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const settings = getSettings();
  const currency = settings.currency || 'RM';
  const receiptCode = paymentReceiptCode(payment);
  const verificationCode = `VER-${String(payment.id).padStart(6, '0')}-${payment.period_year}${String(payment.period_month).padStart(2, '0')}`;
  const duplicateCopy = (req.query.copy || '').toString().toLowerCase() === 'duplicate';

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

  doc.rect(0, 0, doc.page.width, 85).fill('#1a7a4a');
  const titleX = drawPdfLogo(doc, settings.logo_url, { x: 50, y: 18, size: 46 }) || 50;
  doc.fillColor('white').font('Helvetica-Bold').fontSize(18).text(schoolName, titleX, 22);
  doc.font('Helvetica').fontSize(11).text(subtitle || 'Payment Receipt', titleX, 48);
  doc.font('Helvetica-Bold').fontSize(13).text('OFFICIAL FEE PAYMENT RECEIPT', titleX, 65);

  doc.fillColor('#1f2937');
  let y = 105;

  if (duplicateCopy) {
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.fillColor('#ef4444').opacity(0.18).font('Helvetica-Bold').fontSize(72)
      .text('DUPLICATE COPY', 65, 360, { align: 'center', width: doc.page.width - 130 });
    doc.restore();
    doc.fillColor('#1f2937').opacity(1);
  }

  doc.roundedRect(50, y, doc.page.width - 100, 120, 8).fillAndStroke('#f8fafc', '#d1d5db');
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text('Receipt Information', 64, y + 14);
  doc.font('Helvetica').fontSize(10)
    .text(`Receipt No: ${receiptCode}`, 64, y + 38)
    .text(`Verification Code: ${verificationCode}`, 64, y + 56)
    .text(`Payment Date: ${paidDate}`, 64, y + 74)
    .text(`Payment Period: ${periodLabel}`, 64, y + 92);
  doc.font('Helvetica').fontSize(10)
    .text(`Method: ${payment.method}`, 320, y + 38)
    .text(`Received By: ${payment.received_by_name || 'N/A'}`, 320, y + 56)
    .text(`Amount Paid: ${formatMoney(currency, payment.amount)}`, 320, y + 74);

  y += 145;
  doc.roundedRect(50, y, doc.page.width - 100, 145, 8).fillAndStroke('#ffffff', '#d1d5db');
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text('Payer Details', 64, y + 14);
  doc.font('Helvetica').fontSize(10)
    .text(`Student: ${payment.student_name}`, 64, y + 40)
    .text(`Coverage Month/Year: ${periodLabel}`, 64, y + 58)
    .text(`Notes: ${payment.notes || '—'}`, 64, y + 76, { width: doc.page.width - 130 });

  y += 170;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#d1d5db').stroke();
  y += 12;
  doc.fillColor('#4b5563').font('Helvetica').fontSize(9)
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

  db.prepare('UPDATE fee_payments SET voided = 1 WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'VOID', 'fee_payments', req.params.id, `Voided payment ${req.params.id}`);
  res.json({ ok: true });
});

module.exports = router;
