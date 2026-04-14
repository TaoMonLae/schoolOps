// ── Shared utilities available globally ──────────────────────────────────────

// API wrapper
window.api = async function(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.blob();
};

// API wrapper for multipart/form-data
window.apiFormData = async function(path, formData, options = {}) {
  const res = await fetch(path, {
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
