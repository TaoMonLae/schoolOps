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

window.StatePanel = function StatePanel({ type = 'empty', icon, message, compact = false }) {
  const iconMap = { loading: '⏳', empty: '📭', error: '⚠️', blocked: '⛔' };
  return (
    <div className={`empty ${compact ? 'empty-compact' : ''}`}>
      <div className="icon">{icon || iconMap[type] || 'ℹ️'}</div>
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
