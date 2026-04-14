window.StudentFees = function StudentFees() {
  const { showToast } = React.useContext(window.ToastContext);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setData(await api('/api/student/me/fees'));
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  if (loading) return <window.StatePanel type="loading" message="Loading your fees…" />;
  if (!data) return <window.StatePanel type="empty" message="No fee data found." />;

  return (
    <div>
      <div className="cards" style={{ marginBottom: 14 }}>
        <div className="metric"><small>Current Month</small><h3>{(data.current_month_status?.status || 'unpaid').toUpperCase()}</h3></div>
        <div className="metric"><small>Outstanding</small><h3>{fmtRM(data.outstanding_amount || 0)}</h3></div>
        <div className="metric"><small>Overdue Months</small><h3>{data.overdue_months || 0}</h3></div>
      </div>

      <div className="card" style={{ padding:0 }}>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Period</th><th>Amount</th><th>Method</th><th>Paid Date</th><th>Status</th><th>Receipt</th></tr></thead>
            <tbody>
              {(data.payment_history || []).length === 0 ? (
                <tr><td colSpan={6}><window.StatePanel type="empty" compact message="No payment history yet." /></td></tr>
              ) : data.payment_history.map((p) => (
                <tr key={p.id}>
                  <td>{p.period_label}</td>
                  <td>{fmtRM(p.amount)}</td>
                  <td>{(p.method || '').replace('_', ' ')}</td>
                  <td>{p.paid_date}</td>
                  <td><window.StatusBadge status={p.status || 'active'} /></td>
                  <td>{p.receipt_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
