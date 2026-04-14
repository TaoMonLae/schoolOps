const express = require('express');
const fs = require('fs');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { resolveStoragePath } = require('../services/attachments');
const { recordStockMovement, deleteStockMovementById } = require('../services/inventory');

const router = express.Router();

function normalizeStockFields({ stock_item_id, stock_quantity, amount, expense_date }) {
  const stockItemId = stock_item_id ? Number(stock_item_id) : null;
  const stockQty = stock_quantity == null || stock_quantity === '' ? null : Number(stock_quantity);
  const amountNum = amount == null || amount === '' ? null : Number(amount);

  return {
    stockItemId: Number.isFinite(stockItemId) ? stockItemId : null,
    stockQty: Number.isFinite(stockQty) ? stockQty : null,
    amountNum,
    expenseDate: expense_date || null,
  };
}

function syncExpenditureStockMovement(expenditure, actorId) {
  if (expenditure.stock_movement_id) {
    deleteStockMovementById(expenditure.stock_movement_id);
    db.prepare('UPDATE expenditures SET stock_movement_id = NULL WHERE id = ?').run(expenditure.id);
  }

  const { stockItemId, stockQty, amountNum, expenseDate } = normalizeStockFields(expenditure);
  if (!stockItemId || !Number.isFinite(stockQty) || stockQty <= 0 || !expenseDate) return null;

  const movementId = recordStockMovement({
    itemId: stockItemId,
    movementType: 'purchase',
    quantity: stockQty,
    unitCost: Number.isFinite(amountNum) ? amountNum / Math.max(stockQty, 1) : null,
    movementDate: expenseDate,
    notes: `Purchased via expenditure #${expenditure.id}`,
    refTable: 'expenditures',
    refId: expenditure.id,
    createdBy: actorId,
  });

  db.prepare('UPDATE expenditures SET stock_movement_id = ? WHERE id = ?').run(movementId, expenditure.id);
  return movementId;
}

// GET /api/expenditures — all entries, filterable by ?month=&year=&category=
router.get('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year, category } = req.query;
  let sql = `
    SELECT e.*, u.name AS added_by_name,
           i.name AS stock_item_name, i.unit AS stock_item_unit,
           COALESCE(att.attachment_count, 0) AS attachment_count
    FROM expenditures e
    LEFT JOIN users u ON u.id = e.added_by
    LEFT JOIN inventory_items i ON i.id = e.stock_item_id
    LEFT JOIN (
      SELECT entity_id, COUNT(*) AS attachment_count
      FROM attachments
      WHERE entity_type = 'expenditure'
      GROUP BY entity_id
    ) att ON att.entity_id = e.id
    WHERE 1=1
  `;
  const params = [];

  if (month) { sql += " AND strftime('%m', e.expense_date) = ?"; params.push(String(month).padStart(2, '0')); }
  if (year)  { sql += " AND strftime('%Y', e.expense_date) = ?"; params.push(String(year)); }
  if (category) { sql += ' AND e.category = ?'; params.push(category); }
  sql += ' ORDER BY e.expense_date DESC';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/expenditures/:id
router.get('/:id', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const row = db.prepare(`
    SELECT e.*, u.name AS added_by_name,
           i.name AS stock_item_name, i.unit AS stock_item_unit,
           COALESCE(att.attachment_count, 0) AS attachment_count
    FROM expenditures e
    LEFT JOIN users u ON u.id = e.added_by
    LEFT JOIN inventory_items i ON i.id = e.stock_item_id
    LEFT JOIN (
      SELECT entity_id, COUNT(*) AS attachment_count
      FROM attachments
      WHERE entity_type = 'expenditure'
      GROUP BY entity_id
    ) att ON att.entity_id = e.id
    WHERE e.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Expenditure not found' });
  res.json(row);
});

// POST /api/expenditures — add (admin only)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { category, description, amount, expense_date, receipt_ref, notes, stock_item_id, stock_quantity } = req.body;
  if (!category || !description || amount == null || !expense_date)
    return res.status(400).json({ error: 'category, description, amount, expense_date required' });

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return res.status(400).json({ error: 'Amount must be a positive number' });
  if (description && description.length > 500)
    return res.status(400).json({ error: 'Description must be 500 characters or fewer' });
  if (notes && notes.length > 1000)
    return res.status(400).json({ error: 'Notes must be 1000 characters or fewer' });

  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO expenditures (category, description, amount, expense_date, added_by, receipt_ref, notes, stock_item_id, stock_quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      category,
      description,
      parsedAmount,
      expense_date,
      req.user.id,
      receipt_ref || null,
      notes || null,
      stock_item_id || null,
      stock_quantity == null ? null : Number(stock_quantity),
    );

    const expenditureId = Number(result.lastInsertRowid);
    syncExpenditureStockMovement({
      id: expenditureId,
      stock_movement_id: null,
      stock_item_id,
      stock_quantity,
      amount,
      expense_date,
    }, req.user.id);

    return expenditureId;
  });

  const id = tx();

  audit(req.user.id, 'CREATE', 'expenditures', id,
    `Added ${category}: ${description} RM${amount}`);
  res.status(201).json({ id });
});

// PUT /api/expenditures/:id — edit
router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM expenditures WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Expenditure not found' });

  const { category, description, amount, expense_date, receipt_ref, notes, stock_item_id, stock_quantity } = req.body;
  const nextValues = {
    id: existing.id,
    stock_movement_id: existing.stock_movement_id,
    category: category ?? existing.category,
    description: description ?? existing.description,
    amount: amount ?? existing.amount,
    expense_date: expense_date ?? existing.expense_date,
    receipt_ref: receipt_ref ?? existing.receipt_ref,
    notes: notes ?? existing.notes,
    stock_item_id: stock_item_id === undefined ? existing.stock_item_id : (stock_item_id || null),
    stock_quantity: stock_quantity === undefined ? existing.stock_quantity : (stock_quantity == null ? null : Number(stock_quantity)),
  };

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE expenditures
      SET category     = ?,
          description  = ?,
          amount       = ?,
          expense_date = ?,
          receipt_ref  = ?,
          notes        = ?,
          stock_item_id = ?,
          stock_quantity = ?
      WHERE id = ?
    `).run(
      nextValues.category,
      nextValues.description,
      nextValues.amount,
      nextValues.expense_date,
      nextValues.receipt_ref,
      nextValues.notes,
      nextValues.stock_item_id,
      nextValues.stock_quantity,
      req.params.id,
    );

    syncExpenditureStockMovement(nextValues, req.user.id);
  });

  tx();

  audit(req.user.id, 'UPDATE', 'expenditures', req.params.id, `Updated expenditure ${req.params.id}`);
  res.json({ ok: true });
});

// DELETE /api/expenditures/:id — delete (admin only)
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM expenditures WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Expenditure not found' });

  // Collect file paths BEFORE any deletion (read-only phase)
  const attachments = db.prepare(`
    SELECT id, stored_name FROM attachments
    WHERE entity_type = 'expenditure' AND entity_id = ?
  `).all(req.params.id);

  const filePaths = attachments.map(att => ({
    id: att.id,
    path: resolveStoragePath('expenditure', att.stored_name),
  }));

  // DB deletion in a single atomic transaction
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM attachments WHERE entity_type = 'expenditure' AND entity_id = ?`)
      .run(req.params.id);
    if (existing.stock_movement_id) {
      deleteStockMovementById(existing.stock_movement_id);
    }
    db.prepare('DELETE FROM expenditures WHERE id = ?').run(req.params.id);
  });

  tx(); // throws on failure — response not yet sent, so caller gets 500

  // File deletion AFTER successful DB commit (best-effort)
  for (const { path: filePath } of filePaths) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (fileErr) {
      console.error(`Warning: could not delete attachment file ${filePath}:`, fileErr.message);
    }
  }

  audit(req.user.id, 'DELETE', 'expenditures', req.params.id, `Deleted expenditure ${req.params.id}`);
  res.json({ ok: true });
});

module.exports = router;
