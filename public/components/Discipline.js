// ── Discipline Module — Admin UI ──────────────────────────────────────────────
// Tabs: Rules management | Violations list + add form

(function () {
  const { useState, useEffect, useCallback, useContext, useRef } = React;
  const fmtDate = (d) => d ? d.slice(0, 10) : '—';

  const SEVERITIES = ['minor', 'moderate', 'serious'];
  const STATUSES   = ['pending', 'reviewed', 'confirmed', 'resolved', 'appealed'];
  const SAMPLE_RULES_CSV = `rule_code,title,category,article_reference,severity,default_action,description,active
GEN-001,Disrespectful behaviour,General Conduct,Article 1,moderate,Meeting with coordinator/principal/teacher; formal record,Student failed to treat teachers staff fellow students or visitors with basic respect,true
ACA-004,Cheating copying or plagiarism,Academic Responsibilities,Article 2,serious,Leadership review; formal disciplinary record,Student engaged in cheating copying or plagiarism in any form,true
HOS-003,AWOL or failure to return,Hostel / Curfew,Article 9,serious,Immediate guardian contact; leadership review,Student failed to return and did not notify staff,true`;
  const CATEGORIES = [
    'General Conduct', 'Academic Responsibilities', 'Dress Code',
    'Facilities Use', 'Mobile Phones & Electronics', 'Visitors',
    'Health & Hygiene', 'Hostel / Curfew', 'Dormitory Conduct',
    'Gender Separation', 'Kitchen / Dining', 'Shared Responsibilities',
    'Safety', 'Study Hours', 'Prohibited Items',
  ];

  function severityBadge(sev) {
    const map = { minor: 'badge-blue', moderate: 'badge-amber', serious: 'badge-red' };
    return <span className={`badge ${map[sev] || 'badge-gray'}`}>{sev}</span>;
  }
  function statusBadge(s) {
    const map = { pending: 'badge-gray', reviewed: 'badge-blue', confirmed: 'badge-amber', resolved: 'badge-green', appealed: 'badge-red' };
    return <span className={`badge ${map[s] || 'badge-gray'}`}>{s}</span>;
  }

  // ── Rules Management ─────────────────────────────────────────────────────────

  const RULE_EMPTY = { rule_code: '', title: '', category: CATEGORIES[0], article_reference: '', description: '', severity: 'minor', default_action: '' };

  function RulesTab() {
    const { showToast } = useContext(window.ToastContext);
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showInactive, setShowInactive] = useState(false);
    const [modal, setModal] = useState(null); // null | { mode:'add'|'edit', rule? }
    const [form, setForm] = useState(RULE_EMPTY);
    const [errors, setErrors] = useState({});
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
      setLoading(true);
      try {
        const data = await api('/api/discipline/rules');
        setRules(data);
      } catch (e) { showToast(e.message, 'error'); }
      finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const openAdd = () => { setForm(RULE_EMPTY); setErrors({}); setModal({ mode: 'add' }); };
    const openEdit = (r) => {
      setForm({ rule_code: r.rule_code, title: r.title, category: r.category, article_reference: r.article_reference || '', description: r.description || '', severity: r.severity, default_action: r.default_action || '' });
      setErrors({});
      setModal({ mode: 'edit', rule: r });
    };

    const handleSave = async (e) => {
      e.preventDefault();
      const errs = window.validateFields([
        { field: 'rule_code', check: () => window.FormValidator.required(form.rule_code, 'Rule Code') },
        { field: 'title',     check: () => window.FormValidator.required(form.title, 'Title') },
        { field: 'category',  check: () => window.FormValidator.required(form.category, 'Category') },
        { field: 'severity',  check: () => window.FormValidator.required(form.severity, 'Severity') },
      ]);
      if (Object.keys(errs).length) { setErrors(errs); return; }
      setBusy(true);
      try {
        if (modal.mode === 'add') {
          await api('/api/discipline/rules', { method: 'POST', body: form });
          showToast('Rule created.', 'success');
        } else {
          await api(`/api/discipline/rules/${modal.rule.id}`, { method: 'PUT', body: form });
          showToast('Rule updated.', 'success');
        }
        setModal(null);
        load();
      } catch (e) { showToast(e.message, 'error'); }
      finally { setBusy(false); }
    };

    const toggleActive = async (r) => {
      try {
        await api(`/api/discipline/rules/${r.id}`, { method: 'PUT', body: { active: r.active ? 0 : 1 } });
        showToast(r.active ? 'Rule archived.' : 'Rule restored.', 'success');
        load();
      } catch (e) { showToast(e.message, 'error'); }
    };

    const visible = showInactive ? rules : rules.filter(r => r.active);

    // Group by category
    const grouped = visible.reduce((acc, r) => {
      (acc[r.category] = acc[r.category] || []).push(r);
      return acc;
    }, {});

    return (
      <div>
        <div className="filters" style={{ marginBottom: 16 }}>
          <div className="filters-main">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{ width: 'auto' }} />
              Show archived rules
            </label>
          </div>
          <div className="filters-actions">
            <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Rule</button>
          </div>
        </div>

        {loading ? <window.StatePanel type="loading" message="Loading rules…" /> : (
          Object.keys(grouped).length === 0
            ? <window.StatePanel type="empty" message="No rules found." />
            : Object.entries(grouped).map(([cat, catRules]) => (
              <div key={cat} className="card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
                <div className="card-head" style={{ padding: '12px 18px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                  <strong style={{ fontSize: 13 }}>{cat}</strong>
                  <span className="badge badge-gray">{catRules.length}</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Title</th>
                        <th>Article</th>
                        <th>Severity</th>
                        <th>Default Action</th>
                        <th>Status</th>
                        <th style={{ width: 100 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {catRules.map(r => (
                        <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                          <td><code style={{ fontSize: 12, fontWeight: 700 }}>{r.rule_code}</code></td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{r.title}</div>
                            {r.description && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{r.description}</div>}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>{r.article_reference || '—'}</td>
                          <td>{severityBadge(r.severity)}</td>
                          <td style={{ fontSize: 12, color: 'var(--mid)', maxWidth: 200 }}>{r.default_action || '—'}</td>
                          <td>{r.active ? <span className="badge badge-green">Active</span> : <span className="badge badge-gray">Archived</span>}</td>
                          <td>
                            <div className="table-row-actions">
                              <button className="btn btn-secondary btn-sm" onClick={() => openEdit(r)}>Edit</button>
                              <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(r)}>{r.active ? 'Archive' : 'Restore'}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
        )}

        {modal && (
          <div className="modal-overlay" onClick={() => setModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-title">{modal.mode === 'add' ? 'Add Disciplinary Rule' : 'Edit Rule'}</div>
              <form onSubmit={handleSave}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Rule Code *</label>
                    <input value={form.rule_code} onChange={e => setForm(f => ({ ...f, rule_code: e.target.value }))} placeholder="e.g. GC-04" disabled={modal.mode === 'edit'} />
                    {errors.rule_code && <span style={{ color: 'var(--red)', fontSize: 12 }}>{errors.rule_code}</span>}
                  </div>
                  <div className="form-group">
                    <label>Severity *</label>
                    <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                      {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </div>
                  <div className="form-group span2">
                    <label>Title *</label>
                    <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Rule title" />
                    {errors.title && <span style={{ color: 'var(--red)', fontSize: 12 }}>{errors.title}</span>}
                  </div>
                  <div className="form-group">
                    <label>Category *</label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Article Reference</label>
                    <input value={form.article_reference} onChange={e => setForm(f => ({ ...f, article_reference: e.target.value }))} placeholder="e.g. Art. 1.4" />
                  </div>
                  <div className="form-group span2">
                    <label>Description</label>
                    <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description of what constitutes this violation" style={{ resize: 'vertical' }} />
                  </div>
                  <div className="form-group span2">
                    <label>Default Action</label>
                    <input value={form.default_action} onChange={e => setForm(f => ({ ...f, default_action: e.target.value }))} placeholder="e.g. Verbal warning, parental notification" />
                  </div>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Rule'}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  function ImportRulesTab() {
    const { showToast } = useContext(window.ToastContext);
    const [csvText, setCsvText] = useState(SAMPLE_RULES_CSV);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    const runImport = async () => {
      if (!csvText.trim()) {
        showToast('Paste CSV content first.', 'error');
        return;
      }
      setBusy(true);
      try {
        const summary = await api('/api/discipline/rules/import-csv', { method: 'POST', body: { csv: csvText } });
        setResult(summary);
        showToast('CSV import completed.', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        setBusy(false);
      }
    };

    const downloadSample = () => {
      const blob = new Blob([SAMPLE_RULES_CSV], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'disciplinary-rules-sample.csv';
      a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <strong>Import disciplinary rules (CSV)</strong>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
              Headers must match exactly: rule_code,title,category,article_reference,severity,default_action,description,active
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={downloadSample}>Download Sample CSV</button>
        </div>

        <textarea
          rows={12}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={runImport} disabled={busy}>{busy ? 'Importing…' : 'Import CSV'}</button>
          <button className="btn btn-secondary" onClick={() => setCsvText(SAMPLE_RULES_CSV)}>Reset to Sample</button>
        </div>

        {result && (
          <div style={{ marginTop: 8 }}>
            <div className="inline-stats">
              <span>Inserted: <strong style={{ color: 'var(--green)' }}>{result.inserted}</strong></span>
              <span>Updated: <strong>{result.updated}</strong></span>
              <span>Skipped: <strong>{result.skipped}</strong></span>
              <span>Errors: <strong style={{ color: 'var(--red)' }}>{result.errors}</strong></span>
            </div>
            {result.row_errors?.length > 0 && (
              <div style={{ marginTop: 10, maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                {result.row_errors.map((row, idx) => (
                  <div key={idx} style={{ marginBottom: 8 }}>
                    <strong>Row {row.row}</strong>
                    <ul style={{ marginTop: 2 }}>
                      {row.errors.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Violations ───────────────────────────────────────────────────────────────

  const REC_EMPTY = {
    student_id: '', rule_id: '', incident_date: new Date().toISOString().slice(0, 10),
    location: '', details: '', action_taken: '', warning_level: '', parent_guardian_notified: false, attachment_url: '',
  };

  function ViolationsTab({ user }) {
    const { showToast } = useContext(window.ToastContext);
    const [records, setRecords]   = useState([]);
    const [rules, setRules]       = useState([]);
    const [students, setStudents] = useState([]);
    const [loading, setLoading]   = useState(true);
    const [filter, setFilter]     = useState({ status: '', severity: '', search: '' });
    const [addModal, setAddModal] = useState(false);
    const [detailModal, setDetailModal] = useState(null);
    const [form, setForm]   = useState(REC_EMPTY);
    const [errors, setErrors] = useState({});
    const [busy, setBusy]   = useState(false);

    const load = useCallback(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filter.status)   params.set('status', filter.status);
        if (filter.severity) params.set('severity', filter.severity);
        if (filter.search)   params.set('search', filter.search);
        const [recs, ruleList, stuList] = await Promise.all([
          api(`/api/discipline/records?${params}`),
          api('/api/discipline/rules?active=1'),
          api('/api/students'),
        ]);
        setRecords(recs);
        setRules(ruleList);
        setStudents(stuList);
      } catch (e) { showToast(e.message, 'error'); }
      finally { setLoading(false); }
    }, [filter]);

    useEffect(() => { load(); }, [load]);

    const openAdd = () => { setForm(REC_EMPTY); setErrors({}); setAddModal(true); };

    const handleAdd = async (e) => {
      e.preventDefault();
      const errs = window.validateFields([
        { field: 'student_id',   check: () => window.FormValidator.required(form.student_id, 'Student') },
        { field: 'rule_id',      check: () => window.FormValidator.required(form.rule_id, 'Rule') },
        { field: 'incident_date',check: () => window.FormValidator.required(form.incident_date, 'Incident Date') },
      ]);
      if (Object.keys(errs).length) { setErrors(errs); return; }
      setBusy(true);
      try {
        await api('/api/discipline/records', { method: 'POST', body: { ...form, parent_guardian_notified: form.parent_guardian_notified ? 1 : 0 } });
        showToast('Violation recorded.', 'success');
        setAddModal(false);
        load();
      } catch (e) { showToast(e.message, 'error'); }
      finally { setBusy(false); }
    };

    const handleStatusUpdate = async (rec, newStatus) => {
      try {
        const updated = await api(`/api/discipline/records/${rec.id}`, { method: 'PUT', body: { status: newStatus } });
        setDetailModal(updated);
        showToast('Status updated.', 'success');
        load();
      } catch (e) { showToast(e.message, 'error'); }
    };

    const selectedRule = rules.find(r => String(r.id) === String(form.rule_id));

    return (
      <div>
        <div className="filters" style={{ marginBottom: 16 }}>
          <div className="filters-main">
            <input
              className="students-search"
              placeholder="Search student or rule…"
              value={filter.search}
              onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            />
            <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} style={{ width: 140 }}>
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <select value={filter.severity} onChange={e => setFilter(f => ({ ...f, severity: e.target.value }))} style={{ width: 140 }}>
              <option value="">All severities</option>
              {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="filters-actions">
            <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Violation</button>
          </div>
        </div>

        {loading ? <window.StatePanel type="loading" message="Loading violations…" /> : (
          records.length === 0
            ? <window.StatePanel type="empty" message="No violations found." />
            : (
              <div className="card table-card">
                <div className="table-scroll table-scroll-wide">
                  <table>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Rule</th>
                        <th>Category</th>
                        <th>Date</th>
                        <th>Severity</th>
                        <th>Status</th>
                        <th>Acknowledged</th>
                        <th style={{ width: 80 }}>View</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map(r => (
                        <tr key={r.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{r.student_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.student_level}</div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{r.rule_title}</div>
                            <code style={{ fontSize: 11, color: 'var(--muted)' }}>{r.rule_code}</code>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--mid)' }}>{r.rule_category}</td>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDate(r.incident_date)}</td>
                          <td>{severityBadge(r.severity_at_time)}</td>
                          <td>{statusBadge(r.status)}</td>
                          <td style={{ fontSize: 12 }}>
                            {r.student_acknowledged_at
                              ? <span style={{ color: 'var(--green)' }}>✓ {fmtDate(r.student_acknowledged_at)}</span>
                              : <span style={{ color: 'var(--muted)' }}>Pending</span>}
                          </td>
                          <td>
                            <button className="btn btn-secondary btn-sm" onClick={() => setDetailModal(r)}>View</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
        )}

        {/* Add Violation Modal */}
        {addModal && (
          <div className="modal-overlay" onClick={() => setAddModal(false)}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
              <div className="modal-title">Record Disciplinary Violation</div>
              <form onSubmit={handleAdd}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Student *</label>
                    <select value={form.student_id} onChange={e => setForm(f => ({ ...f, student_id: e.target.value }))}>
                      <option value="">Select student…</option>
                      {students.filter(s => s.status === 'active').map(s => (
                        <option key={s.id} value={s.id}>{s.name} — {s.level}</option>
                      ))}
                    </select>
                    {errors.student_id && <span style={{ color: 'var(--red)', fontSize: 12 }}>{errors.student_id}</span>}
                  </div>
                  <div className="form-group">
                    <label>Incident Date *</label>
                    <input type="date" value={form.incident_date} onChange={e => setForm(f => ({ ...f, incident_date: e.target.value }))} />
                    {errors.incident_date && <span style={{ color: 'var(--red)', fontSize: 12 }}>{errors.incident_date}</span>}
                  </div>
                  <div className="form-group span2">
                    <label>Rule Violated *</label>
                    <select value={form.rule_id} onChange={e => setForm(f => ({ ...f, rule_id: e.target.value }))}>
                      <option value="">Select rule…</option>
                      {CATEGORIES.map(cat => {
                        const catRules = rules.filter(r => r.category === cat);
                        if (!catRules.length) return null;
                        return (
                          <optgroup key={cat} label={cat}>
                            {catRules.map(r => (
                              <option key={r.id} value={r.id}>[{r.rule_code}] {r.title} ({r.severity})</option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                    {errors.rule_id && <span style={{ color: 'var(--red)', fontSize: 12 }}>{errors.rule_id}</span>}
                  </div>
                  {selectedRule && (
                    <div className="form-group span2">
                      <div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--mid)' }}>
                        <strong>{selectedRule.rule_code}</strong> · {selectedRule.category} · {severityBadge(selectedRule.severity)}
                        {selectedRule.description && <div style={{ marginTop: 4 }}>{selectedRule.description}</div>}
                        {selectedRule.default_action && <div style={{ marginTop: 4 }}><strong>Default action:</strong> {selectedRule.default_action}</div>}
                      </div>
                    </div>
                  )}
                  <div className="form-group span2">
                    <label>Location</label>
                    <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Dormitory, Classroom B2" />
                  </div>
                  <div className="form-group span2">
                    <label>Incident Details</label>
                    <textarea rows={3} value={form.details} onChange={e => setForm(f => ({ ...f, details: e.target.value }))} placeholder="Describe what happened…" style={{ resize: 'vertical' }} />
                  </div>
                  <div className="form-group span2">
                    <label>Action Taken</label>
                    <input value={form.action_taken} onChange={e => setForm(f => ({ ...f, action_taken: e.target.value }))} placeholder={selectedRule?.default_action || 'e.g. Verbal warning issued'} />
                  </div>
                  <div className="form-group span2">
                    <label>Attachment URL/Path</label>
                    <input value={form.attachment_url} onChange={e => setForm(f => ({ ...f, attachment_url: e.target.value }))} placeholder="https://... or /path/to/file" />
                  </div>
                  <div className="form-group">
                    <label>Warning Level (number)</label>
                    <input type="number" min="1" value={form.warning_level} onChange={e => setForm(f => ({ ...f, warning_level: e.target.value }))} placeholder="1, 2, 3…" />
                  </div>
                  <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 24 }}>
                      <input type="checkbox" checked={form.parent_guardian_notified} onChange={e => setForm(f => ({ ...f, parent_guardian_notified: e.target.checked }))} style={{ width: 'auto' }} />
                      Parent / guardian notified
                    </label>
                  </div>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setAddModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Record Violation'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Detail / Status Modal */}
        {detailModal && (
          <div className="modal-overlay" onClick={() => setDetailModal(null)}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
              <div className="modal-title">Violation Detail</div>
              <div style={{ display: 'grid', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><label>Student</label><strong>{detailModal.student_name}</strong> <span style={{ color: 'var(--muted)', fontSize: 12 }}>{detailModal.student_level}</span></div>
                  <div><label>Incident Date</label><strong>{fmtDate(detailModal.incident_date)}</strong></div>
                  <div><label>Rule</label><strong>[{detailModal.rule_code}] {detailModal.rule_title}</strong></div>
                  <div><label>Category</label>{detailModal.rule_category}</div>
                  <div><label>Severity at Time</label>{severityBadge(detailModal.severity_at_time)}</div>
                  <div><label>Current Status</label>{statusBadge(detailModal.status)}</div>
                  {detailModal.location && <div><label>Location</label>{detailModal.location}</div>}
                  {detailModal.reported_by_name && <div><label>Reported By</label>{detailModal.reported_by_name}</div>}
                  {detailModal.warning_level && <div><label>Warning Level</label>#{detailModal.warning_level}</div>}
                  <div><label>Parent Notified</label>{detailModal.parent_guardian_notified ? <span style={{ color: 'var(--green)' }}>Yes</span> : <span style={{ color: 'var(--muted)' }}>No</span>}</div>
                </div>
                {detailModal.details && (
                  <div><label>Incident Details</label><div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>{detailModal.details}</div></div>
                )}
                {detailModal.action_taken && (
                  <div><label>Action Taken</label><div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>{detailModal.action_taken}</div></div>
                )}
                {detailModal.attachment && (
                  <div><label>Attachment</label><div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>{detailModal.attachment}</div></div>
                )}
                <div>
                  <label>Student Acknowledgement</label>
                  {detailModal.student_acknowledged_at
                    ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>Acknowledged on {fmtDate(detailModal.student_acknowledged_at)}</span>
                    : <span style={{ color: 'var(--muted)' }}>Not yet acknowledged</span>}
                </div>

                <div>
                  <label>Update Status</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    {STATUSES.filter(s => s !== detailModal.status).map(s => (
                      <button
                        key={s}
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleStatusUpdate(detailModal, s)}
                      >
                        → {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setDetailModal(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Main Discipline Component ─────────────────────────────────────────────────

  window.Discipline = function Discipline({ user }) {
    const [tab, setTab] = useState('violations');

    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
          {[
            { id: 'violations', label: 'Violations' },
            { id: 'rules',      label: 'Rules Management' },
            { id: 'import',     label: 'Import CSV' },
          ].map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding: '9px 18px',
                fontWeight: 700,
                fontSize: 13.5,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: tab === t.id ? 'var(--brand-dark)' : 'var(--muted)',
                borderBottom: tab === t.id ? '2px solid var(--brand)' : '2px solid transparent',
                marginBottom: -2,
                transition: 'color .15s, border-color .15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'violations' && <ViolationsTab user={user} />}
        {tab === 'rules' && <RulesTab />}
        {tab === 'import' && <ImportRulesTab />}
      </div>
    );
  };
})();
