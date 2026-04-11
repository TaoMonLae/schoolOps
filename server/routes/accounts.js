const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/accounts — list all accounts with running balance
router.get('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { type, active } = req.query;
  let sql = `SELECT coa.*, ob.balance AS opening_balance, ob.balance_date AS opening_balance_date
             FROM chart_of_accounts coa
             LEFT JOIN account_opening_balances ob ON ob.account_id = coa.id
             WHERE 1=1`;
  const params = [];
  if (type)   { sql += ' AND coa.type = ?'; params.push(type); }
  if (active !== 'all') { sql += ' AND coa.is_active = 1'; }
  sql += ' ORDER BY coa.code';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/accounts/:id — single account detail
router.get('/:id(\\d+)', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const row = db.prepare(`
    SELECT coa.*, ob.balance AS opening_balance, ob.balance_date AS opening_balance_date
    FROM chart_of_accounts coa
    LEFT JOIN account_opening_balances ob ON ob.account_id = coa.id
    WHERE coa.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Account not found' });
  res.json(row);
});

// GET /api/accounts/:id/ledger — entries affecting this account with running balance
router.get('/:id(\\d+)/ledger', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = req.query;
  const acctId = parseInt(req.params.id);

  const acct = db.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').get(acctId);
  if (!acct) return res.status(404).json({ error: 'Account not found' });

  const ob = db.prepare('SELECT * FROM account_opening_balances WHERE account_id = ?').get(acctId);

  let sql = `
    SELECT ce.*,
           da.code AS debit_code, da.name AS debit_name,
           ca.code AS credit_code, ca.name AS credit_name,
           u.name AS created_by_name,
           df.name AS fund_name
    FROM cashbook_entries ce
    JOIN chart_of_accounts da ON da.id = ce.debit_account_id
    JOIN chart_of_accounts ca ON ca.id = ce.credit_account_id
    LEFT JOIN users u ON u.id = ce.created_by
    LEFT JOIN donor_funds df ON df.id = ce.fund_id
    WHERE ce.voided = 0
      AND (ce.debit_account_id = ? OR ce.credit_account_id = ?)
  `;
  const params = [acctId, acctId];
  if (month) { sql += ' AND strftime(\'%m\', ce.entry_date) = ?'; params.push(String(month).padStart(2, '0')); }
  if (year)  { sql += ' AND strftime(\'%Y\', ce.entry_date) = ?'; params.push(String(year)); }
  sql += ' ORDER BY ce.entry_date, ce.id';

  const entries = db.prepare(sql).all(...params);

  // Compute running balance (debit increases asset/expense, credit increases liability/equity/income)
  const isDebitNormal = acct.type === 'asset' || acct.type === 'expense';
  let balance = ob ? ob.balance : 0;

  const rows = entries.map(e => {
    const isDebit = e.debit_account_id === acctId;
    const debit  = isDebit ? e.amount : 0;
    const credit = isDebit ? 0 : e.amount;
    if (isDebitNormal) balance += debit - credit;
    else balance += credit - debit;
    return { ...e, debit, credit, running_balance: balance };
  });

  res.json({ account: acct, opening_balance: ob || null, entries: rows });
});

// POST /api/accounts — create custom account (admin)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { code, name, type, sub_type, parent_id, description } = req.body;
  if (!code || !name || !type) return res.status(400).json({ error: 'code, name, type required' });
  const valid = ['asset','liability','equity','income','expense'];
  if (!valid.includes(type)) return res.status(400).json({ error: 'Invalid type' });

  let result;
  try {
    result = db.prepare(`
      INSERT INTO chart_of_accounts (code, name, type, sub_type, parent_id, description, is_system, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1)
    `).run(code, name, type, sub_type || null, parent_id || null, description || null);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Account code already exists' });
    throw err;
  }
  audit(req.user.id, 'CREATE', 'chart_of_accounts', result.lastInsertRowid, `Created account ${code} - ${name}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/accounts/:id — update account (admin, non-system fields only)
router.put('/:id(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const acct = db.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').get(req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });

  const { name, description, is_active } = req.body;
  db.prepare(`
    UPDATE chart_of_accounts SET name = ?, description = ?, is_active = ? WHERE id = ?
  `).run(name ?? acct.name, description ?? acct.description, is_active ?? acct.is_active, req.params.id);

  audit(req.user.id, 'UPDATE', 'chart_of_accounts', req.params.id, `Updated account ${acct.code}`);
  res.json({ ok: true });
});

// POST /api/accounts/:id/opening-balance — set opening balance
router.post('/:id(\\d+)/opening-balance', requireAuth, requireRole('admin'), (req, res) => {
  const { balance, balance_date } = req.body;
  if (balance == null || !balance_date) return res.status(400).json({ error: 'balance and balance_date required' });

  const acct = db.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').get(req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });

  db.prepare(`
    INSERT INTO account_opening_balances (account_id, balance, balance_date, set_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET balance = excluded.balance, balance_date = excluded.balance_date, set_by = excluded.set_by, set_at = datetime('now')
  `).run(req.params.id, balance, balance_date, req.user.id);

  audit(req.user.id, 'SET_OPENING_BALANCE', 'chart_of_accounts', req.params.id,
    `Opening balance ${balance} on ${balance_date} for ${acct.code}`);
  res.json({ ok: true });
});

module.exports = router;
