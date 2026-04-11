window.Inventory = function Inventory() {
  const { showToast } = React.useContext(window.ToastContext);
  const now = new Date();
  const [items, setItems] = React.useState([]);
  const [categories, setCategories] = React.useState([]);
  const [movements, setMovements] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [modal, setModal] = React.useState(null); // null | add | edit | adjust
  const [form, setForm] = React.useState({ name:'', category_id:'', unit:'pcs', current_stock:'0', reorder_level:'0', notes:'', is_active:1 });
  const [adjustForm, setAdjustForm] = React.useState({ item_id:'', movement_type:'adjustment', quantity:'', movement_date: now.toISOString().slice(0,10), notes:'' });
  const [search, setSearch] = React.useState('');
  const [itemErrors, setItemErrors] = React.useState({});
  const [adjustErrors, setAdjustErrors] = React.useState({});

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [i, c, m] = await Promise.all([
        api('/api/inventory/items?include_inactive=1'),
        api('/api/inventory/categories'),
        api('/api/inventory/movements'),
      ]);
      setItems(i);
      setCategories(c);
      setMovements(m);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm({ name:'', category_id:'', unit:'pcs', current_stock:'0', reorder_level:'0', notes:'', is_active:1 });
    setItemErrors({});
    setModal('add');
  };

  const openEdit = (item) => {
    setForm({
      id: item.id,
      name: item.name,
      category_id: item.category_id || '',
      unit: item.unit,
      current_stock: String(item.current_stock || 0),
      reorder_level: String(item.reorder_level || 0),
      notes: item.notes || '',
      is_active: item.is_active,
    });
    setItemErrors({});
    setModal('edit');
  };

  const openAdjust = (item) => {
    setAdjustForm({
      item_id: String(item.id),
      movement_type: 'adjustment',
      quantity: '',
      movement_date: now.toISOString().slice(0,10),
      notes: '',
    });
    setAdjustErrors({});
    setModal('adjust');
  };

  const saveItem = async (e) => {
    e.preventDefault();
    const nextErrors = window.validateFields([
      { field: 'name', check: () => window.FormValidator.required(form.name, 'Name') },
      { field: 'unit', check: () => window.FormValidator.required(form.unit, 'Unit') },
      { field: 'reorder_level', check: () => window.FormValidator.nonNegativeNumber(form.reorder_level, 'Reorder Level') },
      { field: 'current_stock', check: () => modal === 'add' ? window.FormValidator.nonNegativeNumber(form.current_stock, 'Opening Stock') : '' },
    ]);
    setItemErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      showToast('Please fix highlighted form fields', 'error');
      return;
    }
    try {
      if (modal === 'add') {
        await api('/api/inventory/items', { method:'POST', body: form });
        if (Number(form.current_stock) !== 0) {
          const created = await api('/api/inventory/items?include_inactive=1');
          const latest = created.find(r => r.name === form.name && String(r.category_id || '') === String(form.category_id || ''));
          if (latest) {
            await api('/api/inventory/movements', {
              method: 'POST',
              body: {
                item_id: latest.id,
                movement_type: 'adjustment',
                quantity: Number(form.current_stock),
                movement_date: now.toISOString().slice(0,10),
                notes: 'Initial stock balance',
              },
            });
          }
        }
      } else {
        await api(`/api/inventory/items/${form.id}`, { method:'PUT', body: form });
      }
      setModal(null);
      showToast('Inventory item saved');
      await load();
    } catch (e2) {
      showToast(e2.message, 'error');
    }
  };

  const saveAdjustment = async (e) => {
    e.preventDefault();
    const nextErrors = window.validateFields([
      { field: 'item_id', check: () => window.FormValidator.required(adjustForm.item_id, 'Item') },
      { field: 'quantity', check: () => window.FormValidator.positiveNumber(adjustForm.quantity, 'Quantity') },
      { field: 'movement_date', check: () => window.FormValidator.required(adjustForm.movement_date, 'Date') },
    ]);
    setAdjustErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      showToast('Please fix highlighted form fields', 'error');
      return;
    }
    try {
      await api('/api/inventory/movements', { method:'POST', body: { ...adjustForm, quantity: Number(adjustForm.quantity) } });
      setModal(null);
      showToast('Stock movement recorded');
      await load();
    } catch (e2) {
      showToast(e2.message, 'error');
    }
  };

  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    return !q || i.name.toLowerCase().includes(q) || (i.category_name || '').toLowerCase().includes(q);
  });

  const lowStock = filtered.filter(i => i.is_active && Number(i.current_stock) <= Number(i.reorder_level));

  if (loading) return <window.StatePanel type="loading" message="Loading inventory…" />;

  return (
    <div>
      <window.FilterBar actions={<button className="btn btn-primary" onClick={openAdd}>+ Add Item</button>}>
        <input style={{ width: 240 }} placeholder="🔍 Search items or category" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-secondary btn-sm" onClick={load}>🔄</button>
      </window.FilterBar>

      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card"><div className="stat-label">Tracked Items</div><div className="stat-value stat-blue">{items.length}</div></div>
        <div className="stat-card"><div className="stat-label">Low Stock Alerts</div><div className="stat-value stat-red">{lowStock.length}</div></div>
        <div className="stat-card"><div className="stat-label">Latest Movements</div><div className="stat-value stat-green">{movements.length}</div></div>
      </div>

      <div className="content-grid-2" style={{ alignItems: 'start' }}>
        <div className="card table-card" style={{ minWidth: 0 }}>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table>
              <thead><tr><th>Item</th><th>Category</th><th>Stock</th><th>Reorder</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.length === 0 ? <tr><td colSpan={6}><window.StatePanel type="empty" icon="📦" message="No items found" compact /></td></tr> : filtered.map(i => (
                  <tr key={i.id}>
                    <td><strong>{i.name}</strong><div style={{ color:'var(--muted)', fontSize: 12 }}>{i.notes || '—'}</div></td>
                    <td>{i.category_name || 'Uncategorized'}</td>
                    <td style={{ color: Number(i.current_stock) <= Number(i.reorder_level) ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{i.current_stock} {i.unit}</td>
                    <td>{i.reorder_level} {i.unit}</td>
                    <td><window.StatusBadge status={i.is_active ? 'active' : 'inactive'} /></td>
                    <td><div style={{ display:'flex', gap:6 }}><button className="btn btn-secondary btn-sm" onClick={() => openEdit(i)}>✏️</button><button className="btn btn-amber btn-sm" onClick={() => openAdjust(i)}>±</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section-stack" style={{ minWidth: 0 }}>
          <div className="card">
            <div className="card-title">⚠️ Low Stock Warning</div>
            {lowStock.length === 0 ? <div style={{ color:'var(--muted)' }}>No low-stock items.</div> : (
              <div style={{ display:'grid', gap: 8 }}>
                {lowStock.map(i => <div key={i.id} style={{ border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px' }}><strong>{i.name}</strong><div style={{ fontSize:12, color:'var(--red)' }}>{i.current_stock} / reorder {i.reorder_level} {i.unit}</div></div>)}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-title">🕘 Stock Movement History</div>
            {movements.length === 0 ? <div style={{ color:'var(--muted)' }}>No movements yet.</div> : (
              <div style={{ display:'grid', gap:8, maxHeight:340, overflowY:'auto' }}>
                {movements.slice(0, 20).map(m => (
                  <div key={m.id} style={{ border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px' }}>
                    <div style={{ fontWeight:700 }}>{m.item_name} <span className="badge badge-gray" style={{ marginLeft:6 }}>{m.movement_type}</span></div>
                    <div style={{ fontSize:12, color:'var(--mid)' }}>{m.movement_date} · {m.quantity} {m.unit}</div>
                    {m.notes && <div style={{ fontSize:12, color:'var(--muted)' }}>{m.notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {modal === 'add' || modal === 'edit' ? (
        <window.Modal title={modal === 'add' ? 'Add Inventory Item' : 'Edit Inventory Item'} onClose={() => setModal(null)}>
          <form onSubmit={saveItem}>
            <div className="form-grid">
              <div className="form-group"><label>Name *</label><input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />{itemErrors.name ? <small style={{ color:'var(--red)' }}>{itemErrors.name}</small> : null}</div>
              <div className="form-group"><label>Category</label><select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}><option value="">Uncategorized</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="form-group"><label>Unit *</label><input required value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="kg / litre / pcs / box" />{itemErrors.unit ? <small style={{ color:'var(--red)' }}>{itemErrors.unit}</small> : null}</div>
              <div className="form-group"><label>Reorder Level *</label><input type="number" step="0.01" min="0" required value={form.reorder_level} onChange={e => setForm(f => ({ ...f, reorder_level: e.target.value }))} />{itemErrors.reorder_level ? <small style={{ color:'var(--red)' }}>{itemErrors.reorder_level}</small> : null}</div>
              {modal === 'add' && <div className="form-group"><label>Opening Stock</label><input type="number" step="0.01" value={form.current_stock} onChange={e => setForm(f => ({ ...f, current_stock: e.target.value }))} />{itemErrors.current_stock ? <small style={{ color:'var(--red)' }}>{itemErrors.current_stock}</small> : null}</div>}
              <div className="form-group"><label>Status</label><select value={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: Number(e.target.value) }))}><option value={1}>Active</option><option value={0}>Inactive</option></select></div>
              <div className="form-group span2"><label>Notes</label><textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="btn btn-primary">Save</button></div>
          </form>
        </window.Modal>
      ) : null}

      {modal === 'adjust' && (
        <window.Modal title="Quick Stock Adjustment" onClose={() => setModal(null)}>
          <form onSubmit={saveAdjustment}>
            <div className="form-grid">
              <div className="form-group"><label>Item *</label><select required value={adjustForm.item_id} onChange={e => setAdjustForm(f => ({ ...f, item_id: e.target.value }))}>{items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.current_stock} {i.unit})</option>)}</select>{adjustErrors.item_id ? <small style={{ color:'var(--red)' }}>{adjustErrors.item_id}</small> : null}</div>
              <div className="form-group"><label>Movement *</label><select required value={adjustForm.movement_type} onChange={e => setAdjustForm(f => ({ ...f, movement_type: e.target.value }))}><option value="adjustment">Adjustment</option><option value="purchase">Purchase/In</option><option value="usage">Usage/Out</option><option value="waste">Waste/Spoilage</option></select></div>
              <div className="form-group"><label>Quantity *</label><input type="number" step="0.01" required value={adjustForm.quantity} onChange={e => setAdjustForm(f => ({ ...f, quantity: e.target.value }))} />{adjustErrors.quantity ? <small style={{ color:'var(--red)' }}>{adjustErrors.quantity}</small> : null}</div>
              <div className="form-group"><label>Date *</label><input type="date" required value={adjustForm.movement_date} onChange={e => setAdjustForm(f => ({ ...f, movement_date: e.target.value }))} />{adjustErrors.movement_date ? <small style={{ color:'var(--red)' }}>{adjustErrors.movement_date}</small> : null}</div>
              <div className="form-group span2"><label>Notes</label><textarea rows={2} value={adjustForm.notes} onChange={e => setAdjustForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="btn btn-primary">Record</button></div>
          </form>
        </window.Modal>
      )}
    </div>
  );
};
