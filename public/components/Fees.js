window.Fees = function Fees({ user }) {
  const { showToast } = React.useContext(window.ToastContext);
  const now = new Date();
  const [month, setMonth] = React.useState(now.getMonth() + 1);
  const [year,  setYear]  = React.useState(now.getFullYear());
  const [rows,     setRows]    = React.useState([]);
  const [students, setStudents]= React.useState([]);
  const [loading,  setLoading] = React.useState(true);
  const [modal,    setModal]   = React.useState(false);
  const [saving,   setSaving]  = React.useState(false);
  const [search,   setSearch]  = React.useState('');
  const [statusTab, setStatusTab] = React.useState('all'); // all | paid | unpaid | overdue
  const [page,     setPage]    = React.useState(1);
  const [paymentModal, setPaymentModal] = React.useState(false);
  const [activePayment, setActivePayment] = React.useState(null);
  const [loadingPayment, setLoadingPayment] = React.useState(false);
  const PER = 20;

  const EMPTY_FORM = { student_id:'', amount:'', paid_date: new Date().toISOString().slice(0,10), method:'cash', period_month: now.getMonth()+1, period_year: now.getFullYear(), notes:'' };
  const [form, setForm] = React.useState(EMPTY_FORM);

  const years = [];
  for (let y = now.getFullYear(); y >= 2022; y--) years.push(y);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [fees, studs] = await Promise.all([
        api(`/api/fees?month=${month}&year=${year}`),
        api(`/api/students/arrears?month=${month}&year=${year}`),
      ]);
      setRows(fees);
      setStudents(studs);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [month, year]);

  React.useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => {
    const q = search.toLowerCase();
    return !q || r.student_name.toLowerCase().includes(q);
  });
  const paged = filtered.slice((page-1)*PER, page*PER);

  const filteredStudents = students.filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !q || s.name.toLowerCase().includes(q) || s.level.toLowerCase().includes(q);
    if (!matchSearch) return false;
    if (statusTab === 'paid') return s.current_month_status === 'paid';
    if (statusTab === 'unpaid') return s.current_month_status === 'unpaid';
    if (statusTab === 'overdue') return s.overdue_months > 0;
    return true;
  });

  const stats = {
    all: students.length,
    paid: students.filter(s => s.current_month_status === 'paid').length,
    unpaid: students.filter(s => s.current_month_status === 'unpaid').length,
    overdue: students.filter(s => s.overdue_months > 0).length,
  };

  const handleStudentChange = (sid) => {
    const s = students.find(x => String(x.id) === String(sid));
    setForm(f => ({ ...f, student_id: sid, amount: s ? String(s.fee_amount) : f.amount }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/api/fees', { method: 'POST', body: form });
      showToast('Payment recorded successfully');
      setModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleVoid = async (p) => {
    if (!confirm2(`Void payment of ${fmtRM(p.amount)} for ${p.student_name}?`)) return;
    try {
      await api(`/api/fees/${p.id}`, { method: 'DELETE' });
      showToast('Payment voided');
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const openPayment = async (paymentId) => {
    setPaymentModal(true);
    setLoadingPayment(true);
    setActivePayment(null);
    try {
      const detail = await api(`/api/fees/${paymentId}`);
      setActivePayment(detail);
    } catch (e) {
      showToast(e.message, 'error');
      setPaymentModal(false);
    } finally {
      setLoadingPayment(false);
    }
  };

  const downloadReceipt = async (payment, copy = false) => {
    try {
      const query = copy ? '?copy=duplicate' : '';
      const filename = `receipt_${payment.receipt_code || payment.id}${copy ? '_duplicate' : ''}.pdf`;
      await window.downloadWithAuth(`/api/fees/${payment.id}/receipt/pdf${query}`, filename);
      showToast(copy ? 'Duplicate receipt downloaded' : 'Receipt downloaded');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const downloadFeeSlip = async (studentId, studentName) => {
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year) });
      await window.downloadWithAuth(`/api/students/${studentId}/fee-slip/pdf?${params.toString()}`, `fee_slip_${studentName.replace(/\s+/g, '_')}_${year}_${String(month).padStart(2,'0')}.pdf`);
      showToast('Fee slip downloaded');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const exportUnpaid = async () => {
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year) });
      if (search.trim()) params.set('search', search.trim());
      if (statusTab === 'overdue') params.set('status', 'overdue');
      await window.downloadFile(`/api/reports/export/unpaid-excel?${params.toString()}`, `unpaid_${year}_${String(month).padStart(2,'0')}.xlsx`);
      showToast('Unpaid list exported');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <div className="filters">
        <input className="students-search" placeholder="🔍 Search student or level…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select className="students-period-month" value={month} onChange={e => { setMonth(+e.target.value); setPage(1); }}>
          {window.MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
        </select>
        <select className="students-period-year" value={year} onChange={e => { setYear(+e.target.value); setPage(1); }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={load}>🔄</button>
        <button className="btn btn-secondary btn-sm" onClick={exportUnpaid}>⬇️ Export Unpaid</button>
        <div className="filters-spacer" />
        <div className="filters-total">Total: {fmtRM(total)}</div>
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setModal(true); }}>+ Record Payment</button>
      </div>

      <div className="filters" style={{ marginTop:-6 }}>
        {[
          ['all', 'All'],
          ['paid', 'Paid'],
          ['unpaid', 'Unpaid'],
          ['overdue', 'Overdue'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`btn ${statusTab === key ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => { setStatusTab(key); setPage(1); }}
          >
            {label} ({stats[key]})
          </button>
        ))}
      </div>

      <div className="card" style={{ padding:0, marginBottom:16 }}>
        {loading ? <div className="empty"><div className="icon">⏳</div>Loading…</div> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Student</th><th>Level</th><th>Fee</th><th>Status</th><th>Overdue Months</th><th>Outstanding</th><th>Last Paid</th><th></th></tr></thead>
              <tbody>
                {filteredStudents.length === 0 ? (
                  <tr><td colSpan={8}><div className="empty"><div className="icon">💰</div>No students found</div></td></tr>
                ) : filteredStudents.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td>{s.level}</td>
                    <td>{fmtRM(s.fee_amount)}</td>
                    <td>
                      <window.StatusBadge status={s.current_month_status} />
                      {s.overdue_months > 0 && <span style={{ marginLeft:6 }}><window.StatusBadge status={s.arrears_status} /></span>}
                    </td>
                    <td>{s.overdue_months}</td>
                    <td style={{ color: s.outstanding_amount > 0 ? 'var(--red)' : 'var(--mid)', fontWeight:600 }}>{fmtRM(s.outstanding_amount)}</td>
                    <td>{s.last_paid_month ? `${window.MONTHS[s.last_paid_month-1]} ${s.last_paid_year}` : '—'}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => downloadFeeSlip(s.id, s.name)}>
                        🖨️ Print Unpaid Slip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ padding:0 }}>
        {loading ? <div className="empty"><div className="icon">⏳</div>Loading…</div> : (
          <>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Student</th><th>Amount</th><th>Period</th><th>Paid Date</th><th>Method</th><th>Received By</th><th>Notes</th><th></th></tr></thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr><td colSpan={8}><div className="empty"><div className="icon">💳</div>No payments found</div></td></tr>
                  ) : paged.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.student_name}</strong></td>
                      <td style={{ fontWeight:600, color:'var(--green)' }}>{fmtRM(p.amount)}</td>
                      <td>{window.MONTHS[p.period_month-1]} {p.period_year}</td>
                      <td>{p.paid_date}</td>
                      <td><window.StatusBadge status={p.method} /></td>
                      <td>{p.received_by_name || '—'}</td>
                      <td style={{ color:'var(--muted)', fontSize:12 }}>{p.notes || ''}</td>
                      <td>
                        <div className="table-row-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => openPayment(p.id)}>Open</button>
                          {user.role === 'admin' && <button className="btn btn-danger btn-sm" onClick={() => handleVoid(p)}>Void</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding:'12px 16px' }}>
              <window.Pagination page={page} total={filtered.length} perPage={PER} onChange={setPage} />
            </div>
          </>
        )}
      </div>

      {modal && (
        <window.Modal title="Record Fee Payment" onClose={() => setModal(false)}>
          <form onSubmit={handleSave}>
            <div className="form-grid">
              <div className="form-group span2">
                <label>Student *</label>
                <select required value={form.student_id} onChange={e => handleStudentChange(e.target.value)}>
                  <option value="">— Select student —</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({fmtRM(s.fee_amount)}/month)</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Amount (RM) *</label>
                <input type="number" min="0.01" step="0.01" required value={form.amount} onChange={e => setForm(f=>({...f, amount:e.target.value}))} />
              </div>
              <div className="form-group">
                <label>Paid Date *</label>
                <input type="date" required value={form.paid_date} onChange={e => setForm(f=>({...f, paid_date:e.target.value}))} />
              </div>
              <div className="form-group">
                <label>Method</label>
                <select value={form.method} onChange={e => setForm(f=>({...f, method:e.target.value}))}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="online">Online</option>
                </select>
              </div>
              <div className="form-group">
                <label>Period Month *</label>
                <select required value={form.period_month} onChange={e => setForm(f=>({...f, period_month:+e.target.value}))}>
                  {window.MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Period Year *</label>
                <select required value={form.period_year} onChange={e => setForm(f=>({...f, period_year:+e.target.value}))}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="form-group span2">
                <label>Notes</label>
                <input value={form.notes} onChange={e => setForm(f=>({...f, notes:e.target.value}))} placeholder="Optional" />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Record Payment'}</button>
            </div>
          </form>
        </window.Modal>
      )}

      {paymentModal && (
        <window.Modal title="Payment Details & Receipt" onClose={() => setPaymentModal(false)}>
          {loadingPayment ? <div className="empty"><div className="icon">⏳</div>Loading payment…</div> : activePayment && (
            <>
              <div className="form-grid">
                <div className="form-group"><label>Student</label><input value={activePayment.student_name} readOnly /></div>
                <div className="form-group"><label>Amount</label><input value={fmtRM(activePayment.amount)} readOnly /></div>
                <div className="form-group"><label>Paid Date</label><input value={activePayment.paid_date} readOnly /></div>
                <div className="form-group"><label>Payment Method</label><input value={activePayment.method} readOnly /></div>
                <div className="form-group"><label>Period</label><input value={`${window.MONTHS[activePayment.period_month-1]} ${activePayment.period_year}`} readOnly /></div>
                <div className="form-group"><label>Received By</label><input value={activePayment.received_by_name || '—'} readOnly /></div>
                <div className="form-group span2"><label>Receipt No.</label><input value={activePayment.receipt_code} readOnly /></div>
                <div className="form-group span2"><label>Notes</label><input value={activePayment.notes || '—'} readOnly /></div>
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => downloadReceipt(activePayment)}>🧾 Download Receipt PDF</button>
                <button className="btn btn-secondary" onClick={() => downloadReceipt(activePayment, true)}>♻️ Duplicate Copy</button>
                <button className="btn btn-primary" onClick={() => setPaymentModal(false)}>Close</button>
              </div>
            </>
          )}
        </window.Modal>
      )}
    </div>
  );
};
