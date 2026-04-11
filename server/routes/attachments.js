const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, audit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { multipartUpload } = require('../middleware/multipartUpload');
const {
  ensureEntityExists,
  canView,
  canManage,
  writeAttachmentFile,
  resolveStoragePath,
  sanitizeFilename,
} = require('../services/attachments');

const router = express.Router();
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function parseEntity(req, res) {
  const entityType = req.params.entityType;
  const entityId = Number.parseInt(req.params.entityId, 10);

  if (!['expenditure', 'duty_log'].includes(entityType)) {
    res.status(400).json({ error: 'entityType must be expenditure or duty_log' });
    return null;
  }
  if (Number.isNaN(entityId) || entityId <= 0) {
    res.status(400).json({ error: 'Invalid entity id' });
    return null;
  }

  const entity = ensureEntityExists(entityType, entityId);
  if (!entity) {
    res.status(404).json({ error: `${entityType} not found` });
    return null;
  }

  return { entityType, entityId, entity };
}

router.post('/:entityType/:entityId', requireAuth, multipartUpload({ fileField: 'file', maxFileSize: MAX_FILE_SIZE }), (req, res) => {
  const parsed = parseEntity(req, res);
  if (!parsed) return;

  const { entityType, entityId, entity } = parsed;
  if (!canManage(req.user, entityType, entity)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const file = req.uploadedFile;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const { storedName, cleanedOriginalName } = writeAttachmentFile(entityType, file.originalname, file.mimetype, file.buffer);

    const result = db.prepare(`
      INSERT INTO attachments (
        entity_type, entity_id, original_name, stored_name, mime_type, file_size, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entityType, entityId, cleanedOriginalName, storedName, file.mimetype, file.size, req.user.id);

    audit(req.user.id, 'CREATE', 'attachments', result.lastInsertRowid, `Uploaded ${entityType} attachment ${cleanedOriginalName}`);
    return res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }
});

router.get('/:entityType/:entityId', requireAuth, (req, res) => {
  const parsed = parseEntity(req, res);
  if (!parsed) return;

  const { entityType, entityId, entity } = parsed;
  if (!canView(req.user, entityType, entity)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const rows = db.prepare(`
    SELECT a.*, u.name AS uploaded_by_name
    FROM attachments a
    LEFT JOIN users u ON u.id = a.uploaded_by
    WHERE a.entity_type = ? AND a.entity_id = ?
    ORDER BY a.uploaded_at DESC, a.id DESC
  `).all(entityType, entityId);

  return res.json(rows.map(r => ({
    ...r,
    can_delete: canManage(req.user, entityType, entity),
  })));
});

router.get('/:entityType/:entityId/:attachmentId/download', requireAuth, (req, res) => {
  const parsed = parseEntity(req, res);
  if (!parsed) return;

  const { entityType, entityId, entity } = parsed;
  if (!canView(req.user, entityType, entity)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const attachment = db.prepare(`
    SELECT * FROM attachments
    WHERE id = ? AND entity_type = ? AND entity_id = ?
  `).get(req.params.attachmentId, entityType, entityId);

  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

  const filePath = resolveStoragePath(entityType, attachment.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  const safeName = sanitizeFilename(attachment.original_name);
  res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  return res.sendFile(path.resolve(filePath));
});

router.delete('/:entityType/:entityId/:attachmentId', requireAuth, (req, res) => {
  const parsed = parseEntity(req, res);
  if (!parsed) return;

  const { entityType, entityId, entity } = parsed;
  if (!canManage(req.user, entityType, entity)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const attachment = db.prepare(`
    SELECT * FROM attachments
    WHERE id = ? AND entity_type = ? AND entity_id = ?
  `).get(req.params.attachmentId, entityType, entityId);

  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

  db.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id);
  const filePath = resolveStoragePath(entityType, attachment.stored_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  audit(req.user.id, 'DELETE', 'attachments', attachment.id, `Deleted ${entityType} attachment ${attachment.original_name}`);
  return res.json({ ok: true });
});

module.exports = router;
