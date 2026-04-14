// DutyLog handles 3 modes: submit (student), review (admin/teacher), history (student)
window.DutyLog = function DutyLog({ user, mode }) {
  const { showToast } = React.useContext(window.ToastContext);

  if (mode === 'submit')  return <DutySubmit user={user} />;
  if (mode === 'history') return <DutyHistory user={user} />;
  return <DutyReview user={user} />;
};

// ── Submit Form ───────────────────────────────────────────────────────────────
function DutySubmit({ user }) {
  const { showToast } = React.useContext(window.ToastContext);
  const today = new Date().toISOString().slice(0, 10);

  const EMPTY_ITEM = { item_name: '', quantity: 1, unit_price: '', total_price: 0, inventory_item_id: '', stock_quantity_used: '' };
  const [form, setForm] = React.useState({
    duty_number: '',
    date: today,
    notes: '',
    items: [{ ...EMPTY_ITEM }],
  });
  const [saving, setSaving] = React.useState(false);
  const [attachmentFile, setAttachmentFile] = React.useState(null);
  const [submitted, setSubmitted] = React.useState(null);
  const [stockItems, setStockItems] = React.useState([]);


  React.useEffect(() => {
    api('/api/inventory/items')
      .then((rows) => setStockItems(rows.filter(r => r.is_active)))
      .catch(() => {});
  }, []);
  const updateItem = (i, field, val) => {
    setForm(f => {
      const items = [...f.items];
      items[i] = { ...items[i], [field]: val };
      if (field === 'quantity' || field === 'unit_price') {
        const qty = parseFloat(field === 'quantity' ? val : items[i].quantity) || 0;
        const up  = parseFloat(field === 'unit_price' ? val : items[i].unit_price) || 0;
        items[i].total_price = qty * up;
      }
      return { ...f, items };
    });
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }));

  const linkedItemsCount = form.items.filter(item => !!item.inventory_item_id).length;
  const attachmentLabel = attachmentFile ? attachmentFile.name : 'No file attached yet';
  const grandTotal = form.items.reduce((s, item) => s + (parseFloat(item.total_price) || 0), 0);

  const handleInventoryPick = (i, value) => {
    const chosen = stockItems.find((item) => String(item.id) === String(value));
    setForm((f) => {
      const items = [...f.items];
      const current = items[i] || { ...EMPTY_ITEM };
      items[i] = {
        ...current,
        inventory_item_id: value,
        item_name: chosen ? chosen.name : current.item_name,
      };
      return { ...f, items };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.items.some(i => !i.item_name || !i.unit_price)) {
      showToast('Please fill in all item names and prices', 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await api('/api/duty', { method: 'POST', body: form });
      if (attachmentFile) {
        const fd = new FormData();
        fd.append('file', attachmentFile);
        await apiFormData(`/api/attachments/duty_log/${result.id}`, fd, { method: 'POST' });
      }
      showToast('Duty log submitted successfully!');
      setSubmitted({ ...form, id: result.id, grandTotal, attachmentUploaded: !!attachmentFile });
      setForm({ duty_number:'', date: today, notes:'', items:[{ ...EMPTY_ITEM }] });
      setAttachmentFile(null);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      {submitted && (
        <div style={{ background:'var(--green-light)', border:'1px solid var(--green)', borderRadius:8, padding:'14px 18px', marginBottom:16, color:'var(--green)', fontWeight:600 }}>
          Duty log <strong>{submitted.duty_number}</strong> submitted — Total: {fmtRM(submitted.grandTotal)}
          {submitted.attachmentUploaded && <span> (with attachment)</span>}
          <button className="btn btn-secondary btn-sm" style={{ marginLeft:12 }} onClick={() => setSubmitted(null)}>Submit another</button>
        </div>
      )}

      <div className="info-banner">
        <div className="icon"></div>
        <div>
          <strong>What to do here</strong>
          <div className="muted" style={{ marginTop: 4 }}>
            Start with the duty number and date, add every item in one list, then attach proof only if you have it. The summary on the right updates while you type.
          </div>
        </div>
      </div>

      <div className="content-grid-2">
        <div className="card" style={{ maxWidth: '100%' }}>
          <div className="card-title">New Duty Log</div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
            <div className="form-group">
              <label>Duty Number *</label>
              <input required value={form.duty_number} onChange={e => setForm(f=>({...f, duty_number:e.target.value}))} placeholder="e.g. DUTY-2026-006" />
            </div>
            <div className="form-group">
              <label>Date *</label>
              <input type="date" required value={form.date} onChange={e => setForm(f=>({...f, date:e.target.value}))} />
            </div>
            <div className="form-group span2">
              <label>Notes (optional)</label>
              <input value={form.notes} onChange={e => setForm(f=>({...f, notes:e.target.value}))} placeholder="Any remarks…" />
            </div>
          </div>

          {/* Items table */}
          <div style={{ marginTop: 20, marginBottom: 8, fontWeight:700 }}>Items</div>
          <div className="table-scroll">
            <table className="items-table" style={{ marginBottom:0 }}>
              <thead>
                <tr>
                  <th>Item Name *</th>
                  <th>Qty *</th>
                  <th>Unit Price (RM) *</th>
                  <th>Total (RM)</th>
                  <th>Inventory Link</th>
                  <th>Stock Used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, i) => (
                  <tr key={i}>
                    <td><input value={item.item_name} onChange={e => updateItem(i,'item_name',e.target.value)} placeholder="e.g. Beras 5kg" required /></td>
                    <td><input type="number" min="0.1" step="0.1" value={item.quantity} onChange={e => updateItem(i,'quantity',e.target.value)} /></td>
                    <td><input type="number" min="0.01" step="0.01" value={item.unit_price} onChange={e => updateItem(i,'unit_price',e.target.value)} placeholder="0.00" required /></td>
                    <td style={{ fontWeight:600, padding:'4px 14px' }}>{fmtRM(item.total_price)}</td>
                    <td>
                      <select value={item.inventory_item_id || ''} onChange={e => handleInventoryPick(i, e.target.value)}>
                        <option value="">— none —</option>
                        {stockItems.map(si => <option key={si.id} value={si.id}>{si.name} ({si.unit})</option>)}
                      </select>
                    </td>
                    <td>
                      <input type="number" min="0" step="0.01" value={item.stock_quantity_used || ''} onChange={e => updateItem(i,'stock_quantity_used',e.target.value)} placeholder="qty" />
                    </td>
                    <td>
                      {form.items.length > 1 && (
                        <button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => removeItem(i)}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign:'right', fontWeight:700, padding:'10px 14px' }}>Grand Total</td>
                  <td style={{ fontWeight:700, color:'var(--green)', padding:'10px 14px' }}>{fmtRM(grandTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

            <div style={{ display:'flex', justifyContent:'space-between', marginTop:14, gap: 12, flexWrap: 'wrap' }}>
              <div>
                <button type="button" className="btn btn-secondary" onClick={addItem}>+ Add Item</button>
                <div style={{ marginTop:8 }}>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={e => setAttachmentFile(e.target.files?.[0] || null)} />
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>Optional evidence (pdf/jpg/png/webp, max 5MB)</div>
                </div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Submitting…' : 'Submit Duty Log'}
              </button>
            </div>
          </form>
        </div>

        <div className="card sticky-card">
          <div className="card-title">Before you submit</div>
          <div className="check-list">
            <div className="check-item">
              <span>Duty number</span>
              <strong>{form.duty_number ? form.duty_number : 'Missing'}</strong>
            </div>
            <div className="check-item">
              <span>Date</span>
              <strong>{form.date}</strong>
            </div>
            <div className="check-item">
              <span>Items added</span>
              <strong>{form.items.length}</strong>
            </div>
            <div className="check-item">
              <span>Linked to inventory</span>
              <strong>{linkedItemsCount}</strong>
            </div>
            <div className="check-item">
              <span>Attachment</span>
              <strong style={{ maxWidth: 180, textAlign: 'right', overflowWrap: 'anywhere' }}>{attachmentLabel}</strong>
            </div>
            <div className="check-item">
              <span>Total</span>
              <strong style={{ color: 'var(--green)' }}>{fmtRM(grandTotal)}</strong>
            </div>
          </div>
          <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--mid)' }}>
            If a line matches an inventory item, link it so reviewers can see stock usage without guessing.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Review (admin/teacher) ────────────────────────────────────────────────────
function DutyReview({ user }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [rows,    setRows]    = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filter,  setFilter]  = React.useState('pending');
  const [detail,  setDetail]  = React.useState(null);
  const [page,    setPage]    = React.useState(1);
  const PER = 15;

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === 'all' ? '/api/duty' : `/api/duty?status=${filter}`;
      setRows(await api(url));
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [filter]);

  React.useEffect(() => { load(); setPage(1); }, [load]);

  const handleStatus = async (id, status, notes = '') => {
    try {
      await api(`/api/duty/${id}/status`, { method: 'PUT', body: { status, notes } });
      showToast(`Log ${status}`);
      load();
      setDetail(null);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const paged = rows.slice((page-1)*PER, page*PER);

  return (
    <div>
      <div className="filters">
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="flagged">Flagged</option>
          <option value="all">All</option>
        </select>
        <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
        <span style={{ marginLeft:'auto', fontSize:13, color:'var(--mid)' }}>{rows.length} log(s)</span>
      </div>

      <div className="card" style={{ padding:0, maxWidth: '100%' }}>
        {loading ? <div className="empty"><div className="icon">⏳</div>Loading…</div> : (
          <>
            <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Duty No.</th><th>Date</th><th>Submitted By</th><th>Items</th><th>Total</th><th>Att.</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={8}><div className="empty"><div className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.45}}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></div>No duty logs found</div></td></tr>
                ) : paged.map(log => {
                  const total = (log.items || []).reduce((s, i) => s + i.total_price, 0);
                  return (
                    <tr key={log.id}>
                      <td><strong>{log.duty_number}</strong></td>
                      <td>{log.date}</td>
                      <td>{log.submitted_by_name}</td>
                      <td>{(log.items||[]).length} item(s)</td>
                      <td style={{ fontWeight:600 }}>{fmtRM(total)}</td>
                      <td>{log.attachment_count > 0 ? <span className="badge badge-green">att {log.attachment_count}</span> : '—'}</td>
                      <td><window.StatusBadge status={log.status} /></td>
                      <td>
                        <div style={{ display:'flex', gap:6 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setDetail(log)}>View View</button>
                          {log.status === 'pending' && <>
                            <button className="btn btn-primary btn-sm" onClick={() => handleStatus(log.id, 'approved')}>✓ Approve</button>
                            <button className="btn btn-amber btn-sm" onClick={() => {
                              const notes = window.prompt('Reason for flagging:');
                              if (notes !== null) handleStatus(log.id, 'flagged', notes);
                            }}>⚑ Flag</button>
                          </>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            <div style={{ padding:'12px 16px' }}>
              <window.Pagination page={page} total={rows.length} perPage={PER} onChange={setPage} />
            </div>
          </>
        )}
      </div>

      {/* Detail modal */}
      {detail && (
        <window.Modal title={`Duty Log — ${detail.duty_number}`} onClose={() => setDetail(null)}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:10, marginBottom:16, fontSize:13 }}>
            <div><strong>Date:</strong> {detail.date}</div>
            <div><strong>Submitted by:</strong> {detail.submitted_by_name}</div>
            <div><strong>Status:</strong> <window.StatusBadge status={detail.status} /></div>
            {detail.reviewed_by_name && <div><strong>Reviewed by:</strong> {detail.reviewed_by_name}</div>}
            {detail.notes && <div style={{ gridColumn:'1/-1' }}><strong>Notes:</strong> {detail.notes}</div>}
          </div>
          <div className="table-scroll">
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
            <tbody>
              {(detail.items||[]).map((item, i) => (
                <tr key={i}>
                  <td>{item.item_name}</td>
                  <td>{item.quantity}</td>
                  <td>{fmtRM(item.unit_price)}</td>
                  <td style={{ fontWeight:600 }}>{fmtRM(item.total_price)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ textAlign:'right', fontWeight:700 }}>Grand Total</td>
                <td style={{ fontWeight:700, color:'var(--green)' }}>
                  {fmtRM((detail.items||[]).reduce((s,i)=>s+i.total_price,0))}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <DutyAttachments entityId={detail.id} canManage={user.role === 'admin'} />
          {detail.status === 'pending' && (
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => handleStatus(detail.id, 'approved')}>✓ Approve</button>
              <button className="btn btn-amber" onClick={() => {
                const notes = window.prompt('Reason for flagging:');
                if (notes !== null) handleStatus(detail.id, 'flagged', notes);
              }}>⚑ Flag</button>
            </div>
          )}
        </window.Modal>
      )}
    </div>
  );
}

// ── History (student's own logs) ──────────────────────────────────────────────
function DutyHistory({ user }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [rows,    setRows]    = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [detail,  setDetail]  = React.useState(null);

  React.useEffect(() => {
    api('/api/duty')
      .then(setRows)
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty"><div className="icon">⏳</div>Loading…</div>;

  return (
    <div>
      <div className="card" style={{ padding:0, maxWidth: '100%' }}>
        {rows.length === 0 ? (
          <div className="empty"><div className="icon"></div>No duty logs submitted yet</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead><tr><th>Duty No.</th><th>Date</th><th>Items</th><th>Total</th><th>Att.</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map(log => {
                const total = (log.items||[]).reduce((s,i) => s+i.total_price, 0);
                return (
                  <tr key={log.id}>
                    <td><strong>{log.duty_number}</strong></td>
                    <td>{log.date}</td>
                    <td>{(log.items||[]).length}</td>
                    <td style={{ fontWeight:600 }}>{fmtRM(total)}</td>
                    <td>{log.attachment_count > 0 ? <span className="badge badge-green">att {log.attachment_count}</span> : '—'}</td>
                    <td><window.StatusBadge status={log.status} /></td>
                    <td><button className="btn btn-secondary btn-sm" onClick={() => setDetail(log)}>View View</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {detail && (
        <window.Modal title={`Duty Log — ${detail.duty_number}`} onClose={() => setDetail(null)}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:10, marginBottom:16, fontSize:13 }}>
            <div><strong>Date:</strong> {detail.date}</div>
            <div><strong>Status:</strong> <window.StatusBadge status={detail.status} /></div>
            {detail.notes && <div style={{ gridColumn:'1/-1' }}><strong>Reviewer notes:</strong> {detail.notes}</div>}
          </div>
          <div className="table-scroll">
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
            <tbody>
              {(detail.items||[]).map((item, i) => (
                <tr key={i}>
                  <td>{item.item_name}</td>
                  <td>{item.quantity}</td>
                  <td>{fmtRM(item.unit_price)}</td>
                  <td style={{ fontWeight:600 }}>{fmtRM(item.total_price)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ textAlign:'right', fontWeight:700 }}>Grand Total</td>
                <td style={{ fontWeight:700, color:'var(--green)' }}>
                  {fmtRM((detail.items||[]).reduce((s,i)=>s+i.total_price,0))}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <DutyAttachments entityId={detail.id} canManage={user.role === 'admin' || user.id === detail.submitted_by} />
        </window.Modal>
      )}
    </div>
  );
}

function DutyAttachments({ entityId, canManage }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [file, setFile] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { setRows(await api(`/api/attachments/duty_log/${entityId}`)); }
    catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [entityId]);

  React.useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiFormData(`/api/attachments/duty_log/${entityId}`, fd, { method: 'POST' });
      setFile(null);
      showToast('Attachment uploaded');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setUploading(false); }
  };

  const remove = async (att) => {
    if (!confirm2(`Delete attachment "${att.original_name}"?`)) return;
    try {
      await api(`/api/attachments/duty_log/${entityId}/${att.id}`, { method: 'DELETE' });
      showToast('Attachment deleted');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div style={{ marginTop:14 }}>
      <div style={{ fontWeight:700, marginBottom:6 }}>Attachments</div>
      {loading ? <div style={{ fontSize:12, color:'var(--muted)' }}>Loading attachments…</div> : rows.length === 0 ? (
        <div style={{ fontSize:12, color:'var(--muted)' }}>No attachments uploaded.</div>
      ) : (
        <div style={{ display:'grid', gap:8, marginBottom:8 }}>
          {rows.map(att => (
            <div key={att.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px' }}>
              <div style={{ fontSize:12 }}>
                <strong>{att.original_name}</strong> <span style={{ color:'var(--muted)' }}>({(att.file_size/1024).toFixed(1)} KB)</span>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadWithAuth(`/api/attachments/duty_log/${entityId}/${att.id}/download`, att.original_name)}>⬇</button>
                {canManage && <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(att)}>Del</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {canManage && (
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} />
          <button type="button" className="btn btn-primary btn-sm" disabled={!file || uploading} onClick={upload}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      )}
    </div>
  );
}
