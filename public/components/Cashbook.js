// ── Cashbook Component ────────────────────────────────────────────────────────
window.Cashbook = function Cashbook() {
  const { showToast } = React.useContext(window.ToastContext);
  const { settings } = React.useContext(AuthContext);
  const currency = settings?.currency || 'RM';
  const now = new Date();

  const [month,   setMonth]   = React.useState(now.getMonth() + 1);
  const [year,    setYear]    = React.useState(now.getFullYear());
  const [tab,     setTab]     = React.useState('entries');   // 'entries' | 'cash' | 'bank'
  const [entries, setEntries] = React.useState([]);
  const [summary, setSummary] = React.useState(null);
  const [accounts, setAccounts] = React.useState([]);
  const [funds,   setFunds]   = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search,  setSearch]  = React.useState('');
  const [modal,   setModal]   = React.useState(null);  // null | 'add' | row
  const [saving,  setSaving]  = React.useState(false);
  const [voidTarget, setVoidTarget] = React.useState(null);
  const [voidReason, setVoidReason] = React.useState('');
  const [page,    setPage]    = React.useState(1);
  const PER = 25;

  const years = [];
  for (let y = now.getFullYear(); y >= 2022; y--) years.push(y);

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const EMPTY_FORM = {
    entry_date: now.toISOString().slice(0,10),
    description: '',
    debit_account_id: '',
    credit_account_id: '',
    amount: '',
    payment_method: 'cash',
    bank_account_name: '',
    payment_ref: '',
    fund_id: '',
    notes: '',
  };
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [errors, setErrors] = React.useState({});

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [entData, sumData, acctData, fundData] = await Promise.all([
        api(`/api/cashbook?month=${month}&year=${year}`),
        api(`/api/cashbook/summary?month=${month}&year=${year}`),
        api('/api/accounts'),
        api('/api/funds'),
      ]);
      setEntries(entData);
      setSummary(sumData);
      setAccounts(acctData);
      setFunds(fundData);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [month, year]);

  React.useEffect(() => { load(); setPage(1); }, [load]);

  const fmt = (n) => `${currency} ${Number(n || 0).toFixed(2)}`;

  const filtered = React.useMemo(() => {
    const q = search.toLowerCase();
    let rows = entries;
    if (tab === 'cash') rows = rows.filter(e => e.payment_method === 'cash');
    if (tab === 'bank') rows = rows.filter(e => e.payment_method === 'bank' || e.payment_method === 'transfer');
    if (q) rows = rows.filter(e =>
      e.description?.toLowerCase().includes(q) ||
      e.ref_number?.toLowerCase().includes(q) ||
      e.debit_name?.toLowerCase().includes(q) ||
      e.credit_name?.toLowerCase().includes(q) ||
      e.payment_ref?.toLowerCase().includes(q)
    );
    return rows;
  }, [entries, search, tab]);

  const paged = filtered.slice((page-1)*PER, page*PER);
  const totalPages = Math.ceil(filtered.length / PER);

  const validate = () => {
    const e = {};
    if (!form.entry_date)          e.entry_date = 'Required';
    if (!form.description.trim())  e.description = 'Required';
    if (!form.debit_account_id)    e.debit_account_id = 'Required';
    if (!form.credit_account_id)   e.credit_account_id = 'Required';
    if (form.debit_account_id === form.credit_account_id && form.debit_account_id)
      e.credit_account_id = 'Must differ from debit';
    if (!form.amount || isNaN(form.amount) || Number(form.amount) <= 0) e.amount = 'Positive number required';
    return e;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      const body = { ...form, amount: parseFloat(form.amount) };
      if (!body.fund_id) delete body.fund_id;
      if (!body.bank_account_name) delete body.bank_account_name;
      if (!body.payment_ref) delete body.payment_ref;
      await api('/api/cashbook', { method: 'POST', body });
      showToast('Entry recorded');
      setModal(null);
      setForm(EMPTY_FORM);
      setErrors({});
      load();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    try {
      await api(`/api/cashbook/${voidTarget.id}`, { method: 'DELETE', body: { void_reason: voidReason } });
      showToast('Entry voided');
      setVoidTarget(null); setVoidReason('');
      load();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleExportPDF = async () => {
    try {
      await downloadFile(`/api/cashbook/export/pdf?month=${month}&year=${year}`,
        `Cashbook_${year}_${String(month).padStart(2,'0')}.pdf`);
      showToast('PDF downloaded');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const acctOptions = (typeFilter) => accounts
    .filter(a => !typeFilter || typeFilter.includes(a.type))
    .map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>);

  const methodBadge = (m) => {
    if (m === 'cash')     return <span className="badge badge-green">Cash</span>;
    if (m === 'bank')     return <span className="badge badge-blue">Bank</span>;
    if (m === 'transfer') return <span className="badge badge-blue">Transfer</span>;
    return <span className="badge badge-gray">{m}</span>;
  };

  return (
    <div>
      {/* Summary stat cards */}
      {summary && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-label">Cash on Hand</div>
            <div className="stat-value stat-green">{fmt(summary.total_cash)}</div>
            <div className="stat-sub">All cash accounts</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Bank Balance</div>
            <div className="stat-value stat-blue">{fmt(summary.total_bank)}</div>
            <div className="stat-sub">All bank accounts</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Funds</div>
            <div className="stat-value">{fmt(summary.total_balance)}</div>
            <div className="stat-sub">Cash + Bank</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Income — {MONTHS[month-1]}</div>
            <div className="stat-value stat-green">{fmt(summary.monthly_income)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Expenses — {MONTHS[month-1]}</div>
            <div className="stat-value stat-amber">{fmt(summary.monthly_expense)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Net — {MONTHS[month-1]}</div>
            <div className={`stat-value ${summary.net_for_month >= 0 ? 'stat-green' : 'stat-red'}`}>
              {fmt(summary.net_for_month)}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {/* Filters */}
        <div className="filters">
          <div className="filters-main">
            <select value={month} onChange={e => setMonth(+e.target.value)}>
              {MONTHS_FULL.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(+e.target.value)}>
              {years.map(y => <option key={y}>{y}</option>)}
            </select>
            <input placeholder="Search ref, description, account…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              style={{ minWidth: 220 }} />
          </div>
          <div className="filters-actions">
            <button className="btn btn-secondary btn-sm" onClick={handleExportPDF}>
              📄 Print Ledger PDF
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY_FORM); setErrors({}); setModal('add'); }}>
              + New Entry
            </button>
          </div>
        </div>

        {/* Tabs: All / Cash / Bank */}
        <div style={{ display:'flex', gap:8, marginBottom:16, borderBottom:'1px solid var(--border)', paddingBottom:10 }}>
          {[['entries','All Entries'],['cash','Cash Only'],['bank','Bank / Transfer']].map(([k,label]) => (
            <button key={k}
              className={`btn btn-sm ${tab===k ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setTab(k); setPage(1); }}
            >{label}</button>
          ))}
          <span style={{ marginLeft:'auto', color:'var(--muted)', fontSize:12, alignSelf:'center' }}>
            {filtered.length} entries
          </span>
        </div>

        {loading ? (
          <window.StatePanel type="loading" compact message="Loading cashbook…" />
        ) : paged.length === 0 ? (
          <window.StatePanel icon="📒" message="No entries for this period" compact />
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ref No</th>
                  <th>Description</th>
                  <th>Debit Account</th>
                  <th>Credit Account</th>
                  <th>Method</th>
                  <th style={{ textAlign:'right' }}>Amount</th>
                  <th>Fund</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paged.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontSize:12 }}>{e.entry_date}</td>
                    <td><code style={{ fontSize:11, color:'var(--blue)' }}>{e.ref_number}</code></td>
                    <td style={{ maxWidth:200 }}>
                      <div style={{ fontWeight:600, fontSize:13 }}>{e.description}</div>
                      {e.payment_ref && <div style={{ fontSize:11, color:'var(--muted)' }}>{e.payment_ref}</div>}
                    </td>
                    <td style={{ fontSize:12 }}><span className="badge badge-red">{e.debit_code}</span> {e.debit_name}</td>
                    <td style={{ fontSize:12 }}><span className="badge badge-green">{e.credit_code}</span> {e.credit_name}</td>
                    <td>{methodBadge(e.payment_method)}</td>
                    <td style={{ textAlign:'right', fontWeight:700 }}>{fmt(e.amount)}</td>
                    <td style={{ fontSize:11, color:'var(--muted)' }}>{e.fund_name || '—'}</td>
                    <td>
                      <button className="btn btn-danger btn-sm btn-icon" title="Void entry"
                        onClick={() => { setVoidTarget(e); setVoidReason(''); }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display:'flex', justifyContent:'center', gap:6, marginTop:16 }}>
            <button className="btn btn-secondary btn-sm" disabled={page===1} onClick={() => setPage(p=>p-1)}>‹ Prev</button>
            <span style={{ lineHeight:'32px', fontSize:13 }}>Page {page} / {totalPages}</span>
            <button className="btn btn-secondary btn-sm" disabled={page===totalPages} onClick={() => setPage(p=>p+1)}>Next ›</button>
          </div>
        )}
      </div>

      {/* Add Entry Modal */}
      {modal === 'add' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-title">New Cashbook Entry</div>
            <form onSubmit={handleSave}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Date *</label>
                  <input type="date" value={form.entry_date}
                    onChange={e => setForm(f => ({...f, entry_date: e.target.value}))} />
                  {errors.entry_date && <small style={{color:'var(--red)'}}>{errors.entry_date}</small>}
                </div>
                <div className="form-group">
                  <label>Payment Method *</label>
                  <select value={form.payment_method}
                    onChange={e => setForm(f => ({...f, payment_method: e.target.value}))}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </div>
                <div className="form-group span2">
                  <label>Description *</label>
                  <input value={form.description} placeholder="Brief description of transaction"
                    onChange={e => setForm(f => ({...f, description: e.target.value}))} />
                  {errors.description && <small style={{color:'var(--red)'}}>{errors.description}</small>}
                </div>
                <div className="form-group">
                  <label>Debit Account * <small style={{color:'var(--muted)'}}>(money flows to)</small></label>
                  <select value={form.debit_account_id}
                    onChange={e => setForm(f => ({...f, debit_account_id: e.target.value}))}>
                    <option value="">— Select account —</option>
                    {acctOptions()}
                  </select>
                  {errors.debit_account_id && <small style={{color:'var(--red)'}}>{errors.debit_account_id}</small>}
                </div>
                <div className="form-group">
                  <label>Credit Account * <small style={{color:'var(--muted)'}}>(money flows from)</small></label>
                  <select value={form.credit_account_id}
                    onChange={e => setForm(f => ({...f, credit_account_id: e.target.value}))}>
                    <option value="">— Select account —</option>
                    {acctOptions()}
                  </select>
                  {errors.credit_account_id && <small style={{color:'var(--red)'}}>{errors.credit_account_id}</small>}
                </div>
                <div className="form-group">
                  <label>Amount ({currency}) *</label>
                  <input type="number" step="0.01" min="0.01" value={form.amount}
                    onChange={e => setForm(f => ({...f, amount: e.target.value}))} />
                  {errors.amount && <small style={{color:'var(--red)'}}>{errors.amount}</small>}
                </div>
                <div className="form-group">
                  <label>Donor Fund <small style={{color:'var(--muted)'}}>(if restricted)</small></label>
                  <select value={form.fund_id}
                    onChange={e => setForm(f => ({...f, fund_id: e.target.value}))}>
                    <option value="">— None —</option>
                    {funds.map(f => <option key={f.id} value={f.id}>{f.name}{f.funder_name ? ` (${f.funder_name})` : ''}</option>)}
                  </select>
                </div>
                {(form.payment_method === 'bank' || form.payment_method === 'transfer') && (
                  <div className="form-group">
                    <label>Bank Account Name</label>
                    <input value={form.bank_account_name} placeholder="e.g. CIMB Main Account"
                      onChange={e => setForm(f => ({...f, bank_account_name: e.target.value}))} />
                  </div>
                )}
                <div className="form-group">
                  <label>Payment Reference</label>
                  <input value={form.payment_ref} placeholder="Cheque no., bank ref, receipt no…"
                    onChange={e => setForm(f => ({...f, payment_ref: e.target.value}))} />
                </div>
                <div className="form-group span2">
                  <label>Notes</label>
                  <input value={form.notes}
                    onChange={e => setForm(f => ({...f, notes: e.target.value}))} />
                </div>
              </div>

              {/* Entry hint */}
              {form.debit_account_id && form.credit_account_id && form.amount && (
                <div style={{ margin:'12px 0', padding:'10px 14px', background:'var(--blue-light)', borderRadius:8, fontSize:12 }}>
                  <strong>Journal Preview:</strong> DR{' '}
                  {accounts.find(a=>a.id==form.debit_account_id)?.name || '?'}
                  {' '}{form.amount}{' '} / CR{' '}
                  {accounts.find(a=>a.id==form.credit_account_id)?.name || '?'}
                  {' '}{form.amount}
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Record Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Void confirmation */}
      {voidTarget && (
        <div className="modal-overlay" onClick={() => setVoidTarget(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Void Entry</div>
            <p style={{ marginBottom:12 }}>
              Void <strong>{voidTarget.ref_number}</strong> — {voidTarget.description}?
              This cannot be undone.
            </p>
            <div className="form-group">
              <label>Reason for voiding</label>
              <input value={voidReason} onChange={e => setVoidReason(e.target.value)}
                placeholder="Entered in error, duplicate…" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setVoidTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleVoid}>Void Entry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
