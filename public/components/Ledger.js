// ── Ledger Component — Chart of Accounts, Account Ledger, Donor Funds, Monthly Closing ──
window.Ledger = function Ledger() {
  const { showToast } = React.useContext(window.ToastContext);
  const { settings } = React.useContext(window.AuthContext);
  const currency = settings?.currency || 'RM';
  const now = new Date();

  const [tab, setTab] = React.useState('accounts'); // 'accounts' | 'ledger' | 'funds' | 'closing'
  const [accounts, setAccounts]   = React.useState([]);
  const [funds,    setFunds]       = React.useState([]);
  const [closings, setClosings]    = React.useState([]);
  const [loading,  setLoading]     = React.useState(true);

  // Account ledger state
  const [selectedAcct, setSelectedAcct] = React.useState('');
  const [ledgerData,   setLedgerData]   = React.useState(null);
  const [ledgerMonth,  setLedgerMonth]  = React.useState(now.getMonth() + 1);
  const [ledgerYear,   setLedgerYear]   = React.useState(now.getFullYear());
  const [ledgerLoading,setLedgerLoading] = React.useState(false);

  // Modals
  const [acctModal,    setAcctModal]    = React.useState(null); // null | 'add' | row
  const [obModal,      setObModal]      = React.useState(null); // account row
  const [fundModal,    setFundModal]    = React.useState(null); // null | 'add' | row
  const [closingModal, setClosingModal] = React.useState(false);
  const [saving,       setSaving]       = React.useState(false);

  const [acctForm, setAcctForm] = React.useState({ code:'', name:'', type:'expense', sub_type:'', description:'' });
  const [obForm,   setObForm]   = React.useState({ balance:'', balance_date: window.todayLocalISO() });
  const [fundForm, setFundForm] = React.useState({ name:'', funder_name:'', description:'', is_restricted:true });
  const [closeForm,setCloseForm]= React.useState({ month: now.getMonth()+1, year: now.getFullYear(), notes:'' });
  const [closePreview, setClosePreview] = React.useState(null);

  const years = [];
  for (let y = now.getFullYear(); y >= 2022; y--) years.push(y);
  const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const fmt = (n) => `${currency} ${Number(n || 0).toFixed(2)}`;

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    try {
      const [acctData, fundData, closData] = await Promise.all([
        api('/api/accounts'),
        api('/api/funds'),
        api('/api/closing'),
      ]);
      setAccounts(acctData);
      setFunds(fundData);
      setClosings(closData);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { loadAll(); }, [loadAll]);

  // Load account ledger when selection changes
  React.useEffect(() => {
    if (!selectedAcct || tab !== 'ledger') return;
    setLedgerLoading(true);
    api(`/api/accounts/${selectedAcct}/ledger?month=${ledgerMonth}&year=${ledgerYear}`)
      .then(d => setLedgerData(d))
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLedgerLoading(false));
  }, [selectedAcct, ledgerMonth, ledgerYear, tab]);

  // Load closing preview when form changes
  React.useEffect(() => {
    if (!closingModal) return;
    api(`/api/closing/status?month=${closeForm.month}&year=${closeForm.year}`)
      .then(d => setClosePreview(d))
      .catch(() => {});
  }, [closeForm.month, closeForm.year, closingModal]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAddAccount = async (e) => {
    e.preventDefault();
    if (!acctForm.code || !acctForm.name || !acctForm.type) return;
    setSaving(true);
    try {
      await api('/api/accounts', { method: 'POST', body: acctForm });
      showToast('Account created');
      setAcctModal(null);
      setAcctForm({ code:'', name:'', type:'expense', sub_type:'', description:'' });
      loadAll();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleSetOB = async (e) => {
    e.preventDefault();
    if (!obModal || obForm.balance === '') return;
    setSaving(true);
    try {
      await api(`/api/accounts/${obModal.id}/opening-balance`, { method:'POST', body: obForm });
      showToast('Opening balance set');
      setObModal(null);
      loadAll();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleSaveFund = async (e) => {
    e.preventDefault();
    if (!fundForm.name) return;
    setSaving(true);
    try {
      if (fundModal === 'add') {
        await api('/api/funds', { method:'POST', body: fundForm });
        showToast('Fund created');
      } else {
        await api(`/api/funds/${fundModal.id}`, { method:'PUT', body: fundForm });
        showToast('Fund updated');
      }
      setFundModal(null);
      loadAll();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDeleteFund = async (f) => {
    if (!confirm(`Deactivate fund "${f.name}"?`)) return;
    try {
      await api(`/api/funds/${f.id}`, { method:'DELETE' });
      showToast('Fund deactivated');
      loadAll();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCloseMonth = async (e) => {
    e.preventDefault();
    if (closePreview?.is_closed) return;
    setSaving(true);
    try {
      await api('/api/closing', { method:'POST', body: closeForm });
      showToast(`${MONTHS_FULL[closeForm.month-1]} ${closeForm.year} closed`);
      setClosingModal(false);
      loadAll();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleReopenMonth = async (c) => {
    if (!confirm(`Reopen ${MONTHS_FULL[c.month-1]} ${c.year}? This will allow editing of that period.`)) return;
    const reopen_reason = window.prompt('Reopen reason (required for audit trail):');
    if (!reopen_reason || !reopen_reason.trim()) {
      showToast('Reopen reason is required', 'error');
      return;
    }
    try {
      await api(`/api/closing/${c.id}`, { method:'DELETE', body: { reopen_reason: reopen_reason.trim() } });
      showToast('Period reopened');
      loadAll();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleLedgerPDF = async () => {
    try {
      await downloadFile(
        `/api/cashbook/export/pdf?month=${ledgerMonth}&year=${ledgerYear}${selectedAcct ? `&account_id=${selectedAcct}` : ''}`,
        `Ledger_${ledgerYear}_${String(ledgerMonth).padStart(2,'0')}.pdf`
      );
      showToast('PDF downloaded');
    } catch (e) { showToast(e.message, 'error'); }
  };

  // ── Account type grouping ──────────────────────────────────────────────────

  const TYPE_ORDER = ['asset','liability','equity','income','expense'];
  const TYPE_LABELS = { asset:'Assets', liability:'Liabilities', equity:'Equity', income:'Income', expense:'Expenses' };
  const TYPE_COLORS = { asset:'var(--blue)', liability:'var(--red)', equity:'var(--amber)', income:'var(--green)', expense:'var(--red)' };

  const grouped = TYPE_ORDER.reduce((acc, t) => {
    acc[t] = accounts.filter(a => a.type === t);
    return acc;
  }, {});

  // ── Tabs ──────────────────────────────────────────────────────────────────

  const TABS = [
    { k:'accounts', label:'Chart of Accounts' },
    { k:'ledger',   label:'Account Ledger' },
    { k:'funds',    label:'Donor Funds' },
    { k:'closing',  label:'Monthly Closing' },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
        {TABS.map(t => (
          <button key={t.k} className={`btn ${tab===t.k ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(t.k)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <window.StatePanel type="loading" message="Loading…" /> : (

        <>
          {/* ── CHART OF ACCOUNTS ───────────────────────────────────────────── */}
          {tab === 'accounts' && (
            <div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:16 }}>
                <button className="btn btn-primary btn-sm"
                  onClick={() => { setAcctForm({ code:'', name:'', type:'expense', sub_type:'', description:'' }); setAcctModal('add'); }}>
                  + New Account
                </button>
              </div>

              {TYPE_ORDER.map(type => (
                <div key={type} className="card" style={{ marginBottom:16 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                    <div style={{ width:10, height:10, borderRadius:'50%', background: TYPE_COLORS[type] }} />
                    <div className="card-title" style={{ margin:0 }}>{TYPE_LABELS[type]}</div>
                    <span className="badge badge-gray">{grouped[type].length}</span>
                  </div>
                  {grouped[type].length === 0 ? (
                    <div className="empty empty-compact">No accounts</div>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Name</th>
                          <th>Sub-type</th>
                          <th>Description</th>
                          <th style={{ textAlign:'right' }}>Opening Balance</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {grouped[type].map(a => (
                          <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                            <td><code style={{ color:'var(--blue)', fontWeight:700 }}>{a.code}</code></td>
                            <td style={{ fontWeight:600 }}>{a.name}</td>
                            <td><span className="badge badge-gray">{a.sub_type || '—'}</span></td>
                            <td style={{ color:'var(--muted)', fontSize:12 }}>{a.description || '—'}</td>
                            <td style={{ textAlign:'right', fontFamily:'monospace', fontSize:13 }}>
                              {a.opening_balance != null ? fmt(a.opening_balance) : <span style={{color:'var(--muted)'}}>not set</span>}
                              {a.opening_balance_date && <div style={{fontSize:10,color:'var(--muted)'}}>{a.opening_balance_date}</div>}
                            </td>
                            <td>
                              <div style={{ display:'flex', gap:4 }}>
                                <button className="btn btn-secondary btn-sm btn-icon" title="Set opening balance"
                                  onClick={() => { setObModal(a); setObForm({ balance: a.opening_balance ?? '', balance_date: a.opening_balance_date || window.todayLocalISO() }); }}>
                                  
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── ACCOUNT LEDGER ─────────────────────────────────────────────── */}
          {tab === 'ledger' && (
            <div className="card">
              <div className="filters" style={{ marginBottom:16 }}>
                <div className="filters-main">
                  <select value={selectedAcct} onChange={e => setSelectedAcct(e.target.value)} style={{ minWidth:260 }}>
                    <option value="">— Select account —</option>
                    {TYPE_ORDER.map(type => (
                      <optgroup key={type} label={TYPE_LABELS[type]}>
                        {accounts.filter(a => a.type===type).map(a => (
                          <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <select value={ledgerMonth} onChange={e => setLedgerMonth(+e.target.value)}>
                    {MONTHS_FULL.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                  </select>
                  <select value={ledgerYear} onChange={e => setLedgerYear(+e.target.value)}>
                    {years.map(y => <option key={y}>{y}</option>)}
                  </select>
                </div>
                <div className="filters-actions">
                  <button className="btn btn-secondary btn-sm" onClick={handleLedgerPDF}>Print PDF</button>
                </div>
              </div>

              {!selectedAcct ? (
                <window.StatePanel type="empty" message="Select an account to view its ledger" compact />
              ) : ledgerLoading ? (
                <window.StatePanel type="loading" compact message="Loading ledger…" />
              ) : ledgerData ? (
                <>
                  {/* Account summary header */}
                  <div style={{ padding:'14px 16px', background:'var(--green-light)', borderRadius:8, marginBottom:16, display:'flex', gap:24 }}>
                    <div>
                      <div style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', fontWeight:700 }}>Account</div>
                      <div style={{ fontWeight:700, fontSize:16 }}>{ledgerData.account.code} — {ledgerData.account.name}</div>
                      <div style={{ fontSize:12, color:'var(--muted)' }}>{TYPE_LABELS[ledgerData.account.type]} / {ledgerData.account.sub_type || 'general'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', fontWeight:700 }}>Opening Balance</div>
                      <div style={{ fontWeight:700 }}>{ledgerData.opening_balance ? fmt(ledgerData.opening_balance.balance) : 'Not set'}</div>
                    </div>
                    {ledgerData.entries.length > 0 && (
                      <div>
                        <div style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', fontWeight:700 }}>Closing Balance</div>
                        <div style={{ fontWeight:700 }}>{fmt(ledgerData.entries[ledgerData.entries.length-1].running_balance)}</div>
                      </div>
                    )}
                  </div>

                  {ledgerData.entries.length === 0 ? (
                    <window.StatePanel type="empty" message="No entries for this account in the selected period" compact />
                  ) : (
                    <div style={{ overflowX:'auto' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Ref No</th>
                            <th>Description</th>
                            <th style={{ textAlign:'right' }}>Debit</th>
                            <th style={{ textAlign:'right' }}>Credit</th>
                            <th style={{ textAlign:'right' }}>Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerData.opening_balance && (
                            <tr style={{ background:'var(--green-light)' }}>
                              <td style={{ fontSize:12 }}>{ledgerData.opening_balance.balance_date}</td>
                              <td><code style={{ fontSize:11 }}>OPENING</code></td>
                              <td style={{ fontStyle:'italic', color:'var(--muted)' }}>Opening Balance</td>
                              <td style={{ textAlign:'right' }} />
                              <td style={{ textAlign:'right' }} />
                              <td style={{ textAlign:'right', fontWeight:700 }}>{fmt(ledgerData.opening_balance.balance)}</td>
                            </tr>
                          )}
                          {ledgerData.entries.map(e => (
                            <tr key={e.id}>
                              <td style={{ fontSize:12 }}>{e.entry_date}</td>
                              <td><code style={{ fontSize:11, color:'var(--blue)' }}>{e.ref_number}</code></td>
                              <td>
                                <div style={{ fontWeight:600 }}>{e.description}</div>
                                <div style={{ fontSize:11, color:'var(--muted)' }}>
                                  DR: {e.debit_code} / CR: {e.credit_code}
                                </div>
                              </td>
                              <td style={{ textAlign:'right', color:'var(--red)', fontFamily:'monospace' }}>
                                {e.debit > 0 ? Number(e.debit).toFixed(2) : ''}
                              </td>
                              <td style={{ textAlign:'right', color:'var(--green)', fontFamily:'monospace' }}>
                                {e.credit > 0 ? Number(e.credit).toFixed(2) : ''}
                              </td>
                              <td style={{ textAlign:'right', fontWeight:700, fontFamily:'monospace' }}>
                                {Number(e.running_balance).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* ── DONOR FUNDS ────────────────────────────────────────────────── */}
          {tab === 'funds' && (
            <div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:16 }}>
                <button className="btn btn-primary btn-sm"
                  onClick={() => { setFundForm({ name:'', funder_name:'', description:'', is_restricted:true }); setFundModal('add'); }}>
                  + New Fund
                </button>
              </div>

              {funds.length === 0 ? (
                <window.StatePanel type="empty" message="No donor funds yet. Add one to track restricted grants." compact />
              ) : (
                <div style={{ display:'grid', gap:14 }}>
                  {funds.map(f => (
                    <div key={f.id} className="card" style={{ padding:'16px 20px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                        <div>
                          <div style={{ fontWeight:700, fontSize:15 }}>{f.name}</div>
                          {f.funder_name && <div style={{ fontSize:12, color:'var(--muted)' }}>Funder: {f.funder_name}</div>}
                          {f.description && <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>{f.description}</div>}
                          {f.is_restricted ? (
                            <span className="badge badge-amber" style={{ marginTop:6 }}>Restricted Fund</span>
                          ) : (
                            <span className="badge badge-gray" style={{ marginTop:6 }}>Unrestricted</span>
                          )}
                        </div>
                        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                          <div style={{ textAlign:'right' }}>
                            <div style={{ fontSize:11, color:'var(--muted)' }}>Received</div>
                            <div style={{ fontWeight:700, color:'var(--green)' }}>{fmt(f.amount_received)}</div>
                          </div>
                          <div style={{ textAlign:'right' }}>
                            <div style={{ fontSize:11, color:'var(--muted)' }}>Spent</div>
                            <div style={{ fontWeight:700, color:'var(--amber)' }}>{fmt(f.amount_spent)}</div>
                          </div>
                          <div style={{ textAlign:'right' }}>
                            <div style={{ fontSize:11, color:'var(--muted)' }}>Balance</div>
                            <div style={{ fontWeight:700, color: f.balance >= 0 ? 'var(--green)' : 'var(--red)' }}>
                              {fmt(f.balance)}
                            </div>
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                            <button className="btn btn-secondary btn-sm btn-icon" title="Edit"
                              onClick={() => { setFundForm({ name:f.name, funder_name:f.funder_name||'', description:f.description||'', is_restricted:!!f.is_restricted }); setFundModal(f); }}>
                              Edit
                            </button>
                            <button className="btn btn-danger btn-sm btn-icon" title="Deactivate"
                              onClick={() => handleDeleteFund(f)}>✕</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── MONTHLY CLOSING ───────────────────────────────────────────── */}
          {tab === 'closing' && (
            <div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:16 }}>
                <button className="btn btn-primary btn-sm" onClick={() => {
                  setCloseForm({ month: now.getMonth()+1, year: now.getFullYear(), notes:'' });
                  setClosePreview(null);
                  setClosingModal(true);
                }}>
                  Close a Month
                </button>
              </div>

              <div className="card">
                <div className="card-title">Closing History</div>
                {closings.length === 0 ? (
                  <window.StatePanel type="empty" message="No months have been closed yet" compact />
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Closed By</th>
                        <th>Closed At</th>
                        <th style={{ textAlign:'right' }}>Opening Cash</th>
                        <th style={{ textAlign:'right' }}>Opening Bank</th>
                        <th style={{ textAlign:'right' }}>Income</th>
                        <th style={{ textAlign:'right' }}>Expenses</th>
                        <th style={{ textAlign:'right' }}>Closing Cash</th>
                        <th style={{ textAlign:'right' }}>Closing Bank</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {closings.map(c => (
                        <tr key={c.id}>
                          <td style={{ fontWeight:700 }}>
                            {MONTHS_FULL[c.month-1]} {c.year}
                            <span className={`badge ${c.is_reopened ? 'badge-amber' : 'badge-green'}`} style={{ marginLeft:8 }}>
                              {c.is_reopened ? 'Reopened' : 'Closed'}
                            </span>
                            {c.is_reopened && c.reopen_reason ? <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>Reason: {c.reopen_reason}</div> : null}
                          </td>
                          <td>{c.closed_by_name || '—'}</td>
                          <td style={{ fontSize:12 }}>{c.closed_at?.slice(0,10)}</td>
                          <td style={{ textAlign:'right', fontFamily:'monospace', fontSize:12 }}>{Number(c.opening_cash).toFixed(2)}</td>
                          <td style={{ textAlign:'right', fontFamily:'monospace', fontSize:12 }}>{Number(c.opening_bank).toFixed(2)}</td>
                          <td style={{ textAlign:'right', color:'var(--green)', fontFamily:'monospace', fontSize:12 }}>{Number(c.total_income).toFixed(2)}</td>
                          <td style={{ textAlign:'right', color:'var(--amber)', fontFamily:'monospace', fontSize:12 }}>{Number(c.total_expense).toFixed(2)}</td>
                          <td style={{ textAlign:'right', fontFamily:'monospace', fontSize:12 }}>{Number(c.closing_cash).toFixed(2)}</td>
                          <td style={{ textAlign:'right', fontFamily:'monospace', fontSize:12 }}>{Number(c.closing_bank).toFixed(2)}</td>
                          <td>
                            <button className="btn btn-secondary btn-sm" title="Reopen period (admin)" disabled={!!c.is_reopened}
                              onClick={() => handleReopenMonth(c)}>
                              Reopen
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {/* Add Account Modal */}
      {acctModal === 'add' && (
        <div className="modal-overlay" onClick={() => setAcctModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">New Account</div>
            <form onSubmit={handleAddAccount}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Account Code *</label>
                  <input value={acctForm.code} placeholder="e.g. 5900"
                    onChange={e => setAcctForm(f => ({...f, code: e.target.value}))} />
                </div>
                <div className="form-group">
                  <label>Type *</label>
                  <select value={acctForm.type}
                    onChange={e => setAcctForm(f => ({...f, type: e.target.value}))}>
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="equity">Equity</option>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div className="form-group span2">
                  <label>Name *</label>
                  <input value={acctForm.name} placeholder="Account name"
                    onChange={e => setAcctForm(f => ({...f, name: e.target.value}))} />
                </div>
                <div className="form-group">
                  <label>Sub-type</label>
                  <input value={acctForm.sub_type} placeholder="cash, bank, fees, etc."
                    onChange={e => setAcctForm(f => ({...f, sub_type: e.target.value}))} />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input value={acctForm.description}
                    onChange={e => setAcctForm(f => ({...f, description: e.target.value}))} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setAcctModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create Account'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Opening Balance Modal */}
      {obModal && (
        <div className="modal-overlay" onClick={() => setObModal(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Opening Balance — {obModal.code} {obModal.name}</div>
            <form onSubmit={handleSetOB}>
              <div className="form-group" style={{ marginBottom:14 }}>
                <label>Balance ({currency})</label>
                <input type="number" step="0.01" value={obForm.balance}
                  onChange={e => setObForm(f => ({...f, balance: e.target.value}))} />
              </div>
              <div className="form-group">
                <label>As at Date</label>
                <input type="date" value={obForm.balance_date}
                  onChange={e => setObForm(f => ({...f, balance_date: e.target.value}))} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setObModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Set Balance'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fund Modal */}
      {fundModal && (
        <div className="modal-overlay" onClick={() => setFundModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{fundModal === 'add' ? 'New Donor Fund' : `Edit — ${fundModal.name}`}</div>
            <form onSubmit={handleSaveFund}>
              <div className="form-grid">
                <div className="form-group span2">
                  <label>Fund Name *</label>
                  <input value={fundForm.name} onChange={e => setFundForm(f => ({...f, name: e.target.value}))} />
                </div>
                <div className="form-group">
                  <label>Funder / Donor Name</label>
                  <input value={fundForm.funder_name} onChange={e => setFundForm(f => ({...f, funder_name: e.target.value}))} />
                </div>
                <div className="form-group">
                  <label>Restricted?</label>
                  <select value={fundForm.is_restricted ? 'yes' : 'no'}
                    onChange={e => setFundForm(f => ({...f, is_restricted: e.target.value === 'yes'}))}>
                    <option value="yes">Yes — Restricted Fund</option>
                    <option value="no">No — Unrestricted</option>
                  </select>
                </div>
                <div className="form-group span2">
                  <label>Description / Purpose</label>
                  <input value={fundForm.description} onChange={e => setFundForm(f => ({...f, description: e.target.value}))} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setFundModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Fund'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Monthly Closing Modal */}
      {closingModal && (
        <div className="modal-overlay" onClick={() => setClosingModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Close Month</div>
            <form onSubmit={handleCloseMonth}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Month</label>
                  <select value={closeForm.month}
                    onChange={e => setCloseForm(f => ({...f, month: +e.target.value}))}>
                    {MONTHS_FULL.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Year</label>
                  <select value={closeForm.year}
                    onChange={e => setCloseForm(f => ({...f, year: +e.target.value}))}>
                    {years.map(y => <option key={y}>{y}</option>)}
                  </select>
                </div>
                <div className="form-group span2">
                  <label>Notes</label>
                  <input value={closeForm.notes}
                    onChange={e => setCloseForm(f => ({...f, notes: e.target.value}))}
                    placeholder="Optional closing notes…" />
                </div>
              </div>

              {closePreview && (
                <div style={{ margin:'14px 0', padding:'14px', background: closePreview.is_closed ? 'var(--red-light)' : 'var(--green-light)', borderRadius:8 }}>
                  {closePreview.is_closed ? (
                    <div style={{ color:'var(--red)', fontWeight:700 }}>
                      {closePreview.period_label} is already closed.
                    </div>
                  ) : (
                    <>
                      <div style={{ fontWeight:700, marginBottom:10 }}>Preview — {closePreview.period_label}</div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:13 }}>
                        <div>Opening Cash: <strong>{fmt(closePreview.preview.openingCash)}</strong></div>
                        <div>Opening Bank: <strong>{fmt(closePreview.preview.openingBank)}</strong></div>
                        <div style={{ color:'var(--green)' }}>Total Income: <strong>{fmt(closePreview.preview.totalIncome)}</strong></div>
                        <div style={{ color:'var(--amber)' }}>Total Expenses: <strong>{fmt(closePreview.preview.totalExpense)}</strong></div>
                        <div>Closing Cash: <strong>{fmt(closePreview.preview.closingCash)}</strong></div>
                        <div>Closing Bank: <strong>{fmt(closePreview.preview.closingBank)}</strong></div>
                        <div style={{ gridColumn:'1/-1', color:'var(--muted)', fontSize:11 }}>
                          Cashbook entries: {closePreview.preview.entry_count}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setClosingModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving || closePreview?.is_closed}>
                  {saving ? 'Closing…' : 'Close Period'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
