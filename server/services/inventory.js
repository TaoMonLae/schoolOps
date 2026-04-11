const { db } = require('../db/database');

function getSignedQuantity(type, quantity) {
  const q = Number(quantity || 0);
  if (type === 'purchase') return Math.abs(q);
  if (type === 'usage' || type === 'waste') return -Math.abs(q);
  return q;
}

function recordStockMovement({
  itemId,
  movementType,
  quantity,
  unitCost = null,
  movementDate,
  notes = null,
  refTable = null,
  refId = null,
  createdBy = null,
}) {
  const item = db.prepare('SELECT id FROM inventory_items WHERE id = ?').get(itemId);
  if (!item) throw new Error('Inventory item not found');

  const signedQty = getSignedQuantity(movementType, quantity);
  const tx = db.transaction(() => {
    const movement = db.prepare(`
      INSERT INTO stock_movements
      (item_id, movement_type, quantity, unit_cost, movement_date, notes, ref_table, ref_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId,
      movementType,
      signedQty,
      unitCost == null ? null : Number(unitCost),
      movementDate,
      notes,
      refTable,
      refId,
      createdBy,
    );

    db.prepare(`
      UPDATE inventory_items
      SET current_stock = current_stock + ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(signedQty, itemId);

    return movement.lastInsertRowid;
  });

  return tx();
}

function deleteStockMovementById(movementId) {
  const movement = db.prepare(`
    SELECT id, item_id, quantity
    FROM stock_movements
    WHERE id = ?
  `).get(movementId);

  if (!movement) return false;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE inventory_items
      SET current_stock = current_stock - ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(movement.quantity, movement.item_id);

    db.prepare('DELETE FROM stock_movements WHERE id = ?').run(movementId);
  });

  tx();
  return true;
}

function deleteStockMovementsByReference({ refTable, refId, movementType = null }) {
  const params = [refTable, refId];
  let sql = `
    SELECT id
    FROM stock_movements
    WHERE ref_table = ? AND ref_id = ?
  `;

  if (movementType) {
    sql += ' AND movement_type = ?';
    params.push(movementType);
  }

  const movementIds = db.prepare(sql).all(...params).map((row) => row.id);
  for (const movementId of movementIds) deleteStockMovementById(movementId);
  return movementIds.length;
}

module.exports = {
  recordStockMovement,
  deleteStockMovementById,
  deleteStockMovementsByReference,
};
