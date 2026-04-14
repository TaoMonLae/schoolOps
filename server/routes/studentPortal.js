const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireLinkedStudent } = require('../services/studentIdentity');
const { paymentReceiptCode, paymentVerificationCode, renderPaymentReceiptPdf } = require('../services/receipts');

const router = express.Router();
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function summarizeFees(student) {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();
  const currentPacked = currentYear * 100 + currentMonth;

  const payments = db.prepare(`
    SELECT fp.*, u.name AS received_by_name
    FROM fee_payments fp
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.student_id = ?
    ORDER BY fp.period_year DESC, fp.period_month DESC, fp.id DESC
  `).all(student.id);

  const activePayments = payments.filter((p) => !p.voided);
  const uniquePeriods = new Set();
  const paymentsToDate = [];
  let paidCurrentMonth = false;

  for (const p of activePayments) {
    const packed = (p.period_year * 100) + p.period_month;
    if (packed <= currentPacked) uniquePeriods.add(`${p.period_year}-${p.period_month}`);
    if (packed <= currentPacked) paymentsToDate.push(p);
    if (p.period_month === currentMonth && p.period_year === currentYear) paidCurrentMonth = true;
  }

  const enroll = new Date(`${student.enroll_date}T00:00:00Z`);
  let overdueMonths = 0;
  if (!Number.isNaN(enroll.getTime()) && student.fee_frequency === 'monthly') {
    const startIndex = (enroll.getUTCFullYear() * 12) + enroll.getUTCMonth();
    const endIndex = (currentYear * 12) + (currentMonth - 1);
    const dueCount = Math.max(endIndex - startIndex + 1, 0);
    overdueMonths = Math.max(dueCount - uniquePeriods.size, 0);
  }

  const outstandingAmount = overdueMonths * Number(student.fee_amount || 0);
  const mostRecentPayment = activePayments[0] || null;

  return {
    payments,
    payment_history: activePayments.map((p) => ({
      ...p,
      receipt_code: paymentReceiptCode(p),
      verification_code: paymentVerificationCode(p),
      period_label: `${MONTHS[p.period_month - 1]} ${p.period_year}`,
      status: p.voided ? 'voided' : 'active',
    })),
    current_month: { month: currentMonth, year: currentYear, status: paidCurrentMonth ? 'paid' : 'unpaid' },
    outstanding_amount: outstandingAmount,
    overdue_months: overdueMonths,
    most_recent_payment: mostRecentPayment ? {
      ...mostRecentPayment,
      receipt_code: paymentReceiptCode(mostRecentPayment),
      verification_code: paymentVerificationCode(mostRecentPayment),
      period_label: `${MONTHS[mostRecentPayment.period_month - 1]} ${mostRecentPayment.period_year}`,
      status: mostRecentPayment.voided ? 'voided' : 'active',
    } : null,
  };
}

router.get('/me/dashboard', requireAuth, requireRole('student'), requireLinkedStudent({ requireActive: false }), (req, res) => {
  const fees = summarizeFees(req.student);

  const latestDuty = db.prepare(`
    SELECT id, duty_number, date, status, reviewed_at
    FROM duty_logs
    WHERE submitted_by = ?
    ORDER BY date DESC, id DESC
    LIMIT 1
  `).get(req.user.id) || null;

  const latestMovement = db.prepare(`
    SELECT id, leave_time, return_time, destination, reason, compliance_status
    FROM student_movement_logs
    WHERE student_id = ?
    ORDER BY leave_time DESC, id DESC
    LIMIT 1
  `).get(req.student.id) || null;

  const openMovement = db.prepare(`
    SELECT id, leave_time, destination, reason
    FROM student_movement_logs
    WHERE student_id = ? AND return_time IS NULL
    ORDER BY leave_time DESC, id DESC
    LIMIT 1
  `).get(req.student.id) || null;

  res.json({
    student: req.student,
    fees: {
      current_month: fees.current_month,
      outstanding_amount: fees.outstanding_amount,
      overdue_months: fees.overdue_months,
      most_recent_payment: fees.most_recent_payment,
    },
    movement: {
      currently_out: !!openMovement,
      open_record: openMovement,
      latest_record: latestMovement,
    },
    duty: {
      latest_submission: latestDuty,
    },
  });
});

router.get('/me/fees', requireAuth, requireRole('student'), requireLinkedStudent({ requireActive: false }), (req, res) => {
  const fees = summarizeFees(req.student);
  res.json({
    student: {
      id: req.student.id,
      name: req.student.name,
      level: req.student.level,
      fee_amount: req.student.fee_amount,
      fee_frequency: req.student.fee_frequency,
    },
    payment_history: fees.payment_history,
    current_month_status: fees.current_month,
    outstanding_amount: fees.outstanding_amount,
    overdue_months: fees.overdue_months,
    most_recent_payment: fees.most_recent_payment,
  });
});

router.get('/me/receipts', requireAuth, requireRole('student'), requireLinkedStudent({ requireActive: false }), (req, res) => {
  const rows = db.prepare(`
    SELECT fp.*, u.name AS received_by_name
    FROM fee_payments fp
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.student_id = ?
    ORDER BY fp.paid_date DESC, fp.id DESC
  `).all(req.student.id).map((payment) => ({
    ...payment,
    receipt_code: paymentReceiptCode(payment),
    verification_code: paymentVerificationCode(payment),
    period_label: `${MONTHS[payment.period_month - 1]} ${payment.period_year}`,
    status: payment.voided ? 'voided' : 'active',
  }));

  res.json({ student_id: req.student.id, receipts: rows });
});

router.get('/me/receipts/:paymentId(\\d+)/pdf', requireAuth, requireRole('student'), requireLinkedStudent({ requireActive: false }), (req, res) => {
  const paymentId = Number.parseInt(req.params.paymentId, 10);
  const payment = db.prepare(`
    SELECT fp.*, s.name AS student_name, u.name AS received_by_name
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.id = ? AND fp.student_id = ?
  `).get(paymentId, req.student.id);

  if (!payment) return res.status(404).json({ error: 'Receipt not found' });

  renderPaymentReceiptPdf({
    res,
    payment,
    duplicateCopy: (req.query.copy || '').toString().toLowerCase() === 'duplicate',
  });
});

module.exports = router;
