window.StudentMovement = function StudentMovement({ user }) {
  const { showToast } = React.useContext(window.ToastContext);
  const toLocalDateTimeInputValue = (date = new Date()) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const now = new Date();
  const defaultLeaveTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0, 0);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [clockingIn, setClockingIn] = React.useState(false);
  const [student, setStudent] = React.useState(null);
  const [activeMovement, setActiveMovement] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [trackingMessage, setTrackingMessage] = React.useState('');
  const trackingIntervalRef = React.useRef(null);
  const geolocationFailCountRef = React.useRef(0);
  const [form, setForm] = React.useState({
    leave_time: toLocalDateTimeInputValue(defaultLeaveTime),
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

  const getGpsPosition = React.useCallback(() => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device/browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      (error) => {
        if (error.code === 1) reject(new Error('Location permission denied. Enable location and try again.'));
        else if (error.code === 2) reject(new Error('Location unavailable. Please move to an open area and try again.'));
        else if (error.code === 3) reject(new Error('Location request timed out. Please try again.'));
        else reject(new Error('Unable to get current location.'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }), []);

  const updateTrackingStatus = React.useCallback(async (movementId, status) => {
    try {
      await api(`/api/attendance/movements/self/${movementId}/tracking-status`, {
        method: 'POST',
        body: { status },
      });
    } catch (err) {
      // best effort status update
    }
  }, []);

  const sendLocationPing = React.useCallback(async (movementId) => {
    try {
      const location = await getGpsPosition();
      geolocationFailCountRef.current = 0;
      await api(`/api/attendance/movements/self/${movementId}/ping`, {
        method: 'POST',
        body: location,
      });
      setTrackingMessage('Tracking active. Location updates are best-effort while this page stays open.');
      await updateTrackingStatus(movementId, 'active');
    } catch (err) {
      geolocationFailCountRef.current += 1;
      if (geolocationFailCountRef.current >= 2) {
        await updateTrackingStatus(movementId, 'interrupted');
        setTrackingMessage('Tracking interrupted. Keep this page open and location on to resume updates.');
      }
    }
  }, [getGpsPosition, updateTrackingStatus]);

  React.useEffect(() => {
    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }
    if (!activeMovement || !activeMovement.id || activeMovement.return_time) return undefined;

    setTrackingMessage('Tracking active. Location updates are best-effort while this page stays open.');
    sendLocationPing(activeMovement.id);
    trackingIntervalRef.current = setInterval(() => {
      sendLocationPing(activeMovement.id);
    }, 10 * 60 * 1000);

    const onVisibilityChange = async () => {
      if (document.hidden) {
        setTrackingMessage('Tracking may stop while app/browser is in background.');
        await updateTrackingStatus(activeMovement.id, 'interrupted');
      } else {
        setTrackingMessage('Tracking active. Location updates are best-effort while this page stays open.');
        await sendLocationPing(activeMovement.id);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (trackingIntervalRef.current) {
        clearInterval(trackingIntervalRef.current);
        trackingIntervalRef.current = null;
      }
    };
  }, [activeMovement, sendLocationPing, updateTrackingStatus]);

  const handleClockOut = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const location = await getGpsPosition();
      await api('/api/attendance/movements/self/clock-out', {
        method: 'POST',
        body: { ...form, ...location },
      });
      showToast('Clock-out recorded');
      setTrackingMessage('Tracking active. Location updates are best-effort while this page stays open.');
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
      const location = await getGpsPosition();
      const result = await api(`/api/attendance/movements/self/${activeMovement.id}/clock-in`, {
        method: 'POST',
        body: { return_time: toLocalDateTimeInputValue(), ...location },
      });
      showToast(result.compliance_status === 'returned_late' ? 'Clock-in recorded. You returned late.' : 'Clock-in recorded');
      setTrackingMessage('');
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
          <br />
          Clock Out / In works only when you are at school and location is turned on.
          <br />
          Location tracking continues while this page stays open.
          <br />
          If you close the page or your browser stops tracking, staff may need to review your outing.
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
            <div className="card" style={{ marginBottom: 16, maxWidth: '100%' }}>
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
              <div style={{ marginBottom: 12, color: 'var(--muted)' }}>
                Tracking status: <strong>{activeMovement.tracking_status || 'active'}</strong>
                {activeMovement.tracking_last_ping_at ? ` · Last ping: ${activeMovement.tracking_last_ping_at}` : ' · No pings yet'}
              </div>
              {trackingMessage && (
                <div style={{ marginBottom: 12, color: 'var(--muted)' }}>{trackingMessage}</div>
              )}
              <button className="btn btn-primary" onClick={handleClockIn} disabled={clockingIn}>
                {clockingIn ? 'Saving…' : 'Clock In'}
              </button>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 16, maxWidth: '100%' }}>
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

          <div className="card" style={{ maxWidth: '100%' }}>
            <div className="card-title">My Movement History</div>
            <div className="table-scroll table-scroll-compact">
            <table>
              <thead>
                <tr>
                  <th>Leave Time</th>
                  <th>Return Time</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>GPS Verification</th>
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
                      <div>Out: {row.clock_out_verified ? 'Verified' : 'Not verified'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>In: {row.return_time ? (row.clock_in_verified ? 'Verified' : 'Not verified') : 'Pending'}</div>
                    </td>
                    <td>
                      <div>{row.destination || '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.reason || 'No reason recorded'}</div>
                    </td>
                  </tr>
                ))}
                {!history.length && (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No movement records yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
