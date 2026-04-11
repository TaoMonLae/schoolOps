const fs = require('fs');
const path = require('path');

const PUBLIC_ROOT = path.join(__dirname, '../../public');

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
};
