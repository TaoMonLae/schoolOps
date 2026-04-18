// ── Main App Shell ────────────────────────────────────────────────────────────

const { useState, useEffect, useContext, useCallback, useMemo } = React;

function csrfHeaders() {
  const token = document.cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '';
  return { 'X-CSRF-Token': token };
}

window.csrfHeaders = csrfHeaders;

// ── Nav Icons (stroke-based SVG) ──────────────────────────────────────────────
function NavIcon({ name, size = 16 }) {
  const p = {
    width: size, height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { display: 'block', flexShrink: 0 },
  };
  switch (name) {
    case 'dashboard':
      return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case 'students':
      return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case 'attendance':
      return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 16 11 18 15 14"/></svg>;
    case 'fees':
      return <svg {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
    case 'duty':
      return <svg {...p}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>;
    case 'expenditures':
      return <svg {...p}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>;
    case 'inventory':
      return <svg {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>;
    case 'cashbook':
      return <svg {...p}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z"/></svg>;
    case 'ledger':
      return <svg {...p}><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polyline points="2 7 12 2 22 7"/></svg>;
    case 'reports':
      return <svg {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
    case 'users':
      return <svg {...p}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case 'settings':
      return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
    case 'health':
      return <svg {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
    case 'lock':
      return <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
    case 'edit':
      return <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    case 'clock':
      return <svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case 'arrows':
      return <svg {...p}><path d="M8 3L4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/></svg>;
    case 'bell':
      return <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
    case 'book':
      return <svg {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>;
    case 'moon':
      return <svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>;
    case 'sun':
      return <svg {...p}><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></svg>;
    default:
      return null;
  }
}

// ── Auth Context ──────────────────────────────────────────────────────────────
const AuthContext = React.createContext(null);
window.AuthContext = AuthContext;

const PAGE_META = {
  dashboard: {
    subtitle: 'Start here for today\'s numbers, alerts, and next actions.',
    ctaLabel: 'Refresh dashboard',
    ctaType: 'action',
    action: 'refresh',
  },
  students: {
    subtitle: 'Manage enrollment, contacts, and who needs fee follow-up.',
    ctaLabel: 'Go to fees',
    ctaType: 'page',
    targetPage: 'fees',
  },
  attendance: {
    subtitle: 'Take attendance fast, then review patterns and hostel assignments.',
    ctaLabel: 'Open dashboard',
    ctaType: 'page',
    targetPage: 'dashboard',
  },
  fees: {
    subtitle: 'See who has paid, who is overdue, and what needs attention next.',
    ctaLabel: 'Open reports',
    ctaType: 'page',
    targetPage: 'reports',
  },
  duty: {
    subtitle: 'Review submitted duty logs and clear the pending queue.',
    ctaLabel: 'View dashboard',
    ctaType: 'page',
    targetPage: 'dashboard',
  },
  duty_submit: {
    subtitle: 'Enter the duty once, attach proof if needed, and submit with confidence.',
    ctaLabel: 'View my history',
    ctaType: 'page',
    targetPage: 'duty_history',
  },
  duty_history: {
    subtitle: 'Track what you submitted and check each review result.',
    ctaLabel: 'Submit a new duty log',
    ctaType: 'page',
    targetPage: 'duty_submit',
  },
  student_movement: {
    subtitle: 'Clock yourself out and back in, and check your outing history.',
    ctaLabel: 'View my history',
    ctaType: 'page',
    targetPage: 'duty_history',
  },
  student_home: {
    subtitle: 'See your fee, duty, and outing summary in one place.',
    ctaLabel: 'Open my fees',
    ctaType: 'page',
    targetPage: 'student_fees',
  },
  student_fees: {
    subtitle: 'Track your payments, current status, and outstanding balance.',
    ctaLabel: 'Open my receipts',
    ctaType: 'page',
    targetPage: 'student_receipts',
  },
  student_receipts: {
    subtitle: 'Verify and download your payment receipts securely.',
    ctaLabel: 'Back to dashboard',
    ctaType: 'page',
    targetPage: 'student_home',
  },
  expenditures: {
    subtitle: 'Record general spending clearly so reports stay trustworthy.',
    ctaLabel: 'Open cashbook',
    ctaType: 'page',
    targetPage: 'cashbook',
  },
  inventory: {
    subtitle: 'Watch low stock, recent movements, and item balances in one place.',
    ctaLabel: 'Open dashboard',
    ctaType: 'page',
    targetPage: 'dashboard',
  },
  cashbook: {
    subtitle: 'Review day-to-day cash movement and keep balances aligned.',
    ctaLabel: 'Open ledger',
    ctaType: 'page',
    targetPage: 'ledger',
  },
  ledger: {
    subtitle: 'Inspect account balances and trace what changed.',
    ctaLabel: 'Open reports',
    ctaType: 'page',
    targetPage: 'reports',
  },
  reports: {
    subtitle: 'Generate the monthly picture and export the records people ask for.',
    ctaLabel: 'Back to dashboard',
    ctaType: 'page',
    targetPage: 'dashboard',
  },
  users: {
    subtitle: 'Control who can access the system and what they can do.',
  },
  settings: {
    subtitle: 'Update branding, system defaults, and backup tools.',
  },
  health: {
    subtitle: 'Check backup status, environment, and core system health.',
  },
  change_password: {
    subtitle: 'Update your password before continuing to other pages.',
  },
};

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    school_name: 'SchoolOps',
    subtitle: 'Finance & Operations Management',
    report_footer_text: 'Generated by SchoolOps',
    currency: 'RM',
    contact_block: '',
    theme: 'classic',
  });
  const [themeOverride, setThemeOverride] = useState(() => {
    try {
      return localStorage.getItem('schoolops_theme_override') || '';
    } catch (_) {
      return '';
    }
  });

  const refreshUser = useCallback(async () => {
    const me = await api('/api/auth/me');
    setUser(me);
    return me;
  }, []);

  const refreshSettings = useCallback(async () => {
    const data = await api('/api/settings/public');
    setSettings(data);
    window.APP_SETTINGS = data;
    return data;
  }, []);

  useEffect(() => {
    refreshSettings().catch(() => {});

    refreshUser()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [refreshUser, refreshSettings]);

  const lightTheme = settings.theme && settings.theme !== 'dark_mode' ? settings.theme : 'classic';
  const baseTheme = settings.theme === 'dark_mode' ? 'night_study' : lightTheme;
  const activeTheme = themeOverride || baseTheme;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeTheme);
  }, [activeTheme]);

  const setThemeMode = useCallback((mode) => {
    const next = mode === 'dark' ? 'night_study' : lightTheme;
    const override = next === baseTheme ? '' : next;
    setThemeOverride(override);
    try {
      if (override) {
        localStorage.setItem('schoolops_theme_override', override);
      } else {
        localStorage.removeItem('schoolops_theme_override');
      }
    } catch (_) {}
  }, [baseTheme, lightTheme]);

  const activeThemeMode = activeTheme === 'night_study' ? 'dark' : 'light';

  const login = useCallback(async (username, password) => {
    const u = await api('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, refreshUser, settings, refreshSettings, setThemeMode, activeThemeMode }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Login Page ────────────────────────────────────────────────────────────────
function LoginPage() {
  const { login, settings } = useContext(AuthContext);
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const showDemoCredentials = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  const handle = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await login(form.username, form.password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-shell" style={{ gridTemplateColumns: 'minmax(320px, 420px)', justifyContent: 'center' }}>
        <div className="login-card">
          <div className="login-logo">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt={`${settings.school_name} logo`} className="brand-logo brand-logo-login" />
            ) : (
              <div className="login-logo-mark">
                <NavIcon name="book" size={44} />
              </div>
            )}
            <h1>{settings.school_name}</h1>
            <small>{settings.subtitle}</small>
          </div>
          {error && <div className="login-error">{error}</div>}
          <form className="login-form" onSubmit={handle}>
            <div className="form-group">
              <label>Username</label>
              <input
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="Enter username"
                required autoFocus
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Enter password"
                required
              />
            </div>
            <button className="btn btn-primary login-submit" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          {showDemoCredentials && (
            <div style={{ marginTop: 20, padding: '12px 14px', background: '#f7faff', borderRadius: 14, fontSize: 12, color: 'var(--mid)', lineHeight: 1.8, border: '1px solid var(--border)' }}>
              <strong>Demo accounts (development only):</strong><br />
              Admin: <code>admin / admin123</code><br />
              Teacher: <code>teacher1 / teacher123</code><br />
              Student: <code>student1 / student123</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar & Nav ─────────────────────────────────────────────────────────────
const NAV_ADMIN = [
  { section: 'Overview' },
  { id: 'dashboard',   label: 'Dashboard',         icon: 'dashboard' },
  { section: 'Students' },
  { id: 'students',    label: 'Roster',             icon: 'students' },
  { id: 'attendance',  label: 'Attendance & Hostel',icon: 'attendance' },
  { id: 'fees',        label: 'Fee Payments',       icon: 'fees' },
  { section: 'Expenses' },
  { id: 'duty',        label: 'Duty Logs',          icon: 'duty' },
  { id: 'expenditures',label: 'General',            icon: 'expenditures' },
  { id: 'inventory',   label: 'Inventory',          icon: 'inventory' },
  { section: 'Finance' },
  { id: 'cashbook',    label: 'Cashbook',           icon: 'cashbook' },
  { id: 'ledger',      label: 'Ledger & Accounts',  icon: 'ledger' },
  { section: 'Reports' },
  { id: 'reports',     label: 'Monthly Report',     icon: 'reports' },
  { section: 'Access' },
  { id: 'users',       label: 'Users',              icon: 'users' },
  { id: 'settings',    label: 'Settings',           icon: 'settings' },
  { id: 'health',      label: 'System Status',      icon: 'health' },
  { id: 'change_password', label: 'Change Password',icon: 'lock' },
];

const NAV_TEACHER = [
  { section: 'Overview' },
  { id: 'dashboard',   label: 'Dashboard',         icon: 'dashboard' },
  { section: 'Students' },
  { id: 'students',    label: 'Roster',             icon: 'students' },
  { id: 'attendance',  label: 'Attendance & Hostel',icon: 'attendance' },
  { id: 'fees',        label: 'Fee Status',         icon: 'fees' },
  { section: 'Duty' },
  { id: 'duty',        label: 'Review Logs',        icon: 'duty' },
  { id: 'inventory',   label: 'Inventory',          icon: 'inventory' },
  { section: 'Finance' },
  { id: 'cashbook',    label: 'Cashbook',           icon: 'cashbook' },
  { id: 'ledger',      label: 'Ledger & Accounts',  icon: 'ledger' },
  { section: 'Reports' },
  { id: 'reports',     label: 'Monthly Report',     icon: 'reports' },
  { section: 'Account' },
  { id: 'change_password', label: 'Change Password',icon: 'lock' },
];

const NAV_STUDENT = [
  { section: 'My Portal' },
  { id: 'student_home',     label: 'My Dashboard',   icon: 'dashboard' },
  { id: 'duty_submit',      label: 'Submit Duty',    icon: 'edit' },
  { id: 'duty_history',     label: 'My Duty History',icon: 'clock' },
  { id: 'student_movement', label: 'Out / In',       icon: 'arrows' },
  { id: 'student_fees',     label: 'My Fees',        icon: 'fees' },
  { id: 'student_receipts', label: 'My Receipts',    icon: 'book' },
  { section: 'Account' },
  { id: 'change_password',  label: 'Change Password',icon: 'lock' },
];

function Sidebar({ page, setPage, user, logout, settings, mobileOpen, onClose }) {
  const role = (user?.role || '').toLowerCase().trim();
  const nav = role === 'admin'   ? NAV_ADMIN
            : role === 'teacher' ? NAV_TEACHER
            : NAV_STUDENT;

  const navigate = (target) => {
    setPage(target);
    if (onClose) onClose();
  };

  return (
    <>
      <div className={`sidebar-backdrop ${mobileOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-panel">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt={`${settings.school_name} logo`} className="brand-logo brand-logo-sidebar" />
            ) : null}
            <h1>{settings.school_name}</h1>
            <small>{settings.subtitle}</small>
         </div>
      </div>
        <nav className="sidebar-nav">
          {nav.map((item, i) =>
            item.section ? (
              <div key={i} className="nav-section">{item.section}</div>
            ) : (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
                type="button"
              >
                <span className="icon"><NavIcon name={item.icon} size={16} /></span>
                {item.label}
              </button>
            )
          )}
        </nav>
        <div className="sidebar-footer">
          <small>{user.name}</small><br />
          <small style={{ textTransform: 'capitalize' }}>{user.role}</small>
          <button className="logout-btn" onClick={logout}>Sign Out</button>
        </div>
      </div>
    </>
  );
}

// ── Page titles ───────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard:        'Dashboard',
  students:         'Student Roster',
  attendance:       'Attendance & Hostel',
  fees:             'Fee Payments',
  duty:             'Duty Logs',
  student_home:     'My Dashboard',
  duty_submit:      'Submit Duty Log',
  duty_history:     'My Duty History',
  student_movement: 'Student Out / In',
  student_fees:     'My Fees',
  student_receipts: 'My Receipts',
  expenditures:     'General Expenditures',
  inventory:        'Inventory & Stock',
  cashbook:         'Cashbook',
  ledger:           'Ledger & Accounts',
  reports:          'Monthly Report',
  users:            'User Management',
  settings:         'System Settings',
  health:           'System Status',
  change_password:  'Change Password',
};

function Topbar({ page, setPage, pageOptions, user, forcePasswordChange, onMenuToggle, onThemeToggle, themeMode }) {
  const pageMeta = PAGE_META[page] || {};
  const roleLabel = user?.role ? `${String(user.role).charAt(0).toUpperCase()}${String(user.role).slice(1)}` : 'Account';
  const identityLabel = `${user?.name || 'User'} · ${roleLabel}`;

  const handleCTA = () => {
    if (pageMeta.ctaType === 'page' && pageMeta.targetPage) setPage(pageMeta.targetPage);
    if (pageMeta.ctaType === 'action' && pageMeta.action === 'refresh') window.dispatchEvent(new CustomEvent('dashboard:refresh'));
  };

  return (
    <div className="topbar">
      <div className="topbar-leading">
        <button className="menu-toggle" onClick={onMenuToggle} type="button" aria-label="Open menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div className="page-heading">
          <div className="page-kicker">SchoolOps Workspace</div>
          <h2>{PAGE_TITLES[page] || page}</h2>
          <div className="topbar-identity mobile-only">{identityLabel}</div>
          <div className="page-subtitle">{pageMeta.subtitle || 'Use the navigation to move through the ledger.'}</div>
        </div>
      </div>
      <div className="topbar-trailing">
        <div className="topbar-meta desktop-only">
          <span className="context-chip role">
            <span>Role</span>
            <strong>{roleLabel}</strong>
          </span>
          <span className="context-chip">
            <span>Signed in as</span>
            <strong>{user?.name || 'User'}</strong>
          </span>
        </div>
        <select
          value={page}
          onChange={e => setPage(e.target.value)}
          className="topbar-page-select"
          disabled={forcePasswordChange}
        >
          {pageOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {pageMeta.ctaLabel ? (
          <button className="btn btn-secondary btn-sm topbar-cta" type="button" onClick={handleCTA} disabled={forcePasswordChange}>
            {pageMeta.ctaLabel}
          </button>
        ) : null}
        <button
          className="btn btn-secondary btn-sm topbar-cta"
          type="button"
          onClick={onThemeToggle}
          title={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`}
        >
          <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
            <NavIcon name={themeMode === 'dark' ? 'sun' : 'moon'} size={14} />
            {themeMode === 'dark' ? 'Light' : 'Dark'}
          </span>
        </button>
        <window.NotificationsBell user={user} />
        <span className="topbar-date desktop-only">
          {new Date().toLocaleDateString('en-MY', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}
        </span>
      </div>
    </div>
  );
}

// ── App Shell ────────────────────────────────────────────────────────────────
function AppShell() {
  const { user, logout, refreshUser, settings, refreshSettings, setThemeMode, activeThemeMode } = useContext(AuthContext);
  const role = (user?.role || '').toLowerCase().trim();

  const forcePasswordChange = !!user.must_change_password;

  const defaultPage = forcePasswordChange
    ? 'change_password'
    : role === 'student' ? 'student_home' : 'dashboard';

  const [page, setPage] = useState(defaultPage);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const nav = role === 'admin' ? NAV_ADMIN : role === 'teacher' ? NAV_TEACHER : NAV_STUDENT;
  const pageOptions = nav.filter(n => n.id);

  useEffect(() => {
    if (forcePasswordChange && page !== 'change_password') {
      setPage('change_password');
    }
  }, [forcePasswordChange, page]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [page]);

  useEffect(() => {
    const close = () => setMobileNavOpen(false);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (window.innerWidth <= 700 && mobileNavOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
    document.body.style.overflow = '';
    return undefined;
  }, [mobileNavOpen]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard':    return <window.Dashboard user={user} setPage={setPage} />;
      case 'students':     return <window.Students user={user} />;
      case 'attendance':   return <window.Attendance user={user} />;
      case 'fees':         return <window.Fees user={user} />;
      case 'duty':         return <window.DutyLog user={user} mode="review" />;
      case 'student_home': return <window.StudentHome user={user} />;
      case 'duty_submit':  return <window.DutyLog user={user} mode="submit" />;
      case 'duty_history': return <window.DutyLog user={user} mode="history" />;
      case 'student_movement': return <window.StudentMovement user={user} />;
      case 'student_fees': return <window.StudentFees user={user} />;
      case 'student_receipts': return <window.StudentReceipts user={user} />;
      case 'expenditures': return <window.Expenditures />;
      case 'inventory':    return <window.Inventory />;
      case 'cashbook':     return <window.Cashbook />;
      case 'ledger':       return <window.Ledger />;
      case 'reports':      return <window.Reports />;
      case 'users':        return role === 'admin' ? <window.UserManagement /> : <window.StatePanel type="blocked" message="Not allowed" />;
      case 'settings':
        return role === 'admin' ? <window.Settings mode="settings" onSaved={refreshSettings} /> : <window.StatePanel type="blocked" message="Not allowed" />;
      case 'health':
        return role === 'admin' ? <window.Settings mode="health" onSaved={refreshSettings} /> : <window.StatePanel type="blocked" message="Not allowed" />;
      case 'change_password':
        return (
          <window.ChangePassword
            forceMode={forcePasswordChange}
            onPasswordChanged={async () => {
              await refreshUser();
              if (role === 'student') setPage('student_home');
              else setPage('dashboard');
            }}
          />
        );
      default:             return <window.StatePanel type="empty" message="Page not found" />;
    }
  };

  return (
    <div className="layout">
      <Sidebar
        page={page}
        setPage={forcePasswordChange ? () => {} : setPage}
        user={user}
        logout={logout}
        settings={settings}
        mobileOpen={mobileNavOpen && !forcePasswordChange}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="main">
        <Topbar
          page={page}
          setPage={setPage}
          pageOptions={pageOptions}
          user={user}
          forcePasswordChange={forcePasswordChange}
          onMenuToggle={() => setMobileNavOpen(v => !v)}
          onThemeToggle={() => setThemeMode(activeThemeMode === 'dark' ? 'light' : 'dark')}
          themeMode={activeThemeMode}
        />
        <div className="page-content">
          {renderPage()}
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
function Root() {
  const { user, loading } = useContext(AuthContext);

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>
        <window.StatePanel type="loading" compact message="Loading app…" />
      </div>
    );
  }

  return user ? <AppShell /> : <LoginPage />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <window.ToastProvider>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </window.ToastProvider>
);
