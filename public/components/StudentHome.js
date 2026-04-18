window.StudentHome = function StudentHome() {
  const { showToast } = React.useContext(window.ToastContext);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/api/student/me/dashboard');
      setData(result);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  if (loading) return <window.StatePanel type="loading" message="Loading your dashboard…" />;
  if (!data) return <window.StatePanel type="empty" message="No dashboard data available." />;

  const latestPayment = data.fees?.most_recent_payment;
  const latestDuty = data.duty?.latest_submission;

  return (
    <div className="student-dashboard">
      <div className="cards" style={{ marginBottom: 14 }}>
        <div className="metric"><small>Current Fee Status</small><h3>{(data.fees?.current_month?.status || 'unpaid').toUpperCase()}</h3></div>
        <div className="metric"><small>Outstanding Amount</small><h3>{fmtRM(data.fees?.outstanding_amount || 0)}</h3></div>
        <div className="metric"><small>Overdue Months</small><h3>{data.fees?.overdue_months || 0}</h3></div>
        <div className="metric"><small>Current Outing</small><h3>{data.movement?.currently_out ? 'OUT' : 'IN CAMPUS'}</h3></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><h3>Latest Payment</h3></div>
        {latestPayment ? (
          <div style={{ display:'grid', gap:6 }}>
            <div><strong>Amount:</strong> {fmtRM(latestPayment.amount)}</div>
            <div><strong>Paid Date:</strong> {latestPayment.paid_date}</div>
            <div><strong>Period:</strong> {latestPayment.period_label}</div>
            <div><strong>Receipt:</strong> {latestPayment.receipt_code}</div>
          </div>
        ) : <window.StatePanel type="empty" compact message="No payments yet." />}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><h3>Latest Duty Submission</h3></div>
        {latestDuty ? (
          <div style={{ display:'grid', gap:6 }}>
            <div><strong>Duty No:</strong> {latestDuty.duty_number || `#${latestDuty.id}`}</div>
            <div><strong>Date:</strong> {latestDuty.date}</div>
            <div><strong>Status:</strong> <window.StatusBadge status={latestDuty.status} /></div>
          </div>
        ) : <window.StatePanel type="empty" compact message="No duty submissions yet." />}
      </div>
    </div>
  );
};
