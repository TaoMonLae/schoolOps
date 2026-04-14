const express = require('express');
const { db } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { getStudentByUserId } = require('../services/studentIdentity');
const { paymentReceiptCode } = require('../services/receipts');

const router = express.Router();

router.get('/verify/:receiptCode', requireAuth, (req, res) => {
  const rawCode = String(req.params.receiptCode || '').trim().toUpperCase();
  const match = /^RCP-(\d{4})(\d{2})-(\d{6})$/.exec(rawCode);
  if (!match) return res.status(400).json({ valid: false, error: 'Invalid receipt code format' });

  const year = Number(match[1]);
  const month = Number(match[2]);
  const paymentId = Number(match[3]);

  const payment = db.prepare(`
    SELECT fp.*, s.name AS student_name, s.id AS student_id
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    WHERE fp.id = ?
  `).get(paymentId);

  if (!payment) return res.status(404).json({ valid: false, status: 'not_found', error: 'Receipt not found' });

  const expectedCode = paymentReceiptCode(payment);
  if (expectedCode !== rawCode || payment.period_year !== year || payment.period_month !== month) {
    return res.status(404).json({ valid: false, status: 'not_found', error: 'Receipt not found' });
  }

  if (req.user.role === 'student') {
    const student = getStudentByUserId(req.user.id);
    if (!student || student.id !== payment.student_id) {
      return res.status(403).json({ valid: false, error: 'Not allowed to verify this receipt' });
    }
  }

  return res.json({
    valid: true,
    status: payment.voided ? 'voided' : 'active',
    voided: !!payment.voided,
    student_name: payment.student_name,
    amount: payment.amount,
    paid_date: payment.paid_date,
    period_month: payment.period_month,
    period_year: payment.period_year,
    period_covered: `${payment.period_year}-${String(payment.period_month).padStart(2, '0')}`,
    receipt_code: rawCode,
  });
});

module.exports = router;
