const { db } = require('../db/database');
const { buildArrearsRecords } = require('./arrears');

const CHANNELS = {
  IN_APP: 'in_app',
  EMAIL: 'email',
  SMS: 'sms',
};

function normalizeType(type) {
  return (type || 'general').toString().trim().toLowerCase().replace(/\s+/g, '_');
}

function createNotification({
  userId,
  type,
  title,
  message,
  entityType = null,
  entityId = null,
}) {
  if (!userId || !title || !message) return null;

  const result = db.prepare(`
    INSERT INTO notifications (
      user_id, type, title, message, entity_type, entity_id, is_read
    ) VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(
    userId,
    normalizeType(type),
    title.trim(),
    message.trim(),
    entityType,
    entityId || null,
  );

  return Number(result.lastInsertRowid);
}

function createNotificationsForUsers(userIds, payload) {
  const unique = [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!unique.length) return [];

  const tx = db.transaction(() => unique.map((userId) => createNotification({ userId, ...payload })));
  return tx().filter(Boolean);
}

function getInternalUserIdsByRoles(roles = ['admin', 'teacher']) {
  if (!roles.length) return [];
  const placeholders = roles.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id
    FROM users
    WHERE role IN (${placeholders})
      AND is_active = 1
      AND login_disabled = 0
  `).all(...roles);
  return rows.map((r) => r.id);
}

function createNotificationsForRoles(roles, payload) {
  const userIds = getInternalUserIdsByRoles(roles);
  return createNotificationsForUsers(userIds, payload);
}

function markNotificationRead(notificationId, userId) {
  const result = db.prepare(`
    UPDATE notifications
    SET is_read = 1
    WHERE id = ? AND user_id = ?
  `).run(notificationId, userId);
  return result.changes > 0;
}

function markAllNotificationsRead(userId) {
  const result = db.prepare(`
    UPDATE notifications
    SET is_read = 1
    WHERE user_id = ? AND is_read = 0
  `).run(userId);
  return result.changes;
}

function listNotifications({ userId, status = 'all', type = '', limit = 30 }) {
  let sql = `
    SELECT id, user_id, type, title, message, entity_type, entity_id, is_read, created_at
    FROM notifications
    WHERE user_id = ?
  `;
  const params = [userId];

  if (status === 'unread') sql += ' AND is_read = 0';
  if (type) {
    sql += ' AND type = ?';
    params.push(normalizeType(type));
  }

  sql += ' ORDER BY is_read ASC, datetime(created_at) DESC, id DESC LIMIT ?';
  params.push(Math.max(1, Math.min(Number(limit) || 30, 200)));

  return db.prepare(sql).all(...params);
}

function unreadCount(userId) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
  return row?.c || 0;
}

function reminderExists({ userId, type, entityType, entityId, sinceDate }) {
  const row = db.prepare(`
    SELECT id
    FROM notifications
    WHERE user_id = ?
      AND type = ?
      AND COALESCE(entity_type, '') = COALESCE(?, '')
      AND COALESCE(entity_id, -1) = COALESCE(?, -1)
      AND datetime(created_at) >= datetime(?)
    LIMIT 1
  `).get(userId, normalizeType(type), entityType || null, entityId || null, sinceDate);

  return !!row;
}

function generateUnpaidFeeReminderBatch({ actorId }) {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const records = buildArrearsRecords(month, year, { activeOnly: true });
  const candidates = records.filter((row) => row.overdue_months >= 2);
  const adminIds = getInternalUserIdsByRoles(['admin']);
  const startOfMonthIso = new Date(Date.UTC(year, month - 1, 1)).toISOString();

  let created = 0;
  const tx = db.transaction(() => {
    for (const student of candidates) {
      for (const adminId of adminIds) {
        const duplicate = reminderExists({
          userId: adminId,
          type: 'arrears_threshold_crossed',
          entityType: 'student',
          entityId: student.id,
          sinceDate: startOfMonthIso,
        });
        if (duplicate) continue;

        createNotification({
          userId: adminId,
          type: 'arrears_threshold_crossed',
          title: 'Arrears threshold crossed',
          message: `${student.name} is ${student.overdue_months} months overdue (${Number(student.outstanding_amount || 0).toFixed(2)} outstanding).`,
          entityType: 'student',
          entityId: student.id,
        });
        created += 1;
      }
    }
  });

  tx();

  return {
    month,
    year,
    processed_students: candidates.length,
    notifications_created: created,
    channel: CHANNELS.IN_APP,
    triggered_by: actorId || null,
  };
}

function generateLowStockReminderBatch({ actorId }) {
  const lowStockItems = db.prepare(`
    SELECT id, name, current_stock, reorder_level, unit
    FROM inventory_items
    WHERE is_active = 1
      AND current_stock <= reorder_level
    ORDER BY name
  `).all();

  const adminIds = getInternalUserIdsByRoles(['admin']);
  const sinceDate = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
  let created = 0;

  const tx = db.transaction(() => {
    for (const item of lowStockItems) {
      for (const adminId of adminIds) {
        const duplicate = reminderExists({
          userId: adminId,
          type: 'low_stock_alert',
          entityType: 'inventory_item',
          entityId: item.id,
          sinceDate,
        });
        if (duplicate) continue;

        createNotification({
          userId: adminId,
          type: 'low_stock_alert',
          title: 'Low stock alert',
          message: `${item.name} is low (${item.current_stock} ${item.unit}, reorder level ${item.reorder_level}).`,
          entityType: 'inventory_item',
          entityId: item.id,
        });
        created += 1;
      }
    }
  });

  tx();

  return {
    low_stock_items: lowStockItems.length,
    notifications_created: created,
    channel: CHANNELS.IN_APP,
    triggered_by: actorId || null,
  };
}

module.exports = {
  CHANNELS,
  createNotification,
  createNotificationsForUsers,
  createNotificationsForRoles,
  getInternalUserIdsByRoles,
  markNotificationRead,
  markAllNotificationsRead,
  listNotifications,
  unreadCount,
  generateUnpaidFeeReminderBatch,
  generateLowStockReminderBatch,
};
