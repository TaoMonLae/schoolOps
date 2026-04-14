const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSettings, updateSettings } = require('../services/settings');
const { audit } = require('../db/database');
const { multipartUpload } = require('../middleware/multipartUpload');

const router = express.Router();
const BRANDING_DIR = path.join(__dirname, '../../public/branding');
const MAX_LOGO_SIZE = 2 * 1024 * 1024;
const ALLOWED_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);

function ensureBrandingDir() {
  fs.mkdirSync(BRANDING_DIR, { recursive: true });
}

function removeStoredLogo(urlPath) {
  if (!urlPath || !urlPath.startsWith('/branding/')) return;
  const filename = path.basename(urlPath);
  const filePath = path.join(BRANDING_DIR, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

router.get('/public', (req, res) => {
  const s = getSettings();
  res.json({
    school_name: s.school_name,
    subtitle: s.subtitle,
    report_footer_text: s.report_footer_text,
    currency: s.currency,
    contact_block: s.contact_block,
    logo_url: s.logo_url,
    theme: s.theme,
  });
});

router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  res.json(getSettings());
});

router.put('/', requireAuth, requireRole('admin'), (req, res) => {
  const payload = {
    school_name: req.body.school_name,
    subtitle: req.body.subtitle,
    report_footer_text: req.body.report_footer_text,
    currency: req.body.currency,
    contact_block: req.body.contact_block,
    logo_url: req.body.logo_url,
    theme: req.body.theme,
  };

  const cleaned = Object.fromEntries(
    Object.entries(payload)
      .filter(([, value]) => value !== undefined)
      .map(([k, v]) => [k, String(v).trim()])
  );

  if (cleaned.school_name !== undefined && !cleaned.school_name) {
    return res.status(400).json({ error: 'School name cannot be empty' });
  }
  if (cleaned.currency !== undefined && !cleaned.currency) {
    return res.status(400).json({ error: 'Currency cannot be empty' });
  }
  const allowedThemes = ['classic', 'dark_mode', 'night_study', 'figma_studio', 'vercel_clean', 'composio_dark', 'clay_playful'];
  if (cleaned.theme !== undefined && !allowedThemes.includes(cleaned.theme)) {
    return res.status(400).json({ error: `Theme must be one of: ${allowedThemes.join(', ')}` });
  }

  const updated = updateSettings(cleaned);
  audit(req.user.id, 'UPDATE_SETTINGS', 'settings', null, 'System settings updated');
  res.json(updated);
});

router.post(
  '/logo',
  requireAuth,
  requireRole('admin'),
  multipartUpload({ fileField: 'logo', maxFileSize: MAX_LOGO_SIZE }),
  (req, res) => {
    const file = req.uploadedFile;
    if (!file) return res.status(400).json({ error: 'No logo file uploaded' });

    const ext = ALLOWED_MIME.get(file.mimetype);
    if (!ext) return res.status(400).json({ error: 'Logo must be a PNG, JPEG, or WEBP image' });

    ensureBrandingDir();
    const current = getSettings();
    const storedName = `logo-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const targetPath = path.join(BRANDING_DIR, storedName);
    fs.writeFileSync(targetPath, file.buffer);

    removeStoredLogo(current.logo_url);
    const logoUrl = `/branding/${storedName}`;
    const updated = updateSettings({ logo_url: logoUrl });
    audit(req.user.id, 'UPDATE_SETTINGS_LOGO', 'settings', null, `Updated school logo: ${logoUrl}`);
    res.json(updated);
  }
);

router.delete('/logo', requireAuth, requireRole('admin'), (req, res) => {
  const current = getSettings();
  removeStoredLogo(current.logo_url);
  const updated = updateSettings({ logo_url: '' });
  audit(req.user.id, 'DELETE_SETTINGS_LOGO', 'settings', null, 'Removed school logo');
  res.json(updated);
});

module.exports = router;
