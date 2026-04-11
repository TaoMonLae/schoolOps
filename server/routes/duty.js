const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recordStockMovement, deleteStockMovementsByReference } = require('../services/inventory');
const { createNotification, createNotificationsForRoles } = require('../services/notifications');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function attachItems(logs) {
  const ids = logs.map(l => l.id);
  if (!ids.length) return logs;
  const items = db.prepare(
    `SELECT di.*, ii.name AS inventory_item_name, ii.unit AS inventory_item_unit
     FROM duty_items di
     LEFT JOIN inventory_items ii ON ii.id = di.inventory_item_id
     WHERE duty_log_id IN (${ids.map(() => '?').join(',')}) ORDER BY di.id`
  ).all(...ids);
  const map = {};
  for (const item of items) {
    if (!map[item.duty_log_id]) map[item.duty_log_id] = [];
    map[item.duty_log_id].push(item);
  }
  return logs.map(l => ({ ...l, items: map[l.id] || [] }));
}

function enrichLogs(rows) {
  return attachItems(rows.map(r => ({ ...r })));
}

function recordUsageForApprovedLog(logId, userId) {
  const items = db.prepare(`
    SELECT id, inventory_item_id, stock_quantity_used
    FROM duty_items
    WHERE duty_log_id = ? AND inventory_item_id IS NOT NULL AND stock_quantity_used IS NOT NULL AND stock_recorded = 0
  `).all(logId);

  for (const item of items) {
    recordStockMovement({
      itemId: item.inventory_item_id,
      movementType: 'usage',
      quantity: item.stock_quantity_used,
      movementDate: new Date().toISOString().slice(0, 10),
      notes: `Consumed in duty log #${logId}`,
      refTable: 'duty_logs',
      refId: logId,
      createdBy: userId,
    });

    db.prepare('UPDATE duty_items SET stock_recorded = 1 WHERE id = ?').run(item.id);
  }
}

function reverseUsageForLog(logId) {
  deleteStockMovementsByReference({
    refTable: 'duty_logs',
    refId: logId,
    movementType: 'usage',
  });

  db.prepare(`
    UPDATE duty_items
    SET stock_recorded = 0
    WHERE duty_log_id = ? AND inventory_item_id IS NOT NULL AND stock_quantity_used IS NOT NULL
  `).run(logId);
}

// GET /api/duty — all logs (admin/teacher), or own logs (student)
router.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'student') {
    rows = db.prepare(`
      SELECT dl.*, u.name AS submitted_by_name, rv.name AS reviewed_by_name,
             COALESCE(att.attachment_count, 0) AS attachment_count
      FROM duty_logs dl
      JOIN users u ON u.id = dl.submitted_by
      LEFT JOIN users rv ON rv.id = dl.reviewed_by
      LEFT JOIN (
        SELECT entity_id, COUNT(*) AS attachment_count
        FROM attachments
        WHERE entity_type = 'duty_log'
        GROUP BY entity_id
      ) att ON att.entity_id = dl.id
      WHERE dl.submitted_by = ?
      ORDER BY dl.date DESC
    `).all(req.user.id);
  } else {
    const { status } = req.query;
    let sql = `
      SELECT dl.*, u.name AS submitted_by_name, rv.name AS reviewed_by_name,
             COALESCE(att.attachment_count, 0) AS attachment_count
      FROM duty_logs dl
      JOIN users u ON u.id = dl.submitted_by
      LEFT JOIN users rv ON rv.id = dl.reviewed_by
      LEFT JOIN (
        SELECT entity_id, COUNT(*) AS attachment_count
        FROM attachments
        WHERE entity_type = 'duty_log'
        GROUP BY entity_id
      ) att ON att.entity_id = dl.id
    `;
    const params = [];
    if (status) { sql += ' WHERE dl.status = ?'; params.push(status); }
    sql += ' ORDER BY dl.date DESC';
    rows = db.prepare(sql).all(...params);
  }
  res.json(enrichLogs(rows));
});

// GET /api/duty/date/:date — logs for a specific date
router.get('/date/:date', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const rows = db.prepare(`
    SELECT dl.*, u.name AS submitted_by_name, rv.name AS reviewed_by_name,
           COALESCE(att.attachment_count, 0) AS attachment_count
    FROM duty_logs dl
    JOIN users u ON u.id = dl.submitted_by
    LEFT JOIN users rv ON rv.id = dl.reviewed_by
    LEFT JOIN (
      SELECT entity_id, COUNT(*) AS attachment_count
      FROM attachments
      WHERE entity_type = 'duty_log'
      GROUP BY entity_id
    ) att ON att.entity_id = dl.id
    WHERE dl.date = ?
    ORDER BY dl.id
  `).all(req.params.date);
  res.json(enrichLogs(rows));
});

// GET /api/duty/:id — single log
router.get('/:id', requireAuth, (req, res) => {
  const log = db.prepare(`
    SELECT dl.*, u.name AS submitted_by_name, rv.name AS reviewed_by_name,
           COALESCE(att.attachment_count, 0) AS attachment_count
    FROM duty_logs dl
    JOIN users u ON u.id = dl.submitted_by
    LEFT JOIN users rv ON rv.id = dl.reviewed_by
    LEFT JOIN (
      SELECT entity_id, COUNT(*) AS attachment_count
      FROM attachments
      WHERE entity_type = 'duty_log'
      GROUP BY entity_id
    ) att ON att.entity_id = dl.id
    WHERE dl.id = ?
  `).get(req.params.id);

  if (!log) return res.status(404).json({ error: 'Duty log not found' });

  // Students may only see their own
  if (req.user.role === 'student' && log.submitted_by !== req.user.id)
    return res.status(403).json({ error: 'Access denied' });

  const items = db.prepare(`
    SELECT di.*, ii.name AS inventory_item_name, ii.unit AS inventory_item_unit
    FROM duty_items di
    LEFT JOIN inventory_items ii ON ii.id = di.inventory_item_id
    WHERE di.duty_log_id = ?
    ORDER BY di.id
  `).all(log.id);
  res.json({ ...log, items });
});

// POST /api/duty — submit (student or admin/teacher on behalf)
router.post('/', requireAuth, (req, res) => {
  const { duty_number, date, items, notes } = req.body;
  if (!duty_number || !date || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'duty_number, date, and at least one item required' });

  const insertLog = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO duty_logs (duty_number, submitted_by, date, status, notes)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(duty_number, req.user.id, date, notes || null);

    const logId = result.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO duty_items (duty_log_id, item_name, quantity, unit_price, total_price, inventory_item_id, stock_quantity_used)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unit_price) || 0;
      const stockQty = item.stock_quantity_used == null || item.stock_quantity_used === ''
        ? null
        : Number(item.stock_quantity_used);

      insertItem.run(
        logId,
        item.item_name,
        qty,
        price,
        qty * price,
        item.inventory_item_id || null,
        stockQty,
      );
    }

    return logId;
  });

  const logId = insertLog();
  audit(req.user.id, 'CREATE', 'duty_logs', logId, `Submitted duty ${duty_number}`);
  res.status(201).json({ id: logId });
});

// PUT /api/duty/:id/status — approve or flag (admin/teacher)
router.put('/:id/status', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { status, notes } = req.body;
  if (!['approved', 'flagged', 'pending'].includes(status))
    return res.status(400).json({ error: 'status must be approved, flagged, or pending' });

  const log = db.prepare('SELECT id, status, submitted_by, duty_number FROM duty_logs WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Duty log not found' });

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE duty_logs
      SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(status, req.user.id, notes || null, req.params.id);

    if (status !== 'approved' && log.status === 'approved') {
      reverseUsageForLog(Number(req.params.id));
    }

    if (status === 'approved' && log.status !== 'approved') {
      recordUsageForApprovedLog(Number(req.params.id), req.user.id);
    }
  });

  tx();

  if (status === 'flagged') {
    createNotification({
      userId: log.submitted_by,
      type: 'duty_log_flagged',
      title: 'Duty log flagged',
      message: `Your duty log ${log.duty_number || `#${log.id}`} was flagged for review.`,
      entityType: 'duty_log',
      entityId: log.id,
    });

    createNotificationsForRoles(['admin', 'teacher'], {
      type: 'duty_log_flagged',
      title: 'Duty log flagged',
      message: `Duty log ${log.duty_number || `#${log.id}`} has been flagged.`,
      entityType: 'duty_log',
      entityId: log.id,
    });
  }

  if (status === 'approved') {
    createNotification({
      userId: log.submitted_by,
      type: 'duty_log_approved',
      title: 'Duty log approved',
      message: `Your duty log ${log.duty_number || `#${log.id}`} has been approved.`,
      entityType: 'duty_log',
      entityId: log.id,
    });
  }

  audit(req.user.id, 'REVIEW', 'duty_logs', req.params.id, `Status → ${status}`);
  res.json({ ok: true });
});

module.exports = router;
