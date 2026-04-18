window.StudentReceipts = function StudentReceipts() {
  const { showToast } = React.useContext(window.ToastContext);
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/api/student/me/receipts');
      setRows(result.receipts || []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const verifyReceipt = async (code) => {
    try {
      const result = await api(`/api/receipts/verify/${encodeURIComponent(code)}`);
      showToast(result.voided ? 'Receipt is valid but marked VOIDED' : 'Receipt is valid');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const downloadReceipt = async (row) => {
    try {
      await window.downloadWithAuth(`/api/student/me/receipts/${row.id}/pdf`, `${row.receipt_code}.pdf`);
      showToast('Receipt downloaded');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  if (loading) return <window.StatePanel type="loading" message="Loading your receipts…" />;

  return (
    <div className="card" style={{ padding:0 }}>
      <div className="table-scroll">
        <table className="mobile-stack-table">
          <thead><tr><th>Receipt Code</th><th>Amount</th><th>Paid Date</th><th>Period</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6}><window.StatePanel type="empty" compact message="No receipts yet." /></td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Receipt Code">{r.receipt_code}</td>
                <td data-label="Amount">{fmtRM(r.amount)}</td>
                <td data-label="Paid Date">{r.paid_date}</td>
                <td data-label="Period">{r.period_label}</td>
                <td data-label="Status"><window.StatusBadge status={r.status || 'active'} /></td>
                <td data-label="Actions">
                  <div className="table-row-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => verifyReceipt(r.receipt_code)}>Verify</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => downloadReceipt(r)}>Download</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
