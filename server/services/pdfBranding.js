const fs = require('fs');
const path = require('path');

const PUBLIC_ROOT = path.join(__dirname, '../../public');

function normalizeTheme(theme) {
  if (theme === 'dark_mode') return 'night_study';
  return theme || 'classic';
}

const PDF_THEME_TOKENS = {
  classic: {
    header: '#1a7a4a',
    pageBg: '#ffffff',
    cardBg: '#f8fafc',
    cardBorder: '#d1d5db',
    text: '#111827',
    muted: '#4b5563',
    accent: '#0f766e',
    watermark: '#ef4444',
  },
  night_study: {
    header: '#0f172a',
    pageBg: '#0c1220',
    cardBg: '#121a2c',
    cardBorder: '#24314f',
    text: '#edf3ff',
    muted: '#b3c1da',
    accent: '#1EAEDB',
    watermark: '#f87171',
  },
  figma_studio: {
    header: '#111111',
    pageBg: '#ffffff',
    cardBg: '#f9fafb',
    cardBorder: '#e5e7eb',
    text: '#111111',
    muted: '#4b5563',
    accent: '#2563eb',
    watermark: '#dc2626',
  },
  vercel_clean: {
    header: '#171717',
    pageBg: '#fafafa',
    cardBg: '#ffffff',
    cardBorder: '#e5e5e5',
    text: '#171717',
    muted: '#525252',
    accent: '#0068D6',
    watermark: '#dc2626',
  },
  composio_dark: {
    header: '#000000',
    pageBg: '#0f0f0f',
    cardBg: '#141414',
    cardBorder: '#2c2c2c',
    text: '#f5f5f5',
    muted: '#d1d5db',
    accent: '#00A3FF',
    watermark: '#f43f5e',
  },
  clay_playful: {
    header: '#02492a',
    pageBg: '#faf9f7',
    cardBg: '#ffffff',
    cardBorder: '#dad4c8',
    text: '#000000',
    muted: '#55534e',
    accent: '#43089f',
    watermark: '#fc7981',
  },
};

function getPdfThemeTokens(theme) {
  const normalized = normalizeTheme(theme);
  return PDF_THEME_TOKENS[normalized] || PDF_THEME_TOKENS.classic;
}

function resolvePublicAssetPath(urlPath) {
  if (!urlPath || typeof urlPath !== 'string' || !urlPath.startsWith('/')) return null;
  const absolutePath = path.resolve(PUBLIC_ROOT, `.${urlPath}`);
  const allowedRoot = `${path.resolve(PUBLIC_ROOT)}${path.sep}`;
  if (!absolutePath.startsWith(allowedRoot)) return null;
  if (!fs.existsSync(absolutePath)) return null;
  return absolutePath;
}

function drawPdfLogo(doc, logoUrl, {
  x = 50,
  y = 18,
  size = 44,
  padding = 4,
  background = '#ffffff',
  radius = 10,
} = {}) {
  const assetPath = resolvePublicAssetPath(logoUrl);
  if (!assetPath) return x;

  doc.save();
  doc.roundedRect(x, y, size, size, radius).fill(background);
  doc.image(assetPath, x + padding, y + padding, {
    fit: [size - (padding * 2), size - (padding * 2)],
    align: 'center',
    valign: 'center',
  });
  doc.restore();

  return x + size + 12;
}

module.exports = {
  drawPdfLogo,
  resolvePublicAssetPath,
  normalizeTheme,
  getPdfThemeTokens,
};
