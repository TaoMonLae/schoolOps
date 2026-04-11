const express = require('express');
const { audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  unreadCount,
  generateUnpaidFeeReminderBatch,
  generateLowStockReminderBatch,
} = require('../services/notifications');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = listNotifications({
    userId: req.user.id,
    status: (req.query.status || 'all').toString().toLowerCase(),
    type: req.query.type || '',
    limit: req.query.limit,
  });

  res.json(rows);
});

router.get('/summary', requireAuth, (req, res) => {
  res.json({ unread_count: unreadCount(req.user.id) });
});

router.post('/:id/read', requireAuth, (req, res) => {
  const ok = markNotificationRead(Number(req.params.id), req.user.id);
  if (!ok) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true });
});

router.post('/read-all', requireAuth, (req, res) => {
  const count = markAllNotificationsRead(req.user.id);
  res.json({ ok: true, updated: count });
});

router.post('/reminders/unpaid-fees', requireAuth, requireRole('admin'), (req, res) => {
  const result = generateUnpaidFeeReminderBatch({ actorId: req.user.id });
  audit(req.user.id, 'NOTIFY_BATCH_UNPAID', 'notifications', null, JSON.stringify(result));
  res.json(result);
});

router.post('/reminders/low-stock', requireAuth, requireRole('admin'), (req, res) => {
  const result = generateLowStockReminderBatch({ actorId: req.user.id });
  audit(req.user.id, 'NOTIFY_BATCH_LOW_STOCK', 'notifications', null, JSON.stringify(result));
  res.json(result);
});

module.exports = router;
