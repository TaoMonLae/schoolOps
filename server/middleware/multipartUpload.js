const MAX_DEFAULT = 5 * 1024 * 1024;

function parseBoundary(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  return (match && (match[1] || match[2])) || null;
}

function parsePartHeaders(headerText) {
  const headers = {};
  for (const line of headerText.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    headers[key] = line.slice(idx + 1).trim();
  }
  return headers;
}

function parseDisposition(value) {
  const out = {};
  if (!value) return out;
  for (const token of value.split(';')) {
    const [rawKey, ...rest] = token.split('=');
    if (!rawKey || !rest.length) continue;
    const key = rawKey.trim().toLowerCase();
    const rawVal = rest.join('=').trim();
    out[key] = rawVal.replace(/^"|"$/g, '');
  }
  return out;
}

function multipartUpload({ fileField = 'file', maxFileSize = MAX_DEFAULT } = {}) {
  return (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return res.status(400).json({ error: 'Expected multipart/form-data request' });
    }

    const boundary = parseBoundary(contentType);
    if (!boundary) return res.status(400).json({ error: 'Missing multipart boundary' });

    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxFileSize + 1024 * 1024) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => res.status(400).json({ error: 'Failed to read upload body' }));

    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (!body.length) return res.status(400).json({ error: 'Upload body is empty' });

      const boundaryBuf = Buffer.from(`--${boundary}`);
      const parts = [];
      let start = 0;
      while (start < body.length) {
        const idx = body.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        const nextIdx = body.indexOf(boundaryBuf, idx + boundaryBuf.length);
        if (nextIdx === -1) break;
        parts.push(body.subarray(idx + boundaryBuf.length + 2, nextIdx - 2));
        start = nextIdx;
      }

      for (const part of parts) {
        if (!part.length) continue;
        const sep = part.indexOf(Buffer.from('\r\n\r\n'));
        if (sep === -1) continue;

        const headers = parsePartHeaders(part.subarray(0, sep).toString('utf8'));
        const disposition = parseDisposition(headers['content-disposition']);
        if (!disposition.name || !disposition.filename) continue;
        if (disposition.name !== fileField) continue;

        const fileBuffer = part.subarray(sep + 4);
        if (!fileBuffer.length) return res.status(400).json({ error: 'Uploaded file is empty' });
        if (fileBuffer.length > maxFileSize) {
          return res.status(400).json({ error: `File too large (max ${Math.floor(maxFileSize / (1024 * 1024))}MB)` });
        }

        req.uploadedFile = {
          fieldname: disposition.name,
          originalname: disposition.filename,
          mimetype: headers['content-type'] || 'application/octet-stream',
          size: fileBuffer.length,
          buffer: fileBuffer,
        };
        return next();
      }

      return res.status(400).json({ error: `Missing file field "${fileField}"` });
    });
  };
}

module.exports = { multipartUpload };
