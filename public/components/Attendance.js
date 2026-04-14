window.Attendance = function Attendance({ user }) {
  const { showToast } = React.useContext(window.ToastContext);
  const toLocalDateTimeInputValue = (dateValue = new Date()) => {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const today = new Date().toISOString().slice(0, 10);
  const isManager = user?.role === 'admin' || user?.role === 'teacher';

  const [tab, setTab] = React.useState('take');
  const [date, setDate] = React.useState(today);
  const [boarderFilter, setBoarderFilter] = React.useState('all');
  const [rows, setRows] = React.useState([]);
  const [summary, setSummary] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const [history, setHistory] = React.useState([]);
  const [historySummary, setHistorySummary] = React.useState([]);
  const [from, setFrom] = React.useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = React.useState(today);
  const [historyStatus, setHistoryStatus] = React.useState('all');

  const [movementRows, setMovementRows] = React.useState([]);
  const [movementSummary, setMovementSummary] = React.useState(null);
  const [movementStatus, setMovementStatus] = React.useState('all');
  const [movementForm, setMovementForm] = React.useState({
    student_id: '',
    leave_time: `${today}T15:00`,
    destination: '',
    reason: '',
  });
  const [movementSaving, setMovementSaving] = React.useState(false);
  const [clockingInId, setClockingInId] = React.useState(null);
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

  const [hostelSearch, setHostelSearch] = React.useState('');

  const loadDay = React.useCallback(async () => {
    setLoading(true);
    try {
      const [day, todaySummary] = await Promise.all([
        api(`/api/attendance?date=${date}&boarder=${boarderFilter}`),
        api('/api/attendance/today-summary'),
      ]);
      setRows((day.rows || []).map(r => ({ ...r, attendance_status: r.attendance_status || 'present' })));
      setSummary(todaySummary);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [date, boarderFilter]);

  const loadHistory = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/api/attendance/history?from=${from}&to=${to}&status=${historyStatus}&boarder=${boarderFilter}`);
      setHistory(data.rows || []);
      setHistorySummary(data.studentSummary || []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [from, to, historyStatus, boarderFilter]);

  const loadMovements = React.useCallback(async () => {
    setLoading(true);
    try {
      const [movementData, day] = await Promise.all([
        api(`/api/attendance/movements?date=${date}&status=${movementStatus}`),
        api(`/api/attendance?date=${date}&boarder=${boarderFilter}`),
      ]);
      setMovementRows(movementData.rows || []);
      setMovementSummary(movementData.summary || null);
      setRows((day.rows || []).map(r => ({ ...r, attendance_status: r.attendance_status || 'present' })));
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [date, movementStatus, boarderFilter]);

  React.useEffect(() => {
    if (tab === 'history') {
      loadHistory();
    } else if (tab === 'movement') {
      loadMovements();
    } else {
      loadDay();
    }
  }, [tab, loadHistory, loadDay, loadMovements]);

  const updateStatus = (studentId, attendanceStatus) => {
    setRows(prev => prev.map(r => (r.id === studentId ? { ...r, attendance_status: attendanceStatus } : r)));
  };

  const updateNotes = (studentId, notes) => {
    setRows(prev => prev.map(r => (r.id === studentId ? { ...r, attendance_notes: notes } : r)));
  };

  const saveAttendance = async () => {
    const records = rows
      .filter(r => !!r.attendance_status)
      .map(r => ({ student_id: r.id, status: r.attendance_status, notes: r.attendance_notes || null }));

    if (!records.length) {
      showToast('Set attendance status for at least one student', 'error');
      return;
    }

    setSaving(true);
    try {
      await api('/api/attendance/bulk', { method: 'POST', body: { date, records } });
      showToast(`Saved ${records.length} attendance records`);
      loadDay();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveHostel = async (row) => {
    try {
      await api(`/api/attendance/hostel/${row.id}`, {
        method: 'PUT',
        body: {
          dorm_house: row.dorm_house || null,
          room: row.room || null,
          bed_number: row.bed_number || null,
          hostel_status: row.hostel_status || 'non_boarder',
        },
      });
      showToast(`Updated hostel for ${row.name}`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleClockOut = async (e) => {
    e.preventDefault();
    if (!movementForm.student_id) {
      showToast('Select a student first', 'error');
      return;
    }

    setMovementSaving(true);
    try {
      const location = await getGpsPosition();
      await api('/api/attendance/movements/clock-out', {
        method: 'POST',
        body: { ...movementForm, ...location },
      });
      showToast('Student clocked out');
      setMovementForm((prev) => ({
        ...prev,
        student_id: '',
        destination: '',
        reason: '',
      }));
      loadMovements();
    } catch (e2) {
      showToast(e2.message, 'error');
    } finally {
      setMovementSaving(false);
    }
  };

  const handleClockIn = async (movement) => {
    setClockingInId(movement.id);
    try {
      const location = await getGpsPosition();
      const result = await api(`/api/attendance/movements/${movement.id}/clock-in`, {
        method: 'POST',
        body: {
          return_time: toLocalDateTimeInputValue(),
          ...location,
        },
      });
      const suffix = result.compliance_status === 'returned_late' ? ' (late return)' : '';
      showToast(`Student clocked in${suffix}`);
      loadMovements();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setClockingInId(null);
    }
  };

  const filteredHostelRows = rows.filter((r) => {
    const q = hostelSearch.toLowerCase();
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.level.toLowerCase().includes(q) || (r.dorm_house || '').toLowerCase().includes(q) || (r.room || '').toLowerCase().includes(q);
  });

  if (!isManager) return <div className="empty"><div className="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.45}}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>Not allowed</div>;

  return (
    <div>
      <div className="filters">
        <button className={`btn ${tab === 'take' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('take')}>Attendance Taking</button>
        <button className={`btn ${tab === 'history' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('history')}>Attendance History</button>
        <button className={`btn ${tab === 'movement' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('movement')}>Student Movement</button>
        <button className={`btn ${tab === 'hostel' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('hostel')}>Hostel Assignment</button>
        <div className="filters-spacer" />
        <select value={boarderFilter} onChange={(e) => setBoarderFilter(e.target.value)}>
          <option value="all">All Students</option>
          <option value="boarder">Boarders only</option>
          <option value="non_boarder">Non-boarders</option>
        </select>
      </div>

      {summary && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card"><div className="stat-label">Today Present</div><div className="stat-value stat-green">{summary.totals.present_count || 0}</div></div>
          <div className="stat-card"><div className="stat-label">Today Absent</div><div className="stat-value stat-red">{summary.totals.absent_count || 0}</div></div>
          <div className="stat-card"><div className="stat-label">Late</div><div className="stat-value stat-amber">{summary.totals.late_count || 0}</div></div>
          <div className="stat-card"><div className="stat-label">Not Marked</div><div className="stat-value">{summary.totals.not_marked_count || 0}</div></div>
          <div className="stat-card"><div className="stat-label">Currently Out</div><div className="stat-value stat-blue">{summary.movementTotals?.currently_out || 0}</div></div>
        </div>
      )}

      {tab === 'take' && (
        <div className="card">
          <div className="filters">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="btn btn-secondary" onClick={loadDay}>Reload</button>
            <div className="filters-spacer" />
            <button className="btn btn-primary" onClick={saveAttendance} disabled={saving}>{saving ? 'Saving…' : 'Save Attendance'}</button>
          </div>

          {loading ? <div className="empty"><div className="icon">⏳</div>Loading…</div> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Student</th><th>Hostel</th><th>Status</th><th>Notes</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.level}</div></td>
                      <td>{r.hostel_status === 'boarder' ? `${r.dorm_house || '—'} / ${r.room || '—'} ${r.bed_number ? `(Bed ${r.bed_number})` : ''}` : 'Non-boarder'}</td>
                      <td>
                        <select value={r.attendance_status} onChange={(e) => updateStatus(r.id, e.target.value)}>
                          <option value="present">Present</option>
                          <option value="absent">Absent</option>
                          <option value="late">Late</option>
                          <option value="excused">Excused</option>
                        </select>
                      </td>
                      <td><input value={r.attendance_notes || ''} onChange={(e) => updateNotes(r.id, e.target.value)} placeholder="Optional notes" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <div className="filters">
            <label style={{ marginBottom: 0 }}>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <label style={{ marginBottom: 0 }}>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <select value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="late">Late</option>
              <option value="excused">Excused</option>
            </select>
            <button className="btn btn-secondary" onClick={loadHistory}>Apply</button>
            <div className="filters-spacer" />
            <button className="btn btn-secondary" onClick={() => window.downloadFile(`/api/attendance/export/monthly?month=${Number(to.slice(5,7))}&year=${Number(to.slice(0,4))}`, 'monthly_attendance.csv')}>Export Monthly CSV</button>
          </div>

          <div className="split-grid-2">
            <div>
              <div className="card-title">Attendance Records</div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Date</th><th>Student</th><th>Status</th><th>Notes</th></tr></thead>
                  <tbody>
                    {history.slice(0, 200).map((r) => (
                      <tr key={r.id}><td>{r.attendance_date}</td><td>{r.student_name}</td><td><window.StatusBadge status={r.status} /></td><td>{r.notes || '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="card-title">Student Attendance %</div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Student</th><th>Present/Late/Excused</th><th>Absent</th><th>%</th></tr></thead>
                  <tbody>
                    {historySummary.map((r) => (
                      <tr key={r.student_id}>
                        <td>{r.student_name}</td>
                        <td>{(r.present_days || 0) + (r.late_days || 0) + (r.excused_days || 0)}</td>
                        <td>{r.absent_days || 0}</td>
                        <td style={{ fontWeight: 700, color: (r.attendance_percentage || 0) < 75 ? 'var(--red)' : 'var(--green)' }}>{r.attendance_percentage == null ? '—' : `${r.attendance_percentage}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'hostel' && (
        <div className="card">
          <div className="filters">
            <input className="students-search" placeholder="Search student / level / dorm" value={hostelSearch} onChange={(e) => setHostelSearch(e.target.value)} />
            <button className="btn btn-secondary" onClick={loadDay}>Reload</button>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Student</th><th>Hostel Status</th><th>Dorm/House</th><th>Room</th><th>Bed</th><th>Action</th></tr></thead>
              <tbody>
                {filteredHostelRows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.level}</div></td>
                    <td>
                      <select value={r.hostel_status || 'non_boarder'} onChange={(e) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, hostel_status: e.target.value } : x))}>
                        <option value="boarder">Boarder</option>
                        <option value="non_boarder">Non-boarder</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                    <td><input value={r.dorm_house || ''} onChange={(e) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, dorm_house: e.target.value } : x))} /></td>
                    <td><input value={r.room || ''} onChange={(e) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, room: e.target.value } : x))} /></td>
                    <td><input value={r.bed_number || ''} onChange={(e) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, bed_number: e.target.value } : x))} /></td>
                    <td><button className="btn btn-primary btn-sm" onClick={() => saveHostel(r)}>Save</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'movement' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Curfew Rules</div>
            <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              Weekdays: students may be clocked out only between 3:00 PM and 6:00 PM.
              Weekend outings require an admin to approve and record the clock-out.
              <br />
              GPS verification is required for clock-out and clock-in.
            </div>
          </div>

          {movementSummary && (
            <div className="stat-grid" style={{ marginBottom: 16 }}>
              <div className="stat-card"><div className="stat-label">Movement Logs</div><div className="stat-value">{movementSummary.total_logs || 0}</div></div>
              <div className="stat-card"><div className="stat-label">Currently Out</div><div className="stat-value stat-blue">{movementSummary.currently_out || 0}</div></div>
              <div className="stat-card"><div className="stat-label">Weekend Logs</div><div className="stat-value stat-amber">{movementSummary.weekend_logs || 0}</div></div>
              <div className="stat-card"><div className="stat-label">Late Returns</div><div className="stat-value stat-red">{movementSummary.late_returns || 0}</div></div>
              <div className="stat-card"><div className="stat-label">Tracking Interrupted</div><div className="stat-value stat-amber">{movementSummary.interrupted_tracking || 0}</div></div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Clock Out Student</div>
            <form onSubmit={handleClockOut}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Student</label>
                  <select value={movementForm.student_id} onChange={(e) => setMovementForm((prev) => ({ ...prev, student_id: e.target.value }))} required>
                    <option value="">Select student</option>
                    {rows.map((r) => (
                      <option key={r.id} value={r.id}>{r.name} ({r.level})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Leave Time</label>
                  <input type="datetime-local" value={movementForm.leave_time} onChange={(e) => setMovementForm((prev) => ({ ...prev, leave_time: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Destination</label>
                  <input value={movementForm.destination} onChange={(e) => setMovementForm((prev) => ({ ...prev, destination: e.target.value }))} placeholder="Optional destination" />
                </div>
                <div className="form-group">
                  <label>Reason</label>
                  <input value={movementForm.reason} onChange={(e) => setMovementForm((prev) => ({ ...prev, reason: e.target.value }))} placeholder="Optional reason" />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit" disabled={movementSaving}>{movementSaving ? 'Saving…' : 'Clock Out'}</button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="filters">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <select value={movementStatus} onChange={(e) => setMovementStatus(e.target.value)}>
                <option value="all">All Logs</option>
                <option value="open">Currently Out</option>
                <option value="closed">Returned</option>
                <option value="late">Late Returns</option>
              </select>
              <button className="btn btn-secondary" onClick={loadMovements}>Reload</button>
            </div>

            {loading ? <div className="empty"><div className="icon">⏳</div>Loading…</div> : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Leave Time</th>
                      <th>Return Time</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Destination / Reason</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementRows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.student_name}</strong>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.student_level}</div>
                        </td>
                        <td>{row.leave_time}</td>
                        <td>{row.return_time || 'Still out'}</td>
                        <td>
                          <div><span className={`badge ${row.day_type === 'weekend' ? 'badge-amber' : 'badge-blue'}`}>{row.day_type}</span></div>
                          {row.expected_return_time && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Due back by {row.expected_return_time.slice(11, 16)}</div>}
                        </td>
                        <td>
                          {!row.return_time && <span className="badge badge-blue">Out</span>}
                          {row.compliance_status === 'returned_on_time' && <span className="badge badge-green">Returned On Time</span>}
                          {row.compliance_status === 'returned_late' && <span className="badge badge-red">Returned Late</span>}
                          {row.approval_status === 'approved' && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Admin approved</div>}
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            GPS Out: {row.clock_out_verified ? 'Verified' : 'Not verified'} · GPS In: {row.return_time ? (row.clock_in_verified ? 'Verified' : 'Not verified') : 'Pending'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            Tracking: {row.tracking_status || 'active'}{row.tracking_last_ping_at ? ` · Last ping ${row.tracking_last_ping_at}` : ''}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            Pings: {row.tracking_ping_count || 0}{row.last_ping_distance_m != null ? ` · Last distance ${Number(row.last_ping_distance_m).toFixed(1)}m` : ''}
                          </div>
                        </td>
                        <td>
                          <div>{row.destination || '—'}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.reason || 'No reason recorded'}</div>
                        </td>
                        <td>
                          {!row.return_time ? (
                            <button className="btn btn-primary btn-sm" onClick={() => handleClockIn(row)} disabled={clockingInId === row.id}>
                              {clockingInId === row.id ? 'Saving…' : 'Clock In'}
                            </button>
                          ) : (
                            <span className="badge badge-gray">Closed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!movementRows.length && (
                      <tr>
                        <td colSpan="7" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No movement records for this filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {summary?.repeatedAbsenceAlerts?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Repeated Absence Alert (Last 14 Days)</div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Student</th><th>Level</th><th>Absences</th></tr></thead>
              <tbody>
                {summary.repeatedAbsenceAlerts.map((r) => (
                  <tr key={r.id}><td>{r.name}</td><td>{r.level}</td><td style={{ color: 'var(--red)', fontWeight: 700 }}>{r.absence_count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
