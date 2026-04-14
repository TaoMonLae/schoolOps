const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function getPeriodTotals(year, month) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;

  // Single query for period income/expense
  const periodTotals = db.prepare(`
    SELECT
      coa.type,
      COALESCE(SUM(CASE WHEN ce.credit_account_id = coa.id THEN ce.amount ELSE 0 END), 0) AS period_credits,
      COALESCE(SUM(CASE WHEN ce.debit_account_id  = coa.id THEN ce.amount ELSE 0 END), 0) AS period_debits
    FROM chart_of_accounts coa
    LEFT JOIN cashbook_entries ce
      ON (ce.debit_account_id = coa.id OR ce.credit_account_id = coa.id)
      AND ce.voided = 0
      AND strftime('%Y-%m', ce.entry_date) = ?
    WHERE coa.is_active = 1 AND coa.type IN ('income','expense')
    GROUP BY coa.id, coa.type
  `).all(ym);

  let totalIncome = 0, totalExpense = 0;
  for (const r of periodTotals) {
    if (r.type === 'income')  totalIncome  += r.period_credits - r.period_debits;
    if (r.type === 'expense') totalExpense += r.period_debits  - r.period_credits;
  }

  // Cash/bank balances: single aggregated query
  const balances = db.prepare(`
    SELECT
      coa.sub_type,
      COALESCE(ob.balance, 0) AS opening_balance,
      COALESCE(SUM(CASE WHEN ce.debit_account_id  = coa.id AND ce.voided = 0 THEN ce.amount ELSE 0 END), 0) AS all_debits,
      COALESCE(SUM(CASE WHEN ce.credit_account_id = coa.id AND ce.voided = 0 THEN ce.amount ELSE 0 END), 0) AS all_credits,
      COALESCE(SUM(CASE WHEN ce.debit_account_id  = coa.id AND ce.voided = 0 AND strftime('%Y-%m', ce.entry_date) = ? THEN ce.amount ELSE 0 END), 0) AS period_debits,
      COALESCE(SUM(CASE WHEN ce.credit_account_id = coa.id AND ce.voided = 0 AND strftime('%Y-%m', ce.entry_date) = ? THEN ce.amount ELSE 0 END), 0) AS period_credits
    FROM chart_of_accounts coa
    LEFT JOIN account_opening_balances ob ON ob.account_id = coa.id
    LEFT JOIN cashbook_entries ce ON (ce.debit_account_id = coa.id OR ce.credit_account_id = coa.id)
    WHERE coa.is_active = 1 AND coa.sub_type IN ('cash','bank')
    GROUP BY coa.id, coa.sub_type
  `).all(ym, ym);

  let closingCash = 0, closingBank = 0, openingCash = 0, openingBank = 0;
  for (const r of balances) {
    const closing = r.opening_balance + r.all_debits - r.all_credits;
    const opening = closing - (r.period_debits - r.period_credits);
    if (r.sub_type === 'cash') { closingCash += closing; openingCash += opening; }
    if (r.sub_type === 'bank') { closingBank += closing; openingBank += opening; }
  }

  return { totalIncome, totalExpense, closingCash, closingBank, openingCash, openingBank };
}

// GET /api/closing — list all monthly closings
router.get('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const rows = db.prepare(`
    SELECT mc.*, u.name AS closed_by_name
    FROM monthly_closings mc
    LEFT JOIN users u ON u.id = mc.closed_by
    ORDER BY mc.year DESC, mc.month DESC
  `).all();
  res.json(rows);
});

// GET /api/closing/status?month=&year= — check if month is closed + preview figures
router.get('/status', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });

  const m = parseInt(month); const y = parseInt(year);
  const closed = db.prepare('SELECT * FROM monthly_closings WHERE year = ? AND month = ?').get(y, m);
  const totals = getPeriodTotals(y, m);
  const entryCount = db.prepare(
    "SELECT COUNT(*) AS n FROM cashbook_entries WHERE voided=0 AND strftime('%Y-%m',entry_date)=?"
  ).get(`${y}-${String(m).padStart(2,'0')}`).n;

  res.json({
    is_closed: !!closed,
    closing: closed || null,
    preview: { ...totals, entry_count: entryCount },
    period_label: `${MONTHS[m-1]} ${y}`,
  });
});

// POST /api/closing — close a month (admin only)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { month, year, notes } = req.body;
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });

  const m = parseInt(month); const y = parseInt(year);
  const existing = db.prepare('SELECT id FROM monthly_closings WHERE year = ? AND month = ?').get(y, m);
  if (existing) return res.status(409).json({ error: `${MONTHS[m-1]} ${y} is already closed` });

  const totals = getPeriodTotals(y, m);
  let result;
  try {
    result = db.prepare(`
      INSERT INTO monthly_closings
        (year, month, closed_by, opening_cash, opening_bank, total_income, total_expense, closing_cash, closing_bank, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(y, m, req.user.id,
      totals.openingCash, totals.openingBank,
      totals.totalIncome, totals.totalExpense,
      totals.closingCash, totals.closingBank,
      notes || null);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Already closed' });
    throw err;
  }

  audit(req.user.id, 'CLOSE_PERIOD', 'monthly_closings', result.lastInsertRowid,
    `Closed ${MONTHS[m-1]} ${y} – income ${totals.totalIncome}, expense ${totals.totalExpense}`);
  res.status(201).json({ id: result.lastInsertRowid, ...totals });
});

// DELETE /api/closing/:id — reopen a closed period (admin only)
router.delete('/:id(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const closing = db.prepare('SELECT * FROM monthly_closings WHERE id = ?').get(req.params.id);
  if (!closing) return res.status(404).json({ error: 'Closing record not found' });

  db.prepare('DELETE FROM monthly_closings WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'REOPEN_PERIOD', 'monthly_closings', req.params.id,
    `Reopened ${MONTHS[closing.month-1]} ${closing.year}`);
  res.json({ ok: true });
});

module.exports = router;
