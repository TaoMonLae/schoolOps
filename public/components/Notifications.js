window.NotificationsBell = function NotificationsBell({ user }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState([]);
  const [unread, setUnread] = React.useState(0);
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [typeFilter, setTypeFilter] = React.useState('');

  const loadSummary = React.useCallback(async () => {
    const data = await api('/api/notifications/summary');
    setUnread(Number(data.unread_count || 0));
  }, []);

  const loadNotifications = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('status', statusFilter);
      params.set('limit', '60');
      if (typeFilter) params.set('type', typeFilter);
      const data = await api(`/api/notifications?${params.toString()}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, statusFilter, typeFilter]);

  React.useEffect(() => {
    loadSummary().catch(() => {});
    const timer = setInterval(() => loadSummary().catch(() => {}), 20000);
    return () => clearInterval(timer);
  }, [loadSummary]);

  React.useEffect(() => {
    if (open) loadNotifications();
  }, [open, loadNotifications]);

  const markRead = async (id) => {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST' });
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_read: 1 } : r)));
      loadSummary().catch(() => {});
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const markAllRead = async () => {
    try {
      await api('/api/notifications/read-all', { method: 'POST' });
      setRows((prev) => prev.map((r) => ({ ...r, is_read: 1 })));
      setUnread(0);
      showToast('All notifications marked as read');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const runBatch = async (kind) => {
    try {
      await api(`/api/notifications/reminders/${kind}`, { method: 'POST' });
      showToast('Reminder batch generated');
      loadNotifications();
      loadSummary().catch(() => {});
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="notification-wrap">
      <button className="notification-bell" onClick={() => setOpen((v) => !v)} title="Notifications">
        🔔
        {unread > 0 && <span className="notification-pill">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notification-panel">
          <div className="notification-panel-header">
            <strong>Notifications</strong>
            <button className="btn btn-secondary btn-sm" onClick={markAllRead}>Mark all read</button>
          </div>

          <div className="filters" style={{ marginBottom: 10 }}>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ minWidth: 100 }}>
              <option value="all">All</option>
              <option value="unread">Unread</option>
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ minWidth: 160 }}>
              <option value="">All types</option>
              <option value="duty_log_flagged">Duty flagged</option>
              <option value="duty_log_approved">Duty approved</option>
              <option value="password_reset">Password reset</option>
              <option value="first_login_password_change_needed">Password change needed</option>
              <option value="arrears_threshold_crossed">Arrears threshold</option>
              <option value="low_stock_alert">Low stock</option>
            </select>
            <button className="btn btn-secondary btn-sm" onClick={loadNotifications}>Refresh</button>
          </div>

          {user.role === 'admin' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button className="btn btn-amber btn-sm" onClick={() => runBatch('unpaid-fees')}>Unpaid-fee batch</button>
              <button className="btn btn-amber btn-sm" onClick={() => runBatch('low-stock')}>Low-stock batch</button>
            </div>
          )}

          {loading ? (
            <div style={{ color: 'var(--muted)', padding: '10px 4px' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty" style={{ padding: 18 }}>
              <div className="icon">✅</div>No notifications
            </div>
          ) : (
            <div className="notification-list">
              {rows.map((item) => (
                <div key={item.id} className={`notification-item ${item.is_read ? 'read' : 'unread'}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>{item.title}</strong>
                    {!item.is_read && <span className="badge badge-blue">new</span>}
                  </div>
                  <div style={{ color: 'var(--mid)', marginTop: 3 }}>{item.message}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <small style={{ color: 'var(--muted)' }}>{new Date(item.created_at).toLocaleString()}</small>
                    {!item.is_read && (
                      <button className="btn btn-secondary btn-sm" onClick={() => markRead(item.id)}>Mark read</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
