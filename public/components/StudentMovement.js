window.StudentMovement = function StudentMovement({ user }) {
  const { showToast } = React.useContext(window.ToastContext);
  const now = new Date();
  const defaultLeaveTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0, 0)
    .toISOString()
    .slice(0, 16);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [clockingIn, setClockingIn] = React.useState(false);
  const [student, setStudent] = React.useState(null);
  const [activeMovement, setActiveMovement] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [form, setForm] = React.useState({
    leave_time: defaultLeaveTime,
    destination: '',
    reason: '',
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/attendance/movements/self');
      setStudent(data.student || null);
      setActiveMovement(data.activeMovement || null);
      setHistory(data.rows || []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const handleClockOut = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/api/attendance/movements/self/clock-out', {
        method: 'POST',
        body: form,
      });
      showToast('Clock-out recorded');
      setForm((prev) => ({ ...prev, destination: '', reason: '' }));
      load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleClockIn = async () => {
    if (!activeMovement) return;
    setClockingIn(true);
    try {
      const result = await api(`/api/attendance/movements/self/${activeMovement.id}/clock-in`, {
        method: 'POST',
        body: { return_time: new Date().toISOString().slice(0, 16) },
      });
      showToast(result.compliance_status === 'returned_late' ? 'Clock-in recorded. You returned late.' : 'Clock-in recorded');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setClockingIn(false);
    }
  };

  if (user?.role !== 'student') {
    return <div className="empty"><div className="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.45}}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>Not allowed</div>;
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Student Out / In</div>
        <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
          Weekday self clock-out is available from 3:00 PM to 6:00 PM. Weekend outings must be approved and recorded by an admin.
        </div>
      </div>

      {loading ? (
        <div className="empty"><div className="icon">⏳</div>Loading…</div>
      ) : (
        <>
          {student && (
            <div className="stat-grid" style={{ marginBottom: 16 }}>
              <div className="stat-card">
                <div className="stat-label">Student</div>
                <div className="stat-value" style={{ fontSize: 18 }}>{student.name}</div>
                <div className="stat-sub">{student.level}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Current Status</div>
                <div className={`stat-value ${activeMovement ? 'stat-amber' : 'stat-green'}`} style={{ fontSize: 18 }}>
                  {activeMovement ? 'Out of School' : 'On Campus'}
                </div>
                <div className="stat-sub">
                  {activeMovement ? `Left at ${activeMovement.leave_time}` : 'No open outing record'}
                </div>
              </div>
            </div>
          )}

          {activeMovement ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Clock Back In</div>
              <div style={{ marginBottom: 12 }}>
                <strong>Destination:</strong> {activeMovement.destination || '—'}
              </div>
              <div style={{ marginBottom: 12 }}>
                <strong>Reason:</strong> {activeMovement.reason || '—'}
              </div>
              {activeMovement.expected_return_time && (
                <div style={{ marginBottom: 12, color: 'var(--muted)' }}>
                  Expected return time: {activeMovement.expected_return_time}
                </div>
              )}
              <button className="btn btn-primary" onClick={handleClockIn} disabled={clockingIn}>
                {clockingIn ? 'Saving…' : 'Clock In'}
              </button>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Clock Out</div>
              <form onSubmit={handleClockOut}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Leave Time</label>
                    <input
                      type="datetime-local"
                      value={form.leave_time}
                      onChange={(e) => setForm((prev) => ({ ...prev, leave_time: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Destination</label>
                    <input
                      value={form.destination}
                      onChange={(e) => setForm((prev) => ({ ...prev, destination: e.target.value }))}
                      placeholder="Optional destination"
                    />
                  </div>
                  <div className="form-group span2">
                    <label>Reason</label>
                    <input
                      value={form.reason}
                      onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
                      placeholder="Optional reason"
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Clock Out'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="card">
            <div className="card-title">My Movement History</div>
            <table>
              <thead>
                <tr>
                  <th>Leave Time</th>
                  <th>Return Time</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Destination / Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{row.leave_time}</td>
                    <td>{row.return_time || 'Still out'}</td>
                    <td><span className={`badge ${row.day_type === 'weekend' ? 'badge-amber' : 'badge-blue'}`}>{row.day_type}</span></td>
                    <td>
                      {!row.return_time && <span className="badge badge-blue">Out</span>}
                      {row.compliance_status === 'returned_on_time' && <span className="badge badge-green">Returned On Time</span>}
                      {row.compliance_status === 'returned_late' && <span className="badge badge-red">Returned Late</span>}
                    </td>
                    <td>
                      <div>{row.destination || '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.reason || 'No reason recorded'}</div>
                    </td>
                  </tr>
                ))}
                {!history.length && (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No movement records yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
