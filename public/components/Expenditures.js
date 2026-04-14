window.Expenditures = function Expenditures() {
  const { showToast } = React.useContext(window.ToastContext);
  const now = new Date();
  const [month,   setMonth]   = React.useState(now.getMonth() + 1);
  const [year,    setYear]    = React.useState(now.getFullYear());
  const [rows,    setRows]    = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search,  setSearch]  = React.useState('');
  const [catFilter, setCatFilter] = React.useState('');
  const [modal,   setModal]   = React.useState(null); // null | 'add' | row
  const [saving,  setSaving]  = React.useState(false);
  const [uploadFile, setUploadFile] = React.useState(null);
  const [attachments, setAttachments] = React.useState([]);
  const [loadingAttachments, setLoadingAttachments] = React.useState(false);
  const [page,    setPage]    = React.useState(1);
  const [stockItems, setStockItems] = React.useState([]);
  const [errors, setErrors] = React.useState({});
  const PER = 20;

  const CATEGORIES = ['utilities','supplies','transport','rent','food','cleaning','other'];
  const EMPTY = { category:'', description:'', amount:'', expense_date: window.todayLocalISO(), receipt_ref:'', notes:'', stock_item_id:'', stock_quantity:'' };
  const [form, setForm] = React.useState(EMPTY);

  const years = [];
  for (let y = now.getFullYear(); y >= 2022; y--) years.push(y);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/expenditures?month=${month}&year=${year}`;
      if (catFilter) url += `&category=${catFilter}`;
      const [expRows, invItems] = await Promise.all([api(url), api('/api/inventory/items')]);
      setRows(expRows);
      setStockItems(invItems.filter(i => i.is_active));
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [month, year, catFilter]);

  React.useEffect(() => { load(); setPage(1); }, [load]);

  const filtered = rows.filter(r => {
    const q = search.toLowerCase();
    return !q || r.description.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
  });
  const paged = filtered.slice((page-1)*PER, page*PER);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const loadAttachments = async (id) => {
    setLoadingAttachments(true);
    try {
      setAttachments(await api(`/api/attachments/expenditure/${id}`));
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoadingAttachments(false); }
  };

  const openAdd  = () => { setForm(EMPTY); setErrors({}); setUploadFile(null); setAttachments([]); setModal('add'); };
  const openEdit = (r) => {
    setForm({ ...r, amount: String(r.amount), receipt_ref: r.receipt_ref||'', notes: r.notes||'', stock_item_id: r.stock_item_id || '', stock_quantity: r.stock_quantity == null ? '' : String(r.stock_quantity) });
    setErrors({});
    setUploadFile(null);
    setModal(r);
    loadAttachments(r.id);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const nextErrors = window.validateFields([
      { field: 'category', check: () => window.FormValidator.required(form.category, 'Category') },
      { field: 'expense_date', check: () => window.FormValidator.required(form.expense_date, 'Date') },
      { field: 'description', check: () => window.FormValidator.required(form.description, 'Description') },
      { field: 'amount', check: () => window.FormValidator.positiveNumber(form.amount, 'Amount') },
      {
        field: 'stock_quantity',
        check: () => form.stock_item_id ? window.FormValidator.nonNegativeNumber(form.stock_quantity, 'Purchased Stock Quantity') : '',
      },
    ]);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      showToast('Please fix highlighted form fields', 'error');
      return;
    }
    setSaving(true);
    try {
      let expenditureId = modal?.id;
      if (modal === 'add') {
        const created = await api('/api/expenditures', { method: 'POST', body: form });
        expenditureId = created.id;
        showToast('Expenditure added');
      } else {
        await api(`/api/expenditures/${modal.id}`, { method: 'PUT', body: form });
        showToast('Expenditure updated');
      }
      if (uploadFile && expenditureId) {
        const fd = new FormData();
        fd.append('file', uploadFile);
        await apiFormData(`/api/attachments/expenditure/${expenditureId}`, fd, { method: 'POST' });
        showToast('Receipt attachment uploaded');
      }
      setModal(null);
      load();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (r) => {
    if (!confirm2(`Void "${r.description}"?`)) return;
    const void_reason = window.prompt('Void reason (required for audit trail):');
    if (!void_reason || !void_reason.trim()) {
      showToast('Void reason is required', 'error');
      return;
    }
    try {
      await api(`/api/expenditures/${r.id}`, { method: 'DELETE', body: { void_reason: void_reason.trim() } });
      showToast('Expenditure voided');
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleDeleteAttachment = async (expenditureId, attachment) => {
    if (!confirm2(`Delete attachment "${attachment.original_name}"?`)) return;
    try {
      await api(`/api/attachments/expenditure/${expenditureId}/${attachment.id}`, { method: 'DELETE' });
      showToast('Attachment deleted');
      await loadAttachments(expenditureId);
      await load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  // Category totals for breakdown card
  const byCategory = {};
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;

  const catLabel = { utilities:'Utilities', supplies:'Supplies', transport:'Transport', rent:'Rent', food:'Food', cleaning:'Cleaning', other:'Other' };
  const catColor = { utilities:'stat-blue', supplies:'stat-amber', transport:'stat-green', rent:'stat-red', food:'stat-amber', cleaning:'stat-blue', other:'stat-gray' };

  return (
    <div>
      {/* Breakdown mini-cards */}
      <div className="stat-grid" style={{ marginBottom:20 }}>
        <div className="stat-card">
          <div className="stat-label">Total {window.MONTHS[month-1]} {year}</div>
          <div className="stat-value stat-amber">{fmtRM(total)}</div>
        </div>
        {Object.entries(byCategory).map(([cat, val]) => (
          <div key={cat} className="stat-card">
            <div className="stat-label">{catLabel[cat] || cat}</div>
            <div className={`stat-value ${catColor[cat] || ''}`}>{fmtRM(val)}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <window.FilterBar actions={<button className="btn btn-primary" onClick={openAdd}>+ Add Expenditure</button>}>
        <input className="students-search" placeholder="Search description…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select value={catFilter} onChange={e => { setCatFilter(e.target.value); setPage(1); }}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{catLabel[c]}</option>)}
        </select>
        <select className="students-period-month" value={month} onChange={e => { setMonth(+e.target.value); setPage(1); }}>
          {window.MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
        </select>
        <select className="students-period-year" value={year} onChange={e => { setYear(+e.target.value); setPage(1); }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
      </window.FilterBar>

      <div className="card" style={{ padding:0 }}>
        {loading ? <window.StatePanel type="loading" message="Loading expenditures…" /> : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Date</th><th>Category</th><th>Description</th><th style={{ textAlign:'right' }}>Amount</th><th>Stock Link</th><th>Receipt Ref</th><th>Attachment</th><th>Added By</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr><td colSpan={9}><window.StatePanel type="empty"  message="No expenditures found" compact /></td></tr>
                  ) : paged.map(r => (
                    <tr key={r.id}>
                      <td>{r.expense_date}</td>
                      <td><span className="badge badge-blue" style={{ textTransform:'capitalize' }}>{r.category}</span></td>
                      <td>{r.description}{r.notes && <span style={{ color:'var(--muted)', fontSize:11 }}> — {r.notes}</span>}</td>
                      <td style={{ textAlign:'right', fontWeight:600, color:'var(--amber)' }}>{fmtRM(r.amount)}</td>
                      <td>{r.stock_item_name ? <span className='badge badge-green'>{r.stock_item_name} ({r.stock_quantity || 0} {r.stock_item_unit || ''})</span> : '—'}</td>
                      <td style={{ color:'var(--muted)', fontSize:12 }}>{r.receipt_ref || '—'}</td>
                      <td>{r.attachment_count > 0 ? <span className="badge badge-green">att {r.attachment_count}</span> : '—'}</td>
                      <td>{r.added_by_name || '—'}</td>
                      <td>
                        <div className="table-row-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(r)}>Edit</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Void</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span className="filters-total" style={{ color:'var(--amber)' }}>Total: {fmtRM(filtered.reduce((s,r)=>s+r.amount,0))}</span>
              <window.Pagination page={page} total={filtered.length} perPage={PER} onChange={setPage} />
            </div>
          </>
        )}
      </div>

      {modal && (
        <window.Modal title={modal === 'add' ? 'Add Expenditure' : `Edit — ${modal.description}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSave}>
            <div className="form-grid">
              <div className="form-group">
                <label>Category *</label>
                <select required value={form.category} onChange={e => setForm(f=>({...f, category:e.target.value}))}>
                  <option value="">— Select —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{catLabel[c]}</option>)}
                </select>
                {errors.category ? <small style={{ color:'var(--red)' }}>{errors.category}</small> : null}
              </div>
              <div className="form-group">
                <label>Date *</label>
                <input type="date" required value={form.expense_date} onChange={e => setForm(f=>({...f, expense_date:e.target.value}))} />
                {errors.expense_date ? <small style={{ color:'var(--red)' }}>{errors.expense_date}</small> : null}
              </div>
              <div className="form-group span2">
                <label>Description *</label>
                <input required value={form.description} onChange={e => setForm(f=>({...f, description:e.target.value}))} placeholder="e.g. March electricity bill" />
                {errors.description ? <small style={{ color:'var(--red)' }}>{errors.description}</small> : null}
              </div>
              <div className="form-group">
                <label>Amount (RM) *</label>
                <input type="number" min="0.01" step="0.01" required value={form.amount} onChange={e => setForm(f=>({...f, amount:e.target.value}))} />
                {errors.amount ? <small style={{ color:'var(--red)' }}>{errors.amount}</small> : null}
              </div>
              <div className="form-group">
                <label>Receipt Ref</label>
                <input value={form.receipt_ref} onChange={e => setForm(f=>({...f, receipt_ref:e.target.value}))} placeholder="Optional" />
              </div>
              <div className="form-group">
                <label>Stock Purchase Item (optional)</label>
                <select value={form.stock_item_id || ''} onChange={e => setForm(f=>({...f, stock_item_id:e.target.value}))}>
                  <option value="">— No inventory linkage —</option>
                  {stockItems.map(si => <option key={si.id} value={si.id}>{si.name} ({si.unit})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Purchased Stock Quantity</label>
                <input type="number" min="0" step="0.01" value={form.stock_quantity || ''} onChange={e => setForm(f=>({...f, stock_quantity:e.target.value}))} placeholder="Optional" />
                {errors.stock_quantity ? <small style={{ color:'var(--red)' }}>{errors.stock_quantity}</small> : null}
              </div>
              <div className="form-group span2">
                <label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={e => setForm(f=>({...f, notes:e.target.value}))} placeholder="Optional notes…" />
              </div>
              <div className="form-group span2">
                <label>Receipt Attachment (pdf/jpg/png/webp, max 5MB)</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={e => setUploadFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            {modal !== 'add' && (
              <div style={{ marginTop:12 }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>Existing Attachments</div>
                {loadingAttachments ? <div style={{ color:'var(--muted)', fontSize:12 }}>Loading attachments…</div> : attachments.length === 0 ? (
                  <div style={{ color:'var(--muted)', fontSize:12 }}>No attachments uploaded.</div>
                ) : (
                  <div style={{ display:'grid', gap:8 }}>
                    {attachments.map(att => (
                      <div key={att.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px' }}>
                        <div style={{ fontSize:12 }}>
                          <strong>{att.original_name}</strong> <span style={{ color:'var(--muted)' }}>({(att.file_size/1024).toFixed(1)} KB)</span>
                        </div>
                        <div style={{ display:'flex', gap:6 }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadWithAuth(`/api/attachments/expenditure/${modal.id}/${att.id}/download`, att.original_name)}>⬇</button>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDeleteAttachment(modal.id, att)}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </window.Modal>
      )}
    </div>
  );
};
