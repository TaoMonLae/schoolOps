const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recordStockMovement } = require('../services/inventory');
const { createNotificationsForRoles } = require('../services/notifications');

const router = express.Router();


function notifyLowStockIfNeeded(itemId) {
  const item = db.prepare(`
    SELECT id, name, current_stock, reorder_level, unit
    FROM inventory_items
    WHERE id = ? AND is_active = 1
  `).get(itemId);

  if (!item) return;
  if (Number(item.current_stock) > Number(item.reorder_level)) return;

  createNotificationsForRoles(['admin', 'teacher'], {
    type: 'low_stock_alert',
    title: 'Low stock alert',
    message: `${item.name} is low (${item.current_stock} ${item.unit}, reorder level ${item.reorder_level}).`,
    entityType: 'inventory_item',
    entityId: item.id,
  });
}

router.get('/categories', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const rows = db.prepare('SELECT * FROM stock_categories ORDER BY name').all();
  res.json(rows);
});

router.post('/categories', requireAuth, requireRole('admin'), (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name required' });

  const result = db.prepare(`
    INSERT INTO stock_categories (name, is_custom)
    VALUES (?, 1)
    ON CONFLICT(name) DO UPDATE SET name = excluded.name
  `).run(name);

  const row = db.prepare('SELECT * FROM stock_categories WHERE name = ?').get(name);
  audit(req.user.id, 'CREATE', 'stock_categories', row.id, `Category ${name}`);
  res.status(201).json(row);
});

router.get('/items', requireAuth, (req, res) => {
  const includeInactive = req.user.role !== 'student' && String(req.query.include_inactive || '') === '1';
  const search = (req.query.search || '').trim().toLowerCase();
  const lowOnly = String(req.query.low_only || '') === '1';

  let sql = `
    SELECT i.*, c.name AS category_name,
           CASE WHEN i.current_stock <= i.reorder_level THEN 1 ELSE 0 END AS is_low_stock
    FROM inventory_items i
    LEFT JOIN stock_categories c ON c.id = i.category_id
    WHERE 1=1
  `;
  const params = [];

  if (!includeInactive) sql += ' AND i.is_active = 1';
  if (search) {
    sql += ' AND (LOWER(i.name) LIKE ? OR LOWER(COALESCE(c.name, \"\")) LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (lowOnly) sql += ' AND i.current_stock <= i.reorder_level';

  sql += ' ORDER BY is_low_stock DESC, i.name';

  res.json(db.prepare(sql).all(...params));
});

router.post('/items', requireAuth, requireRole('admin'), (req, res) => {
  const {
    name,
    category_id,
    unit,
    current_stock = 0,
    reorder_level = 0,
    notes,
    is_active = 1,
  } = req.body;

  if (!name || !unit) return res.status(400).json({ error: 'name and unit are required' });

  try {
    const result = db.prepare(`
      INSERT INTO inventory_items (name, category_id, unit, current_stock, reorder_level, notes, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      category_id || null,
      unit.trim(),
      Number(current_stock || 0),
      Number(reorder_level || 0),
      notes || null,
      is_active ? 1 : 0,
    );

    const itemId = Number(result.lastInsertRowid);
    notifyLowStockIfNeeded(itemId);
    audit(req.user.id, 'CREATE', 'inventory_items', itemId, `Created inventory item ${name}`);
    res.status(201).json({ id: itemId });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'Item with this name/category already exists' });
    }
    throw err;
  }
});

router.put('/items/:id', requireAuth, requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Inventory item not found' });

  const {
    name,
    category_id,
    unit,
    reorder_level,
    notes,
    is_active,
  } = req.body;

  db.prepare(`
    UPDATE inventory_items
    SET name = COALESCE(?, name),
        category_id = ?,
        unit = COALESCE(?, unit),
        reorder_level = COALESCE(?, reorder_level),
        notes = COALESCE(?, notes),
        is_active = COALESCE(?, is_active),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ? name.trim() : null,
    category_id === undefined ? existing.category_id : (category_id || null),
    unit ? unit.trim() : null,
    reorder_level == null ? null : Number(reorder_level),
    notes,
    is_active == null ? null : (is_active ? 1 : 0),
    req.params.id,
  );

  notifyLowStockIfNeeded(Number(req.params.id));
  audit(req.user.id, 'UPDATE', 'inventory_items', req.params.id, `Updated inventory item ${req.params.id}`);
  res.json({ ok: true });
});

router.post('/movements', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const {
    item_id,
    movement_type,
    quantity,
    unit_cost,
    movement_date,
    notes,
    ref_table,
    ref_id,
  } = req.body;

  if (!item_id || !movement_type || quantity == null || !movement_date) {
    return res.status(400).json({ error: 'item_id, movement_type, quantity, movement_date are required' });
  }

  if (!['purchase', 'usage', 'adjustment', 'waste'].includes(movement_type)) {
    return res.status(400).json({ error: 'Invalid movement type' });
  }

  const id = recordStockMovement({
    itemId: item_id,
    movementType: movement_type,
    quantity,
    unitCost: unit_cost,
    movementDate: movement_date,
    notes,
    refTable: ref_table,
    refId: ref_id,
    createdBy: req.user.id,
  });

  notifyLowStockIfNeeded(Number(item_id));
  audit(req.user.id, 'CREATE', 'stock_movements', id, `${movement_type} for item ${item_id}`);
  res.status(201).json({ id });
});

router.get('/movements', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year, item_id } = req.query;
  let sql = `
    SELECT sm.*, i.name AS item_name, i.unit, c.name AS category_name, u.name AS created_by_name
    FROM stock_movements sm
    JOIN inventory_items i ON i.id = sm.item_id
    LEFT JOIN stock_categories c ON c.id = i.category_id
    LEFT JOIN users u ON u.id = sm.created_by
    WHERE 1=1
  `;
  const params = [];

  if (item_id) { sql += ' AND sm.item_id = ?'; params.push(item_id); }
  if (month) { sql += " AND strftime('%m', sm.movement_date) = ?"; params.push(String(month).padStart(2, '0')); }
  if (year) { sql += " AND strftime('%Y', sm.movement_date) = ?"; params.push(String(year)); }

  sql += ' ORDER BY sm.movement_date DESC, sm.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...params));
});

router.get('/dashboard', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const lowStock = db.prepare(`
    SELECT i.id, i.name, i.current_stock, i.reorder_level, i.unit, c.name AS category_name
    FROM inventory_items i
    LEFT JOIN stock_categories c ON c.id = i.category_id
    WHERE i.is_active = 1 AND i.current_stock <= i.reorder_level
    ORDER BY (i.reorder_level - i.current_stock) DESC, i.name
    LIMIT 8
  `).all();

  const latestMovements = db.prepare(`
    SELECT sm.id, sm.movement_date, sm.movement_type, sm.quantity, sm.notes,
           i.name AS item_name, i.unit
    FROM stock_movements sm
    JOIN inventory_items i ON i.id = sm.item_id
    ORDER BY sm.id DESC
    LIMIT 8
  `).all();

  res.json({ lowStock, latestMovements });
});

module.exports = router;
