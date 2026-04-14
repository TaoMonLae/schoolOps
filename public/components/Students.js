window.Students = function Students({ user }) {
  const { showToast } = React.useContext(window.ToastContext);
  const isAdmin = user?.role === 'admin';
  const now = new Date();
  const [month, setMonth] = React.useState(now.getMonth() + 1);
  const [year,  setYear]  = React.useState(now.getFullYear());
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [modal, setModal] = React.useState(null);
  const [history, setHistory] = React.useState(null);
  const [contactsModal, setContactsModal] = React.useState(null);
  const [contacts, setContacts] = React.useState([]);
  const [contactForm, setContactForm] = React.useState(null);
  const [savingContact, setSavingContact] = React.useState(false);
  const [loginModalStudent, setLoginModalStudent] = React.useState(null);
  const [manageLoginStudent, setManageLoginStudent] = React.useState(null);
  const [loginForm, setLoginForm] = React.useState({ username: '', password: '', confirm_password: '', must_change_password: true });
  const [loginErrors, setLoginErrors] = React.useState({});
  const [creatingLogin, setCreatingLogin] = React.useState(false);
  const [resetForm, setResetForm] = React.useState({ new_password: '', temporary: true });
  const [resetErrors, setResetErrors] = React.useState({});
  const [resettingLogin, setResettingLogin] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [openMoreMenuId, setOpenMoreMenuId] = React.useState(null);
  const [moreMenuPosition, setMoreMenuPosition] = React.useState({ top: 0, left: 0, placement: 'down' });
  const [importing, setImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState(null);
  const [exporting, setExporting] = React.useState(false);
  const importFileRef = React.useRef(null);
  const moreMenuRef = React.useRef(null);
  const moreMenuTriggerRefs = React.useRef({});
  const PER = 15;

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/api/students?month=${month}&year=${year}`);
      setRows(data);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [month, year]);

  React.useEffect(() => { load(); }, [load]);

  const closeMoreMenu = React.useCallback(() => {
    setOpenMoreMenuId(null);
  }, []);

  const updateMoreMenuPosition = React.useCallback((rowId) => {
    const trigger = moreMenuTriggerRefs.current[rowId];
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuEl = moreMenuRef.current;
    const viewportPadding = 8;
    const gap = 6;
    const menuHeight = menuEl ? menuEl.offsetHeight : 220;
    const menuWidth = menuEl ? menuEl.offsetWidth : 180;
    const spaceBelow = window.innerHeight - rect.bottom;
    const canOpenDown = spaceBelow >= menuHeight + gap + viewportPadding;
    const placement = canOpenDown ? 'down' : 'up';
    const top = placement === 'down'
      ? rect.bottom + gap + window.scrollY
      : rect.top - menuHeight - gap + window.scrollY;
    const preferredLeft = rect.right - menuWidth + window.scrollX;
    const minLeft = window.scrollX + viewportPadding;
    const maxLeft = window.scrollX + window.innerWidth - menuWidth - viewportPadding;
    const left = Math.min(Math.max(preferredLeft, minLeft), Math.max(minLeft, maxLeft));
    setMoreMenuPosition({ top: Math.max(window.scrollY + viewportPadding, top), left, placement });
  }, []);

  const openMoreMenu = React.useCallback((rowId) => {
    setOpenMoreMenuId((current) => (current === rowId ? null : rowId));
  }, []);

  React.useEffect(() => {
    if (!openMoreMenuId) return;
    updateMoreMenuPosition(openMoreMenuId);
    const raf = window.requestAnimationFrame(() => updateMoreMenuPosition(openMoreMenuId));
    const handleViewportChange = () => updateMoreMenuPosition(openMoreMenuId);
    const handleDocMouseDown = (event) => {
      const menuEl = moreMenuRef.current;
      const triggerEl = moreMenuTriggerRefs.current[openMoreMenuId];
      if (menuEl?.contains(event.target) || triggerEl?.contains(event.target)) return;
      closeMoreMenu();
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') closeMoreMenu();
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    document.addEventListener('mousedown', handleDocMouseDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      document.removeEventListener('mousedown', handleDocMouseDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeMoreMenu, openMoreMenuId, updateMoreMenuPosition]);

  React.useEffect(() => {
    closeMoreMenu();
  }, [page, search, filter, month, year, rows, closeMoreMenu]);

  const years = [];
  for (let y = now.getFullYear(); y >= 2022; y--) years.push(y);

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    const name = (r?.name || '').toLowerCase();
    const level = (r?.level || '').toLowerCase();
    const mainContactName = (r?.main_contact_name || '').toLowerCase();
    const mainContactPhone = (r?.main_contact_phone || '').toLowerCase();
    const mainContactWhatsapp = (r?.main_contact_whatsapp || '').toLowerCase();
    const contactSearchBlob = (r?.contact_search_blob || '').toLowerCase();

    const matchSearch = !q
      || name.includes(q)
      || level.includes(q)
      || mainContactName.includes(q)
      || mainContactPhone.includes(q)
      || mainContactWhatsapp.includes(q)
      || contactSearchBlob.includes(q);

    const matchFilter = filter === 'all' || (r?.status || '') === filter;
    return matchSearch && matchFilter;
  });

  const paged = filtered.slice((page - 1) * PER, page * PER);

  const EMPTY = { name:'', gender:'male', level:'', enroll_date:'', fee_amount:'', fee_frequency:'monthly', status:'active', dorm_house:'', room:'', bed_number:'', hostel_status:'non_boarder', notes:'' };
  const EMPTY_CONTACT = { contact_name:'', relationship:'', contact_type:'parent', phone:'', whatsapp:'', address:'', emergency_contact:false, preferred_contact:false, is_active:true, notes:'' };
  const [form, setForm] = React.useState(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState({});
  const [contactErrors, setContactErrors] = React.useState({});

  const openAdd = () => { setForm(EMPTY); setErrors({}); setModal('add'); };
  const openEdit = (s) => { if (!isAdmin) return; setForm({ ...s, fee_amount: String(s.fee_amount) }); setErrors({}); setModal(s); };

  const handleSave = async (e) => {
    e.preventDefault();
    const nextErrors = window.validateFields([
      { field: 'name', check: () => window.FormValidator.required(form.name, 'Full Name') },
      { field: 'level', check: () => window.FormValidator.required(form.level, 'Level / Class') },
      { field: 'enroll_date', check: () => window.FormValidator.required(form.enroll_date, 'Enroll Date') },
      { field: 'fee_amount', check: () => window.FormValidator.nonNegativeNumber(form.fee_amount, 'Fee Amount') },
    ]);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      showToast('Please fix highlighted form fields', 'error');
      return;
    }
    setSaving(true);
    try {
      if (modal === 'add') {
        await api('/api/students', { method: 'POST', body: form });
        showToast('Student enrolled successfully');
      } else {
        await api(`/api/students/${modal.id}`, { method: 'PUT', body: form });
        showToast('Student updated');
      }
      setModal(null);
      load();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDeactivate = async (s) => {
    if (!isAdmin) return;
    if (!confirm2(`Deactivate ${s.name}?`)) return;
    try {
      await api(`/api/students/${s.id}`, { method: 'DELETE' });
      showToast(`${s.name} deactivated`);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handlePermanentDelete = async (s) => {
    if (!isAdmin) return;
    if (!confirm2(`Permanently delete "${s.name}"? This cannot be undone. All contacts and attendance records for this student will also be removed.`)) return;
    try {
      await api(`/api/students/${s.id}/permanent`, { method: 'DELETE' });
      showToast(`${s.name} permanently deleted`);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const suggestStudentUsername = (student) => {
    const base = String(student?.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 32);
    return `stu.${base || `student.${student.id}`}`.slice(0, 48);
  };

  const openCreateLoginModal = (student) => {
    if (!isAdmin || student?.user_id) return;
    setLoginErrors({});
    setLoginForm({
      username: suggestStudentUsername(student),
      password: '',
      confirm_password: '',
      must_change_password: true,
    });
    setLoginModalStudent(student);
  };

  const submitCreateLogin = async (e) => {
    e.preventDefault();
    if (!loginModalStudent || !isAdmin) return;
    const nextErrors = window.validateFields([
      { field: 'username', check: () => window.FormValidator.required(loginForm.username, 'Username') },
      { field: 'password', check: () => window.FormValidator.required(loginForm.password, 'Password') },
      {
        field: 'confirm_password',
        check: () => (loginForm.password === loginForm.confirm_password ? '' : 'Confirm password must match password'),
      },
    ]);
    setLoginErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      showToast('Please fix highlighted form fields', 'error');
      return;
    }

    setCreatingLogin(true);
    try {
      const result = await api(`/api/students/${loginModalStudent.id}/create-login`, {
        method: 'POST',
        body: {
          username: loginForm.username,
          password: loginForm.password,
          must_change_password: loginForm.must_change_password,
        },
      });
      showToast(`Student login account created successfully (${result.username})`);
      setLoginModalStudent(null);
      await load();
    } catch (e2) {
      showToast(e2.message, 'error');
    } finally {
      setCreatingLogin(false);
    }
  };

  const unlinkStudentLogin = async (s) => {
    if (!isAdmin || !s.user_id) return;
    if (!confirm2(`Unlink login account from ${s.name}?`)) return;
    try {
      await api(`/api/students/${s.id}/unlink-login`, { method: 'POST' });
      showToast('Student login unlinked');
      load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const openManageLogin = (s) => {
    if (!isAdmin || !s?.user_id) return;
    setResetErrors({});
    setResetForm({ new_password: '', temporary: true });
    setManageLoginStudent(s);
  };

  const submitResetLinkedLogin = async (e) => {
    e.preventDefault();
    if (!isAdmin || !manageLoginStudent?.user_id) return;
    const nextErrors = window.validateFields([
      { field: 'new_password', check: () => window.FormValidator.required(resetForm.new_password, 'New password') },
    ]);
    if (!nextErrors.new_password && resetForm.new_password.length < 8) {
      nextErrors.new_password = 'New password must be at least 8 characters';
    }
    setResetErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      showToast('Please fix highlighted form fields', 'error');
      return;
    }
    setResettingLogin(true);
    try {
      await api(`/api/users/${manageLoginStudent.user_id}/reset-password`, { method: 'POST', body: resetForm });
      showToast('Linked account password reset complete');
      setManageLoginStudent(null);
      await load();
    } catch (e2) {
      showToast(e2.message, 'error');
    } finally {
      setResettingLogin(false);
    }
  };

  const openHistory = async (s) => {
    try {
      const data = await api(`/api/fees/student/${s.id}`);
      setHistory({ student: s, payments: data });
    } catch (e) { showToast(e.message, 'error'); }
  };

  const openContacts = async (s) => {
    try {
      const data = await api(`/api/students/${s.id}/contacts`);
      setContacts(data);
      setContactsModal(s);
      setContactForm(null);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const startAddContact = () => { setContactErrors({}); setContactForm({ mode: 'add', data: { ...EMPTY_CONTACT } }); };
  const startEditContact = (c) => { setContactErrors({}); setContactForm({ mode: 'edit', data: { ...c } }); };

  const saveContact = async (e) => {
    e.preventDefault();
    if (!contactsModal || !isAdmin || !contactForm) return;
    const nextErrors = window.validateFields([
      { field: 'contact_name', check: () => window.FormValidator.required(contactForm.data.contact_name, 'Contact Name') },
    ]);
    setContactErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      showToast('Please fix highlighted form fields', 'error');
      return;
    }
    setSavingContact(true);
    try {
      if (contactForm.mode === 'add') {
        await api(`/api/students/${contactsModal.id}/contacts`, { method: 'POST', body: contactForm.data });
        showToast('Contact added');
      } else {
        await api(`/api/students/${contactsModal.id}/contacts/${contactForm.data.id}`, { method: 'PUT', body: contactForm.data });
        showToast('Contact updated');
      }
      const updated = await api(`/api/students/${contactsModal.id}/contacts`);
      setContacts(updated);
      setContactForm(null);
      load();
    } catch (e2) {
      showToast(e2.message, 'error');
    } finally {
      setSavingContact(false);
    }
  };

  const deactivateContact = async (contact) => {
    if (!contactsModal || !isAdmin) return;
    if (!confirm2(`Deactivate contact ${contact.contact_name}?`)) return;
    try {
      await api(`/api/students/${contactsModal.id}/contacts/${contact.id}`, { method: 'DELETE' });
      showToast('Contact deactivated');
      const updated = await api(`/api/students/${contactsModal.id}/contacts`);
      setContacts(updated);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  // ─── Excel import ────────────────────────────────────────────────────────────
  const handleImportClick = () => {
    if (importFileRef.current) importFileRef.current.click();
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!importFileRef.current) return;
    importFileRef.current.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/students/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Import failed');
      setImportResult(result);
      if (result.imported > 0) load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await window.downloadFile('/api/students/export/excel', `Students_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await window.downloadFile('/api/students/export/template', 'Student_Import_Template.xlsx');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const formatPhoneHref = (value) => (value || '').replace(/[^\d+]/g, '');

  return (
    <div>
      <window.FilterBar actions={isAdmin ? (
        <div className="action-group students-toolbar-actions">
          <button className="btn btn-secondary" onClick={handleDownloadTemplate} title="Download import template">Template</button>
          <button className="btn btn-secondary" onClick={handleImportClick} disabled={importing} title="Import students from Excel">
            {importing ? 'Importing…' : 'Import'}
          </button>
          <button className="btn btn-secondary" onClick={handleExport} disabled={exporting} title="Export students to Excel">
            {exporting ? 'Exporting…' : 'Export'}
          </button>
          <button className="btn btn-primary" onClick={openAdd}>+ Enroll Student</button>
          <input ref={importFileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={handleImportFile} />
        </div>
      ) : null}>
        <input className="students-search" placeholder="Search student/contact/phone…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>
          <option value="all">All Students</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select className="students-period-month" value={month} onChange={e => setMonth(+e.target.value)}>
          {window.MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
        </select>
        <select className="students-period-year" value={year} onChange={e => setYear(+e.target.value)}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </window.FilterBar>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <window.StatePanel type="loading" message="Loading students…" />
        ) : (
          <>
            <div className="table-scroll">
              <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Main Contact</th>
                  <th>Fee</th><th>Hostel</th><th>Status</th><th>Login</th>
                  <th>{window.MONTHS[month-1]} {year}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={8}><window.StatePanel type="empty"  message="No students found" compact /></td></tr>
                ) : paged.map(s => (
                  <tr key={s.id}>
                    <td>
                      <div className="student-identity">
                        <strong>{s.name}</strong>
                        <div className="student-identity-meta">
                          <span>{s.level || '—'}</span>
                          <span>•</span>
                          <span style={{ textTransform:'capitalize' }}>{s.gender || '—'}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {s.main_contact_name ? (
                        <div style={{ display:'grid', gap:4 }}>
                          <div style={{ fontWeight:600 }}>{s.main_contact_name}</div>
                          <div style={{ fontSize: 12, color:'var(--muted)' }}>{(s.main_contact_type || 'contact').replace('_', ' ')}</div>
                          <div style={{ fontSize:12 }}>{s.main_contact_phone || s.main_contact_whatsapp || '—'}</div>
                        </div>
                      ) : <span style={{ color:'var(--muted)' }}>—</span>}
                    </td>
                    <td>{fmtRM(s.fee_amount)}<span style={{ color:'var(--muted)', fontSize:11 }}>/{s.fee_frequency}</span></td>
                    <td><window.StatusBadge status={s.hostel_status || 'non_boarder'} /></td>
                    <td><window.StatusBadge status={s.status} /></td>
                    <td>
                      {s.user_id ? (
                        <div className="student-login-status">
                          <span className="badge badge-green">Linked</span>
                          <small>{s.linked_username || `user#${s.user_id}`}</small>
                        </div>
                      ) : (
                        <div className="student-login-status">
                          <span className="badge badge-gray">No account</span>
                        </div>
                      )}
                    </td>
                    <td>
                      {s.status !== 'active'
                        ? <span className="badge badge-gray">N/A</span>
                        : <window.StatusBadge status={s.current_month_status} />
                      }
                    </td>
                    <td>
                      <div className="action-group student-row-actions">
                        {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>Edit</button>}
                        {isAdmin && s.status === 'active' && (
                          <button
                            className={`btn btn-sm ${s.user_id ? 'btn-secondary' : 'btn-primary'}`}
                            onClick={() => (s.user_id ? openManageLogin(s) : openCreateLoginModal(s))}
                            title={s.user_id ? 'Manage linked account' : 'Create linked account'}
                          >
                            {s.user_id ? 'Manage Account' : 'Create Account'}
                          </button>
                        )}
                        <div className="row-more-menu">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            ref={(el) => { moreMenuTriggerRefs.current[s.id] = el; }}
                            onClick={() => openMoreMenu(s.id)}
                            aria-haspopup="menu"
                            aria-expanded={openMoreMenuId === s.id}
                          >
                            More
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <window.Pagination page={page} total={filtered.length} perPage={PER} onChange={setPage} />
            </div>
          </>
        )}
      </div>

      <div className="inline-stats students-inline-stats">
        <span>Total: <strong>{filtered.length}</strong></span>
        <span>Active: <strong>{filtered.filter(r=>r.status==='active').length}</strong></span>
        <span>Paid this month: <strong style={{ color:'var(--green)' }}>{filtered.filter(r=>r.current_month_status==='paid').length}</strong></span>
        <span>Unpaid: <strong style={{ color:'var(--red)' }}>{filtered.filter(r=>r.status==='active'&&r.current_month_status==='unpaid').length}</strong></span>
      </div>

      {modal && (
        <window.Modal title={modal === 'add' ? 'Enroll New Student' : `Edit — ${modal.name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSave}>
            <div className="form-grid">
              <div className="form-group span2">
                <label>Full Name *</label>
                <input required value={form.name} onChange={e => setForm(f=>({...f, name:e.target.value}))} placeholder="Student full name" />
                {errors.name ? <small style={{ color:'var(--red)' }}>{errors.name}</small> : null}
              </div>
              <div className="form-group">
                <label>Gender *</label>
                <select required value={form.gender} onChange={e => setForm(f=>({...f, gender:e.target.value}))}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div className="form-group">
                <label>Level / Class *</label>
                <input required value={form.level} onChange={e => setForm(f=>({...f, level:e.target.value}))} placeholder="e.g. Tahfiz 1" />
                {errors.level ? <small style={{ color:'var(--red)' }}>{errors.level}</small> : null}
              </div>
              <div className="form-group">
                <label>Enroll Date *</label>
                <input type="date" required value={form.enroll_date} onChange={e => setForm(f=>({...f, enroll_date:e.target.value}))} />
                {errors.enroll_date ? <small style={{ color:'var(--red)' }}>{errors.enroll_date}</small> : null}
              </div>
              <div className="form-group">
                <label>Fee Amount (RM) *</label>
                <input type="number" min="0" step="0.01" required value={form.fee_amount} onChange={e => setForm(f=>({...f, fee_amount:e.target.value}))} placeholder="200" />
                {errors.fee_amount ? <small style={{ color:'var(--red)' }}>{errors.fee_amount}</small> : null}
              </div>
              <div className="form-group">
                <label>Fee Frequency</label>
                <select value={form.fee_frequency} onChange={e => setForm(f=>({...f, fee_frequency:e.target.value}))}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="one-time">One-time</option>
                </select>
              </div>
              {modal !== 'add' && (
              <>
              <div className="form-group">
                <label>Hostel Status</label>
                <select value={form.hostel_status || 'non_boarder'} onChange={e => setForm(f=>({...f, hostel_status:e.target.value}))}>
                  <option value="non_boarder">Non-boarder</option>
                  <option value="boarder">Boarder</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="form-group">
                <label>Dorm / House</label>
                <input value={form.dorm_house || ''} onChange={e => setForm(f=>({...f, dorm_house:e.target.value}))} placeholder="e.g. House A" />
              </div>
              <div className="form-group">
                <label>Room</label>
                <input value={form.room || ''} onChange={e => setForm(f=>({...f, room:e.target.value}))} placeholder="e.g. 2B" />
              </div>
              <div className="form-group">
                <label>Bed Number (optional)</label>
                <input value={form.bed_number || ''} onChange={e => setForm(f=>({...f, bed_number:e.target.value}))} placeholder="e.g. 12" />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={e => setForm(f=>({...f, status:e.target.value}))}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div className="form-group span2">
                  <label>Linked Login Account</label>
                  <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                    {modal.user_id ? (
                      <>
                        <span className="badge badge-green">Linked</span>
                        <small style={{ color:'var(--muted)' }}>{modal.linked_username || `user#${modal.user_id}`}</small>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openManageLogin(modal)}>Manage Account</button>
                      </>
                    ) : (
                      <>
                        <span className="badge badge-gray">Not linked</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCreateLoginModal(modal)}>Create Account</button>
                      </>
                    )}
                  </div>
                </div>
              </>
              )}
              <div className="form-group span2">
                <label>Notes</label>
                <textarea rows={2} value={form.notes || ''} onChange={e => setForm(f=>({...f, notes:e.target.value}))} placeholder="Optional notes…" />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </window.Modal>
      )}

      {loginModalStudent && (
        <window.Modal title="Create Student Login" onClose={() => setLoginModalStudent(null)}>
          <form onSubmit={submitCreateLogin}>
            <div className="account-student-summary">
              <div className="account-student-summary-name">{loginModalStudent.name}</div>
              <div className="account-student-summary-meta">
                <span>{loginModalStudent.level || '—'}</span>
                <span>•</span>
                <window.StatusBadge status={loginModalStudent.status} />
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group span2">
                <label>Username *</label>
                <input value={loginForm.username} onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))} placeholder="Username" />
                <small style={{ color:'var(--muted)' }}>Use a unique username for the student login account.</small>
                {loginErrors.username ? <small style={{ color:'var(--red)' }}>{loginErrors.username}</small> : null}
              </div>
              <div className="form-group">
                <label>Password *</label>
                <input type="password" value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} placeholder="At least 8 characters" />
                {loginErrors.password ? <small style={{ color:'var(--red)' }}>{loginErrors.password}</small> : null}
              </div>
              <div className="form-group">
                <label>Confirm Password *</label>
                <input type="password" value={loginForm.confirm_password} onChange={e => setLoginForm(f => ({ ...f, confirm_password: e.target.value }))} />
                {loginErrors.confirm_password ? <small style={{ color:'var(--red)' }}>{loginErrors.confirm_password}</small> : null}
              </div>
              <div className="form-group span2">
                <label>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', marginRight: 6 }}
                    checked={loginForm.must_change_password}
                    onChange={e => setLoginForm(f => ({ ...f, must_change_password: e.target.checked }))}
                  />
                  Force password change on first login
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setLoginModalStudent(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creatingLogin}>{creatingLogin ? 'Creating…' : 'Create Account'}</button>
            </div>
          </form>
        </window.Modal>
      )}

      {manageLoginStudent && (
        <window.Modal title="Manage Linked Account" onClose={() => setManageLoginStudent(null)}>
          <div className="account-student-summary">
            <div className="account-student-summary-name">{manageLoginStudent.name}</div>
            <div className="account-student-summary-meta">
              <span>{manageLoginStudent.level || '—'}</span>
              <span>•</span>
              <window.StatusBadge status={manageLoginStudent.status} />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Account Status</label>
              <input value="Linked" disabled readOnly />
            </div>
            <div className="form-group">
              <label>Username</label>
              <input value={manageLoginStudent.linked_username || `user#${manageLoginStudent.user_id}`} disabled readOnly />
            </div>
          </div>
          <form onSubmit={submitResetLinkedLogin} style={{ marginTop: 10, borderTop:'1px solid var(--border)', paddingTop: 10 }}>
            <div className="form-grid">
              <div className="form-group span2">
                <label>Reset Password</label>
                <input type="password" value={resetForm.new_password} onChange={e => setResetForm(f => ({ ...f, new_password: e.target.value }))} placeholder="At least 8 characters" />
                {resetErrors.new_password ? <small style={{ color:'var(--red)' }}>{resetErrors.new_password}</small> : null}
              </div>
              <div className="form-group span2">
                <label>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', marginRight: 6 }}
                    checked={resetForm.temporary}
                    onChange={e => setResetForm(f => ({ ...f, temporary: e.target.checked }))}
                  />
                  Force password change on next login
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-danger" onClick={() => unlinkStudentLogin(manageLoginStudent)}>Unlink Account</button>
              <button type="button" className="btn btn-secondary" onClick={() => setManageLoginStudent(null)}>Close</button>
              <button type="submit" className="btn btn-amber" disabled={resettingLogin}>{resettingLogin ? 'Saving…' : 'Reset Password'}</button>
            </div>
          </form>
        </window.Modal>
      )}

      {contactsModal && (
        <window.Modal title={`Contacts — ${contactsModal.name}`} onClose={() => setContactsModal(null)} size="lg">
          <div className="action-group contacts-modal-head" style={{ marginBottom: 12 }}>
            <div style={{ color:'var(--muted)', fontSize: 12 }}>Teachers can view contacts. Only admins can edit.</div>
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={startAddContact}>+ Add Contact</button>}
          </div>

          {contacts.length === 0 ? (
            <div className="empty"><div className="icon"></div>No contacts yet</div>
          ) : (
            <div className="table-scroll">
              <table>
              <thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>Flags</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.contact_name}</div>
                      <div style={{ fontSize: 12, color:'var(--muted)' }}>{c.relationship || '—'}</div>
                    </td>
                    <td style={{ textTransform:'capitalize' }}>{(c.contact_type || '').replace('_', ' ')}</td>
                    <td>
                      <div>{c.phone || '—'}</div>
                      {c.whatsapp && (
                        <a href={`https://wa.me/${formatPhoneHref(c.whatsapp)}`} target="_blank" rel="noreferrer" style={{ fontSize:12 }}>WhatsApp</a>
                      )}
                    </td>
                    <td>{c.preferred_contact ? 'Preferred ' : ''}{c.emergency_contact ? 'Emergency:  Emergency' : '—'}</td>
                    <td><window.StatusBadge status={c.is_active ? 'active' : 'inactive'} /></td>
                    <td>
                      <div className="action-group student-row-actions">
                        {c.phone && <a className="btn btn-secondary btn-sm" href={`tel:${formatPhoneHref(c.phone)}`}></a>}
                        {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => startEditContact(c)}>Edit️</button>}
                        {isAdmin && c.is_active && <button className="btn btn-danger btn-sm" onClick={() => deactivateContact(c)}>⊘</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}

          {contactForm && isAdmin && (
            <form onSubmit={saveContact} style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div className="form-grid">
                <div className="form-group span2"><label>Contact Name *</label><input required value={contactForm.data.contact_name || ''} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, contact_name: e.target.value } }))} />{contactErrors.contact_name ? <small style={{ color:'var(--red)' }}>{contactErrors.contact_name}</small> : null}</div>
                <div className="form-group"><label>Contact Type</label><select value={contactForm.data.contact_type || 'parent'} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, contact_type: e.target.value } }))}><option value="parent">Parent</option><option value="guardian">Guardian</option><option value="emergency_contact">Emergency Contact</option><option value="sponsor_other">Sponsor / Other</option></select></div>
                <div className="form-group"><label>Relationship</label><input value={contactForm.data.relationship || ''} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, relationship: e.target.value } }))} /></div>
                <div className="form-group"><label>Phone</label><input value={contactForm.data.phone || ''} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, phone: e.target.value } }))} /></div>
                <div className="form-group"><label>WhatsApp</label><input value={contactForm.data.whatsapp || ''} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, whatsapp: e.target.value } }))} /></div>
                <div className="form-group span2"><label>Address</label><textarea rows={2} value={contactForm.data.address || ''} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, address: e.target.value } }))} /></div>
                <div className="form-group span2"><label>Notes</label><textarea rows={2} value={contactForm.data.notes || ''} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, notes: e.target.value } }))} /></div>
                <div className="form-group"><label><input type="checkbox" checked={!!contactForm.data.preferred_contact} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, preferred_contact: e.target.checked } }))} /> Preferred contact</label></div>
                <div className="form-group"><label><input type="checkbox" checked={!!contactForm.data.emergency_contact} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, emergency_contact: e.target.checked } }))} /> Emergency contact</label></div>
                <div className="form-group"><label><input type="checkbox" checked={!!contactForm.data.is_active} onChange={e => setContactForm(f => ({ ...f, data: { ...f.data, is_active: e.target.checked } }))} /> Active</label></div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setContactForm(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingContact}>{savingContact ? 'Saving…' : 'Save Contact'}</button>
              </div>
            </form>
          )}
        </window.Modal>
      )}

      {history && (
        <window.Modal title={`Fee History — ${history.student.name}`} onClose={() => setHistory(null)} size="lg">
          {history.payments.length === 0 ? (
            <div className="empty"><div className="icon"></div>No payment records</div>
          ) : (
            <div className="table-scroll">
              <table>
              <thead><tr><th>Period</th><th>Amount</th><th>Date</th><th>Method</th><th>Received By</th></tr></thead>
              <tbody>
                {history.payments.map(p => (
                  <tr key={p.id}>
                    <td>{window.MONTHS[p.period_month-1]} {p.period_year}</td>
                    <td style={{ fontWeight:600 }}>{fmtRM(p.amount)}</td>
                    <td>{p.paid_date}</td>
                    <td><window.StatusBadge status={p.method} /></td>
                    <td>{p.received_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}
        </window.Modal>
      )}

      {openMoreMenuId && window.ReactDOM?.createPortal(
        <div
          ref={moreMenuRef}
          className="row-more-menu-panel row-more-menu-panel-portal"
          style={{ top: moreMenuPosition.top, left: moreMenuPosition.left }}
          data-placement={moreMenuPosition.placement}
          role="menu"
        >
          {(() => {
            const s = paged.find((row) => row.id === openMoreMenuId);
            if (!s) return null;
            return (
              <>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { closeMoreMenu(); openContacts(s); }}>Contacts</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { closeMoreMenu(); openHistory(s); }}>Fee History</button>
                {isAdmin && s.user_id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { closeMoreMenu(); unlinkStudentLogin(s); }}>Unlink Account</button>}
                {isAdmin && s.status === 'active' && <button type="button" className="btn btn-danger btn-sm" onClick={() => { closeMoreMenu(); handleDeactivate(s); }}>Deactivate Student</button>}
                {isAdmin && s.status === 'inactive' && <button type="button" className="btn btn-danger btn-sm" onClick={() => { closeMoreMenu(); handlePermanentDelete(s); }}>Delete Permanently</button>}
              </>
            );
          })()}
        </div>,
        document.body
      )}

      {importResult && (
        <window.Modal title="Import Results" onClose={() => setImportResult(null)}>
          <div className="inline-stats" style={{ marginBottom:16 }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:28, fontWeight:700, color:'var(--green)' }}>{importResult.imported}</div>
              <div style={{ fontSize:12, color:'var(--muted)' }}>Imported</div>
            </div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:28, fontWeight:700, color:'var(--red)' }}>{importResult.skipped}</div>
              <div style={{ fontSize:12, color:'var(--muted)' }}>Skipped</div>
            </div>
          </div>

          {importResult.errors.length > 0 && (
            <div>
              <div style={{ fontWeight:600, marginBottom:8, color:'var(--red)' }}>Row errors ({importResult.errors.length}):</div>
              <div style={{ maxHeight:280, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 }}>
                {importResult.errors.map((e, i) => (
                  <div key={i} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:6, padding:'8px 12px' }}>
                    <div style={{ fontWeight:600, fontSize:13 }}>Row {e.row}: {e.name}</div>
                    <ul style={{ margin:'4px 0 0 16px', padding:0, fontSize:12, color:'var(--red)' }}>
                      {e.errors.map((err, j) => <li key={j}>{err}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importResult.imported === 0 && importResult.errors.length === 0 && (
            <div style={{ color:'var(--muted)', textAlign:'center', padding:16 }}>No data rows found in the file.</div>
          )}

          <div style={{ marginTop:16, padding:'10px 12px', background:'var(--surface)', borderRadius:6, fontSize:12, color:'var(--muted)' }}>
            <strong>Tip:</strong> Download the <button className="btn btn-secondary btn-sm" style={{ marginLeft:6 }} onClick={() => { setImportResult(null); handleDownloadTemplate(); }}>Template</button> to see the correct column format.
          </div>

          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setImportResult(null)}>Done</button>
          </div>
        </window.Modal>
      )}
    </div>
  );
};
