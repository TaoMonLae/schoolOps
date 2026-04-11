const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/funds — list all donor funds with balance
router.get('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const funds = db.prepare(`
    SELECT df.*,
           u.name AS created_by_name
    FROM donor_funds df
    LEFT JOIN users u ON u.id = df.created_by
    WHERE df.is_active = 1
    ORDER BY df.created_at DESC
  `).all();

  // Compute received & spent per fund from cashbook entries
  const result = funds.map(f => {
    // Income credited to fund: cashbook entries where credit account is income type and fund_id matches
    const received = db.prepare(`
      SELECT COALESCE(SUM(ce.amount), 0) AS s
      FROM cashbook_entries ce
      JOIN chart_of_accounts ca ON ca.id = ce.credit_account_id
      WHERE ce.fund_id = ? AND ce.voided = 0 AND ca.type = 'income'
    `).get(f.id).s;

    // Expenses debited from fund
    const spent = db.prepare(`
      SELECT COALESCE(SUM(ce.amount), 0) AS s
      FROM cashbook_entries ce
      JOIN chart_of_accounts da ON da.id = ce.debit_account_id
      WHERE ce.fund_id = ? AND ce.voided = 0 AND da.type = 'expense'
    `).get(f.id).s;

    return { ...f, amount_received: received, amount_spent: spent, balance: received - spent };
  });

  res.json(result);
});

// GET /api/funds/:id — fund detail with transactions
router.get('/:id(\\d+)', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const fund = db.prepare(`
    SELECT df.*, u.name AS created_by_name
    FROM donor_funds df LEFT JOIN users u ON u.id = df.created_by
    WHERE df.id = ?
  `).get(req.params.id);
  if (!fund) return res.status(404).json({ error: 'Fund not found' });

  const entries = db.prepare(`
    SELECT ce.*,
           da.code AS debit_code, da.name AS debit_name,
           ca.code AS credit_code, ca.name AS credit_name,
           u2.name AS created_by_name
    FROM cashbook_entries ce
    JOIN chart_of_accounts da ON da.id = ce.debit_account_id
    JOIN chart_of_accounts ca ON ca.id = ce.credit_account_id
    LEFT JOIN users u2 ON u2.id = ce.created_by
    WHERE ce.fund_id = ? AND ce.voided = 0
    ORDER BY ce.entry_date DESC
  `).all(req.params.id);

  const received = entries
    .filter(e => db.prepare("SELECT type FROM chart_of_accounts WHERE id=?").get(e.credit_account_id)?.type === 'income')
    .reduce((s, e) => s + e.amount, 0);
  const spent = entries
    .filter(e => db.prepare("SELECT type FROM chart_of_accounts WHERE id=?").get(e.debit_account_id)?.type === 'expense')
    .reduce((s, e) => s + e.amount, 0);

  res.json({ ...fund, amount_received: received, amount_spent: spent, balance: received - spent, entries });
});

// POST /api/funds — create donor fund (admin)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { name, funder_name, description, is_restricted } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const result = db.prepare(`
    INSERT INTO donor_funds (name, funder_name, description, is_restricted, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, funder_name || null, description || null,
         is_restricted !== false ? 1 : 0, req.user.id);

  audit(req.user.id, 'CREATE', 'donor_funds', result.lastInsertRowid, `Created fund: ${name}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/funds/:id — update fund (admin)
router.put('/:id(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const fund = db.prepare('SELECT * FROM donor_funds WHERE id = ?').get(req.params.id);
  if (!fund) return res.status(404).json({ error: 'Fund not found' });

  const { name, funder_name, description, is_restricted } = req.body;
  db.prepare(`
    UPDATE donor_funds SET name=?, funder_name=?, description=?, is_restricted=? WHERE id=?
  `).run(
    name ?? fund.name,
    funder_name ?? fund.funder_name,
    description ?? fund.description,
    is_restricted ?? fund.is_restricted,
    req.params.id
  );
  audit(req.user.id, 'UPDATE', 'donor_funds', req.params.id, `Updated fund: ${fund.name}`);
  res.json({ ok: true });
});

// DELETE /api/funds/:id — soft delete (admin)
router.delete('/:id(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const fund = db.prepare('SELECT * FROM donor_funds WHERE id = ?').get(req.params.id);
  if (!fund) return res.status(404).json({ error: 'Fund not found' });

  const inUse = db.prepare('SELECT COUNT(*) AS n FROM cashbook_entries WHERE fund_id = ? AND voided = 0').get(req.params.id).n;
  if (inUse > 0) return res.status(409).json({ error: 'Fund has active cashbook entries, cannot delete' });

  db.prepare('UPDATE donor_funds SET is_active = 0 WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'DELETE', 'donor_funds', req.params.id, `Deactivated fund: ${fund.name}`);
  res.json({ ok: true });
});

module.exports = router;
