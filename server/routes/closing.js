const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function accountBalance(accountId) {
  const acct = db.prepare('SELECT type FROM chart_of_accounts WHERE id = ?').get(accountId);
  if (!acct) return 0;
  const ob = db.prepare('SELECT balance FROM account_opening_balances WHERE account_id = ?').get(accountId);
  const debits = db.prepare(
    'SELECT COALESCE(SUM(amount),0) AS s FROM cashbook_entries WHERE debit_account_id = ? AND voided = 0'
  ).get(accountId).s;
  const credits = db.prepare(
    'SELECT COALESCE(SUM(amount),0) AS s FROM cashbook_entries WHERE credit_account_id = ? AND voided = 0'
  ).get(accountId).s;
  const openingBal = ob ? ob.balance : 0;
  const isDebitNormal = acct.type === 'asset' || acct.type === 'expense';
  return isDebitNormal ? openingBal + debits - credits : openingBal + credits - debits;
}

function getPeriodTotals(year, month) {
  const ym = `${year}-${String(month).padStart(2,'0')}`;

  const incomeAccts  = db.prepare("SELECT id FROM chart_of_accounts WHERE type='income'  AND is_active=1").all();
  const expenseAccts = db.prepare("SELECT id FROM chart_of_accounts WHERE type='expense' AND is_active=1").all();
  const cashAccts    = db.prepare("SELECT id FROM chart_of_accounts WHERE sub_type='cash' AND is_active=1").all();
  const bankAccts    = db.prepare("SELECT id FROM chart_of_accounts WHERE sub_type='bank' AND is_active=1").all();

  let totalIncome = 0, totalExpense = 0;
  for (const a of incomeAccts) {
    const cr = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM cashbook_entries WHERE credit_account_id=? AND voided=0 AND strftime('%Y-%m',entry_date)=?"
    ).get(a.id, ym).s;
    totalIncome += cr;
  }
  for (const a of expenseAccts) {
    const dr = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM cashbook_entries WHERE debit_account_id=? AND voided=0 AND strftime('%Y-%m',entry_date)=?"
    ).get(a.id, ym).s;
    totalExpense += dr;
  }

  // Cash/bank balances at period end = full running balance (all history, not just this month)
  const closingCash = cashAccts.reduce((s, a) => s + accountBalance(a.id), 0);
  const closingBank = bankAccts.reduce((s, a) => s + accountBalance(a.id), 0);

  // Opening: subtract this month's movements
  let openingCash = closingCash, openingBank = closingBank;
  for (const a of cashAccts) {
    const dr = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM cashbook_entries WHERE debit_account_id=? AND voided=0 AND strftime('%Y-%m',entry_date)=?"
    ).get(a.id, ym).s;
    const cr = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM cashbook_entries WHERE credit_account_id=? AND voided=0 AND strftime('%Y-%m',entry_date)=?"
    ).get(a.id, ym).s;
    openingCash -= (dr - cr);
  }
  for (const a of bankAccts) {
    const dr = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM cashbook_entries WHERE debit_account_id=? AND voided=0 AND strftime('%Y-%m',entry_date)=?"
    ).get(a.id, ym).s;
    const cr = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS s FROM cashbook_entries WHERE credit_account_id=? AND voided=0 AND strftime('%Y-%m',entry_date)=?"
    ).get(a.id, ym).s;
    openingBank -= (dr - cr);
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
