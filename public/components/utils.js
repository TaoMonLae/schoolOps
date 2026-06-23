// ── Shared utilities available globally ──────────────────────────────────────

// ── Offline cache for GET responses ───────────────────────────────────────────
// Last successful JSON GET responses are stored so the app can show data when
// the device is offline. Only used as a fallback when a request fails to reach
// the network — online behaviour is unchanged.
const OFFLINE_CACHE_PREFIX = 'schoolops_cache:';
window.readOfflineCache = function (key) {
  try {
    const v = localStorage.getItem(OFFLINE_CACHE_PREFIX + key);
    return v ? JSON.parse(v) : undefined;
  } catch (_) { return undefined; }
};
window.writeOfflineCache = function (key, data) {
  try { localStorage.setItem(OFFLINE_CACHE_PREFIX + key, JSON.stringify(data)); } catch (_) {}
};

// Offline status banner (no plugin needed — uses webview online/offline events).
(function setupOfflineBanner() {
  if (typeof document === 'undefined') return;
  function ensureBanner() {
    let el = document.getElementById('offline-banner');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'offline-banner';
      el.textContent = 'Offline — showing last saved data';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#F6465D;color:#fff;text-align:center;padding:8px 12px;font-size:13px;font-weight:600;display:none;';
      document.body.appendChild(el);
    }
    return el;
  }
  function update() {
    const b = ensureBanner();
    if (b) b.style.display = (navigator.onLine === false) ? 'block' : 'none';
  }
  window.markOffline = function () { const b = ensureBanner(); if (b) b.style.display = 'block'; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update);
  else update();
})();

// API wrapper
window.api = async function(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const csrf = ['GET', 'HEAD', 'OPTIONS'].includes(method)
    ? {}
    : (window.csrfHeaders?.() || { 'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '' });

  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...csrf, ...(options.headers || {}) },
      credentials: 'include',
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (networkErr) {
    // Network unreachable (offline). Serve cached GET data when we have it.
    if (method === 'GET') {
      const cached = window.readOfflineCache(path);
      if (cached !== undefined) { window.markOffline?.(); return cached; }
    }
    throw new Error('You appear to be offline. Please check your connection.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (method === 'GET') window.writeOfflineCache(path, data);
    return data;
  }
  return res.blob();
};

// API wrapper for multipart/form-data
window.apiFormData = async function(path, formData, options = {}) {
  const method = (options.method || 'POST').toUpperCase();
  const csrf = ['GET', 'HEAD', 'OPTIONS'].includes(method)
    ? {}
    : (window.csrfHeaders?.() || { 'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '' });

  const res = await fetch(path, {
    headers: { ...csrf, ...(options.headers || {}) },
    credentials: 'include',
    ...options,
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.blob();
};

// Download helper (for export endpoints)
window.downloadFile = async function(url, filename) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Export failed' }));
    throw new Error(err.error || 'Export failed');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
};

window.downloadWithAuth = async function(url, filename) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'attachment';
  a.click();
};

// Toast context
window.ToastContext = React.createContext({ showToast: () => {} });

window.ToastProvider = function({ children }) {
  const [toasts, setToasts] = React.useState([]);

  const showToast = React.useCallback((message, type = 'success') => {
    const id = Date.now();
    const normalizedType = ['success', 'error', 'info'].includes(type) ? type : 'success';
    setToasts(t => [...t, { id, message, type: normalizedType }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  return (
    <window.ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </window.ToastContext.Provider>
  );
};

// Confirm dialog helper (uses browser native for simplicity)
window.confirm2 = (msg) => window.confirm(msg);

// Format currency
window.fmtCurrency = (n, currencyOverride) => {
  const currency = currencyOverride || window.APP_SETTINGS?.currency || 'RM';
  return `${currency} ${parseFloat(n || 0).toFixed(2)}`;
};
window.fmtRM = (n) => window.fmtCurrency(n);
window.todayLocalISO = () => {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60 * 1000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
};

// Month names
window.MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// Badge helper
window.StatusBadge = function({ status }) {
  const map = {
    pending:  ['badge-amber', 'Pending'],
    approved: ['badge-green', 'Approved'],
    flagged:  ['badge-red',   'Flagged'],
    active:   ['badge-green', 'Active'],
    inactive: ['badge-gray',  'Inactive'],
    paid:     ['badge-green', 'Paid'],
    unpaid:   ['badge-red',   'Unpaid'],
    current:  ['badge-green', 'Current'],
    overdue:  ['badge-amber', 'Overdue'],
    serious:  ['badge-red',   'Serious'],
    cash:     ['badge-blue',  'Cash'],
    bank_transfer: ['badge-blue', 'Bank Transfer'],
    online:   ['badge-blue',  'Online'],
    present: ['badge-green', 'Present'],
    absent: ['badge-red', 'Absent'],
    late: ['badge-amber', 'Late'],
    excused: ['badge-blue', 'Excused'],
    boarder: ['badge-blue', 'Boarder'],
    non_boarder: ['badge-gray', 'Non-boarder'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return <span className={`badge ${cls}`}>{label}</span>;
};

// Modal wrapper
window.Modal = function({ title, onClose, children, size = 'md' }) {
  React.useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal modal-${size}`}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div className="modal-title">{title}</div>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

// Pagination helper
window.Pagination = function({ page, total, perPage, onChange }) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return null;
  return (
    <div style={{ display:'flex', gap:6, justifyContent:'center', marginTop:16 }}>
      <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => onChange(page - 1)}>‹ Prev</button>
      <span style={{ padding:'5px 12px', fontSize:13, color:'var(--mid)' }}>{page} / {pages}</span>
      <button className="btn btn-secondary btn-sm" disabled={page === pages} onClick={() => onChange(page + 1)}>Next ›</button>
    </div>
  );
};
