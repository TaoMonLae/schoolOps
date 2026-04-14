// ── Shared UI primitives (maintainability layer) ────────────────────────────

window.FormValidator = {
  required(value, label) {
    if (String(value ?? '').trim()) return '';
    return `${label} is required`;
  },
  nonNegativeNumber(value, label) {
    if (value === '' || value == null) return `${label} is required`;
    if (Number.isNaN(Number(value))) return `${label} must be a number`;
    if (Number(value) < 0) return `${label} cannot be negative`;
    return '';
  },
  positiveNumber(value, label) {
    if (value === '' || value == null) return `${label} is required`;
    if (Number.isNaN(Number(value))) return `${label} must be a number`;
    if (Number(value) <= 0) return `${label} must be more than 0`;
    return '';
  },
};

window.validateFields = function(rules = []) {
  const errors = {};
  for (const rule of rules) {
    const msg = rule.check();
    if (msg) errors[rule.field] = msg;
  }
  return errors;
};

const STATE_ICONS = {
  loading: (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{opacity:.45}}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  ),
  empty: (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.45}}>
      <path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
    </svg>
  ),
  error: (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.45}}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  blocked: (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.45}}>
      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
};

window.StatePanel = function StatePanel({ type = 'empty', icon, message, compact = false }) {
  return (
    <div className={`empty ${compact ? 'empty-compact' : ''}`}>
      <div className="icon">{icon || STATE_ICONS[type] || STATE_ICONS.empty}</div>
      {message || 'No data'}
    </div>
  );
};

window.FilterBar = function FilterBar({ children, actions }) {
  return (
    <div className="filters">
      <div className="filters-main">{children}</div>
      {actions ? <div className="filters-actions">{actions}</div> : null}
    </div>
  );
};
