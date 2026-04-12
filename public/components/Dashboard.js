window.Dashboard = function Dashboard({ user, setPage }) {
  const { showToast } = React.useContext(window.ToastContext);
  const now = new Date();
  const [month, setMonth] = React.useState(now.getMonth() + 1);
  const [year,  setYear]  = React.useState(now.getFullYear());
  const [data,  setData]  = React.useState(null);
  const [inventoryData, setInventoryData] = React.useState({ lowStock: [], latestMovements: [] });
  const [loading, setLoading] = React.useState(true);
  const [reminders, setReminders] = React.useState([]);
  const [attendance, setAttendance] = React.useState(null);

  const role = (user?.role || '').toLowerCase();

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [d, inv, notifs, att] = await Promise.all([
        api(`/api/reports/monthly?month=${month}&year=${year}`),
        api('/api/inventory/dashboard'),
        api('/api/notifications?status=unread&limit=5'),
        api('/api/attendance/today-summary'),
      ]);
      setData(d);
      setInventoryData(inv);
      setReminders(Array.isArray(notifs) ? notifs : []);
      setAttendance(att);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [month, year, showToast]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const handler = () => load();
    window.addEventListener('dashboard:refresh', handler);
    return () => window.removeEventListener('dashboard:refresh', handler);
  }, [load]);

  const years = [];
  for (let y = now.getFullYear(); y >= 2022; y--) years.push(y);

  if (loading) return <div className="empty"><div className="icon">⏳</div>Loading dashboard…</div>;
  if (!data)   return null;

  const netColor = data.netBalance >= 0 ? 'stat-green' : 'stat-red';
  const attendanceTotals = attendance?.totals || {};
  const todayNeedsAttention = (attendanceTotals.absent_count || 0) + reminders.length + inventoryData.lowStock.length;
  const attentionLabel = todayNeedsAttention > 0
    ? `${todayNeedsAttention} item${todayNeedsAttention > 1 ? 's' : ''} need attention`
    : 'Everything looks under control';
  const collectionRate = data.totalActive ? Math.round((data.paidThisMonth / data.totalActive) * 100) : 0;
  const attendanceRate = attendanceTotals.total_students ? Math.round(((attendanceTotals.present_count || 0) / attendanceTotals.total_students) * 100) : 0;
  const biggestRisk = data.unpaidThisMonth > inventoryData.lowStock.length
    ? `${data.unpaidThisMonth} student${data.unpaidThisMonth === 1 ? '' : 's'} still unpaid this month`
    : `${inventoryData.lowStock.length} stock item${inventoryData.lowStock.length === 1 ? '' : 's'} need replenishment`;
  const operationsChecklist = role === 'student'
    ? [
        { label: 'Submit today\'s duty log', value: 'Recommended first task' },
        { label: 'Check outing status', value: 'Clock out/in on time' },
        { label: 'Watch review feedback', value: `${reminders.length} reminder(s)` },
      ]
    : [
        { label: 'Attendance not yet marked', value: `${attendanceTotals.not_marked_count || 0} student${attendanceTotals.not_marked_count === 1 ? '' : 's'}` },
        { label: 'Unpaid this month', value: `${data.unpaidThisMonth} account${data.unpaidThisMonth === 1 ? '' : 's'}` },
        { label: 'Low stock alerts', value: `${inventoryData.lowStock.length} item${inventoryData.lowStock.length === 1 ? '' : 's'}` },
      ];

  const quickActions = role === 'student'
    ? [
        { icon: '✍️', title: 'Submit duty log', copy: 'Start the main task immediately.', meta: 'Fastest way to get work recorded', target: 'duty_submit' },
        { icon: '📜', title: 'Check my history', copy: 'See what was approved, flagged, or still pending.', meta: `${reminders.length} recent reminder(s)`, target: 'duty_history' },
      ]
    : role === 'teacher'
      ? [
          { icon: '🛏️', title: 'Take attendance', copy: 'Go straight to the daily roll call and save today\'s record.', meta: `${attendanceTotals.not_marked_count || 0} not yet marked`, target: 'attendance' },
          { icon: '📋', title: 'Review duty queue', copy: 'Open submitted logs and clear pending approvals.', meta: `${reminders.length} unread reminder(s)`, target: 'duty' },
          { icon: '💰', title: 'Check fee status', copy: 'See unpaid students and overdue balances.', meta: `${data.unpaidThisMonth} unpaid this month`, target: 'fees' },
          { icon: '📈', title: 'Open reports', copy: 'Generate monthly exports and summaries.', meta: `${window.MONTHS[month-1]} ${year}`, target: 'reports' },
        ]
      : [
          { icon: '👥', title: 'Manage roster', copy: 'Enroll, update, or review active students.', meta: `${data.totalActive} active students`, target: 'students' },
          { icon: '💰', title: 'Follow up fees', copy: 'See unpaid students and current outstanding totals.', meta: `${data.unpaidThisMonth} unpaid this month`, target: 'fees' },
          { icon: '🛏️', title: 'Take attendance', copy: 'Record today\'s attendance and hostel status.', meta: `${attendanceTotals.not_marked_count || 0} not marked yet`, target: 'attendance' },
          { icon: '📦', title: 'Low stock items', copy: 'Check inventory that may need replenishment soon.', meta: `${inventoryData.lowStock.length} low-stock alert(s)`, target: 'inventory' },
        ];

  return (
    <div className="section-stack">
      <div className="hero-card">
        <div className="hero-row">
          <div>
            <div className="hero-eyebrow">Today at a glance</div>
            <div className="hero-title">{attentionLabel}</div>
            <div className="hero-copy">
              {role === 'student'
                ? 'Your main job here is simple: submit today\'s duty log, then check the history page for feedback.'
                : 'Use the dashboard to spot the next problem first, then jump directly into the page where you can resolve it.'}
            </div>
            <div className="hero-meta">
              <div className="hero-pill"><span>Collection rate</span><strong>{collectionRate}%</strong></div>
              <div className="hero-pill"><span>Attendance today</span><strong>{attendanceRate}%</strong></div>
              <div className="hero-pill"><span>Priority</span><strong>{biggestRisk}</strong></div>
            </div>
            <div className="hero-actions">
              {role !== 'student' && <button className="btn btn-primary" onClick={() => setPage('attendance')}>🛏️ Attendance</button>}
              <button className="btn btn-primary" onClick={() => setPage(role === 'student' ? 'duty_submit' : 'fees')}>
                {role === 'student' ? '✍️ Submit duty log' : '💰 Fee follow-up'}
              </button>
            </div>
          </div>
          <div className="summary-strip" style={{ marginBottom: 0, minWidth: 'min(100%, 360px)' }}>
            <div className="summary-tile">
              <div className="summary-tile-label">Unread reminders</div>
              <div className="summary-tile-value">{reminders.length}</div>
              <div className="summary-tile-copy">Alerts waiting in the bell panel</div>
            </div>
            <div className="summary-tile">
              <div className="summary-tile-label">Attendance gaps</div>
              <div className="summary-tile-value">{attendanceTotals.not_marked_count || 0}</div>
              <div className="summary-tile-copy">Students not yet marked today</div>
            </div>
            <div className="summary-tile">
              <div className="summary-tile-label">Low stock</div>
              <div className="summary-tile-value">{inventoryData.lowStock.length}</div>
              <div className="summary-tile-copy">Inventory items below the reorder point</div>
            </div>
          </div>
        </div>
      </div>

      <div className="insight-grid">
        <div className="insight-card">
          <div className="card-kicker">Campus Pulse</div>
          <h3>Fee collection is at {collectionRate}% for {window.MONTHS[month - 1]}.</h3>
          <p>Use this as the quickest signal for which families or students may need follow-up before month-end.</p>
          <div className="insight-stat">{fmtRM(data.outstandingTotal)}</div>
          <div className="mini-list">
            <div className="mini-row"><span>Paid students</span><strong>{data.paidThisMonth}</strong></div>
            <div className="mini-row"><span>Unpaid students</span><strong>{data.unpaidThisMonth}</strong></div>
            <div className="mini-row"><span>Students in arrears</span><strong>{data.studentsInArrears}</strong></div>
          </div>
        </div>

        <div className="insight-card">
          <div className="card-kicker">Operations Checklist</div>
          <h3>{role === 'student' ? 'Keep your daily record complete.' : 'Clear these issues first today.'}</h3>
          <p>{role === 'student' ? 'A complete record makes review easier and prevents avoidable follow-up.' : 'These are the operational gaps most likely to create admin friction later in the day.'}</p>
          <div className="mini-list">
            {operationsChecklist.map((item) => (
              <div className="mini-row" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="insight-card">
          <div className="card-kicker">Finance Snapshot</div>
          <h3>{data.netBalance >= 0 ? 'The school is operating in surplus this month.' : 'Expenses are currently ahead of income.'}</h3>
          <p>Keep an eye on the balance between collected fees, approved spending, and stock-linked purchases.</p>
          <div className="insight-stat">{fmtRM(data.netBalance)}</div>
          <div className="mini-list">
            <div className="mini-row"><span>Fee income</span><strong>{fmtRM(data.feeIncome)}</strong></div>
            <div className="mini-row"><span>Total expenses</span><strong>{fmtRM(data.totalExpenses)}</strong></div>
            <div className="mini-row"><span>Unread reminders</span><strong>{reminders.length}</strong></div>
          </div>
        </div>
      </div>

      <div className="quick-grid">
        {quickActions.map((action) => (
          <button key={action.title} className="quick-card" type="button" onClick={() => setPage(action.target)}>
            <div style={{ fontSize: 24 }}>{action.icon}</div>
            <div className="quick-card-title">{action.title}</div>
            <div className="quick-card-copy">{action.copy}</div>
            <div className="quick-card-meta">{action.meta}</div>
          </button>
        ))}
      </div>

      <div className="filters" style={{ marginBottom: 4 }}>
        <div className="filters-main">
          <select value={month} onChange={e => setMonth(+e.target.value)} style={{ width: 140 }}>
            {window.MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(+e.target.value)} style={{ width: 100 }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="filters-actions">
          <button className="btn btn-secondary btn-sm" onClick={load}>🔄 Refresh</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Active Students</div>
          <div className="stat-value stat-blue">{data.totalActive}</div>
          <div className="stat-sub">enrolled</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Paid This Month</div>
          <div className="stat-value stat-green">{data.paidThisMonth}</div>
          <div className="stat-sub">students paid</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unpaid This Month</div>
          <div className="stat-value stat-red">{data.unpaidThisMonth}</div>
          <div className="stat-sub">students unpaid</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Students in Arrears</div>
          <div className="stat-value stat-amber">{data.studentsInArrears}</div>
          <div className="stat-sub">1+ month overdue</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Fee Income</div>
          <div className="stat-value stat-green">{fmtRM(data.feeIncome)}</div>
          <div className="stat-sub">{data.paidStudents} payments</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Outstanding</div>
          <div className="stat-value stat-red">{fmtRM(data.outstandingTotal)}</div>
          <div className="stat-sub">current month only</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Expenses</div>
          <div className="stat-value stat-amber">{fmtRM(data.totalExpenses)}</div>
          <div className="stat-sub">Duty + General</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Net Balance</div>
          <div className={`stat-value ${netColor}`}>{fmtRM(data.netBalance)}</div>
          <div className="stat-sub">Income − Expenses</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Today Attendance</div>
          <div className="stat-value stat-blue">{attendanceTotals.present_count || 0}/{attendanceTotals.total_students || 0}</div>
          <div className="stat-sub">present students</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Today Absent</div>
          <div className="stat-value stat-red">{attendanceTotals.absent_count || 0}</div>
          <div className="stat-sub">needs follow-up</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🔔 Reminder Cards</div>
        {reminders.length === 0 ? (
          <div style={{ color: 'var(--muted)' }}>No unread reminders.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {reminders.map((r) => (
              <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: '#f8fcff' }}>
                <strong>{r.title}</strong>
                <div style={{ color: 'var(--mid)' }}>{r.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="content-grid-2">
        <div className="section-stack">
          <div className="card table-card">
            <div className="card-head">
              <div className="card-title">🧍 Absent Students Today</div>
              {attendance?.absentStudents?.length ? <button className="btn btn-secondary btn-sm" onClick={() => setPage('attendance')}>Open attendance</button> : null}
            </div>
            {!attendance?.absentStudents?.length ? (
              <div style={{ color:'var(--muted)', padding: '0 18px 18px' }}>No absences recorded today.</div>
            ) : (
              <table>
                <thead><tr><th>Student</th><th>Level</th><th>Hostel</th><th>Notes</th></tr></thead>
                <tbody>
                  {attendance.absentStudents.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.level}</td>
                      <td>{s.hostel_status === 'boarder' ? `${s.dorm_house || '—'} / ${s.room || '—'}` : 'Non-boarder'}</td>
                      <td>{s.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card table-card">
            <div className="card-head">
              <div className="card-title">Outstanding Fees {window.MONTHS[month-1]} {year}</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage('fees')}>Open fees</button>
            </div>
            {data.outstanding.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                <div className="icon">✅</div>All students have paid!
              </div>
            ) : (
              <table>
                <thead><tr><th>Student</th><th>Fee</th></tr></thead>
                <tbody>
                  {data.outstanding.map((s, i) => (
                    <tr key={i}>
                      <td>{s.name}</td>
                      <td style={{ color:'var(--red)', fontWeight:600 }}>{fmtRM(s.fee_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card table-card">
            <div className="card-head">
              <div className="card-title">🕘 Latest Stock Movements</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage('inventory')}>Open inventory</button>
            </div>
            {inventoryData.latestMovements.length === 0 ? <div style={{ color:'var(--muted)', padding: '0 18px 18px' }}>No stock movements yet.</div> : (
              <table>
                <thead><tr><th>Date</th><th>Item</th><th>Type</th><th style={{ textAlign:'right' }}>Qty</th></tr></thead>
                <tbody>
                  {inventoryData.latestMovements.map((m) => (
                    <tr key={m.id}><td>{m.movement_date}</td><td>{m.item_name}</td><td><span className="badge badge-blue">{m.movement_type}</span></td><td style={{ textAlign:'right' }}>{m.quantity} {m.unit}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="section-stack">
          <div className="card table-card">
            <div className="card-head">
              <div className="card-title">Top Overdue Students</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage('fees')}>Go to fees</button>
            </div>
            {data.topOverdueStudents.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                <div className="icon">✅</div>No arrears for this period
              </div>
            ) : (
              <table>
                <thead><tr><th>Student</th><th>Overdue</th><th style={{ textAlign:'right' }}>Outstanding</th></tr></thead>
                <tbody>
                  {data.topOverdueStudents.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                        <div style={{ fontSize:12, color:'var(--muted)' }}>{s.level}</div>
                      </td>
                      <td>
                        {s.overdue_months} month{s.overdue_months > 1 ? 's' : ''}
                        <div><window.StatusBadge status={s.arrears_status} /></div>
                      </td>
                      <td style={{ textAlign:'right', color:'var(--red)', fontWeight:700 }}>{fmtRM(s.outstanding_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card table-card">
            <div className="card-head">
              <div className="card-title">📦 Low Stock Items</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage('inventory')}>Go to inventory</button>
            </div>
            {inventoryData.lowStock.length === 0 ? <div style={{ color:'var(--muted)', padding: '0 18px 18px' }}>No low stock alerts.</div> : (
              <table>
                <thead><tr><th>Item</th><th>Category</th><th style={{ textAlign:'right' }}>Stock</th></tr></thead>
                <tbody>
                  {inventoryData.lowStock.map((i) => (
                    <tr key={i.id}><td>{i.name}</td><td>{i.category_name || '—'}</td><td style={{ textAlign:'right', color:'var(--red)', fontWeight:700 }}>{i.current_stock} {i.unit}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
