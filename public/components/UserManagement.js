window.UserManagement = function UserManagement() {
  const { showToast } = React.useContext(window.ToastContext);
  const [users, setUsers] = React.useState([]);
  const [studentOptions, setStudentOptions] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [resetting, setResetting] = React.useState(null);
  const [retiring, setRetiring] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState('all');

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    try {
      const rows = await window.api('/api/users');
      setUsers(rows);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadStudentOptions = React.useCallback(async () => {
    try {
      const rows = await window.api('/api/users/student-options');
      setStudentOptions(rows || []);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [showToast]);

  React.useEffect(() => {
    loadUsers();
    loadStudentOptions();
  }, [loadUsers, loadStudentOptions]);

  const refreshAll = async () => {
    await Promise.all([loadUsers(), loadStudentOptions()]);
  };

  const onQuickToggle = async (user, field, value) => {
    try {
      await window.api(`/api/users/${user.id}`, {
        method: 'PUT',
        body: { [field]: value },
      });
      showToast('User updated');
      refreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const onRetire = async (user, reason) => {
    try {
      await window.api(`/api/users/${user.id}/retire`, {
        method: 'POST',
        body: { reason },
      });
      showToast('User retired safely. History is preserved.');
      refreshAll();
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  };

  const filteredUsers = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (q) {
        const haystack = [
          u.name,
          u.username,
          u.role,
          u.linked_student_name,
          u.linked_student_level,
          u.linked_student_label,
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      switch (filter) {
        case 'admin': return u.role === 'admin';
        case 'teacher': return u.role === 'teacher';
        case 'student': return u.role === 'student';
        case 'active': return !!u.is_active && !u.is_retired;
        case 'login_disabled': return !!u.login_disabled || !!u.is_retired;
        case 'password_change_required': return !!u.must_change_password;
        default: return true;
      }
    });
  }, [users, search, filter]);

  const FILTERS = [
    ['all', 'All'],
    ['admin', 'Admin'],
    ['teacher', 'Teacher'],
    ['student', 'Student'],
    ['active', 'Active'],
    ['login_disabled', 'Login disabled'],
    ['password_change_required', 'Password change required'],
  ];

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>User Management</div>
          <small style={{ color: 'var(--muted)' }}>Manage account status, linked student profiles, and password safety.</small>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create User</button>
      </div>

      <window.FilterBar actions={<span className="filters-total">{filteredUsers.length} user(s)</span>}>
        <input
          placeholder="Search name, username, role, or linked student..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              className={`btn btn-sm ${filter === key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </window.FilterBar>

      {loading ? (
        <window.StatePanel type="loading" message="Loading users..." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Linked profile</th>
                <th>Account status</th>
                <th>Login state</th>
                <th>Password state</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.name}</div>
                    <small style={{ color: 'var(--muted)' }}>{u.created_at ? `Created ${u.created_at}` : ''}</small>
                  </td>
                  <td><code>{u.username}</code></td>
                  <td><RoleBadge role={u.role} /></td>
                  <td>
                    {u.linked_student_id ? (
                      <div>
                        <div style={{ fontWeight: 600 }}>Linked to: {u.linked_student_name}</div>
                        <small style={{ color: 'var(--muted)' }}>Student #{u.linked_student_id}{u.linked_student_level ? ` • ${u.linked_student_level}` : ''}</small>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>No linked profile</span>
                    )}
                  </td>
                  <td>{renderAccountBadge(u)}</td>
                  <td>{u.login_disabled || u.is_retired ? <span className="badge badge-red">Login disabled</span> : <span className="badge badge-green">Login enabled</span>}</td>
                  <td>{u.must_change_password ? <span className="badge badge-amber">Temporary password</span> : <span className="badge badge-green">Password OK</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditing(u)}>Edit</button>
                      <button className="btn btn-amber btn-sm" onClick={() => setResetting(u)} disabled={!!u.is_retired}>Reset Password</button>
                      <details>
                        <summary className="btn btn-secondary btn-sm" style={{ listStyle: 'none', cursor: 'pointer' }}>More ▾</summary>
                        <div style={{ marginTop: 6, display: 'grid', gap: 6, minWidth: 170 }}>
                          <button className="btn btn-secondary btn-sm" disabled={!!u.is_retired} onClick={() => onQuickToggle(u, 'is_active', u.is_active ? 0 : 1)}>
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button className="btn btn-secondary btn-sm" disabled={!!u.is_retired} onClick={() => onQuickToggle(u, 'login_disabled', u.login_disabled ? 0 : 1)}>
                            {u.login_disabled ? 'Enable login' : 'Disable login'}
                          </button>
                          {u.linked_student_id && u.role === 'student' ? (
                            <button className="btn btn-secondary btn-sm" disabled={!!u.is_retired} onClick={() => onQuickToggle(u, 'student_id', null)}>Unlink student profile</button>
                          ) : null}
                          <button className="btn btn-danger btn-sm" disabled={!!u.is_retired} onClick={() => setRetiring(u)}>Retire User</button>
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredUsers.length ? (
                <tr><td colSpan="8"><window.StatePanel compact type="empty" message="No users match the current search/filter." /></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <UserCreateModal
          students={studentOptions}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refreshAll(); }}
        />
      )}

      {editing && (
        <UserEditModal
          user={editing}
          students={studentOptions}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshAll(); }}
        />
      )}

      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => { setResetting(null); refreshAll(); }}
        />
      )}

      {retiring && (
        <RetireUserModal
          user={retiring}
          onConfirm={async (reason) => {
            await onRetire(retiring, reason);
            setRetiring(null);
          }}
          onClose={() => setRetiring(null)}
        />
      )}
    </div>
  );
};

function RoleBadge({ role }) {
  const cls = role === 'admin' ? 'badge-red' : role === 'teacher' ? 'badge-blue' : 'badge-green';
  const label = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Unknown';
  return <span className={`badge ${cls}`}>{label}</span>;
}

function renderAccountBadge(user) {
  if (user.is_retired) return <span className="badge badge-gray">Retired</span>;
  return user.is_active ? <span className="badge badge-green">Active</span> : <span className="badge badge-amber">Inactive</span>;
}

function StudentLinkField({ value, onChange, students, currentUserId }) {
  const [search, setSearch] = React.useState('');
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (students || []).filter((s) => {
      if (s.linked_user_id && s.linked_user_id !== currentUserId) return false;
      if (!q) return true;
      return `${s.name} ${s.level || ''}`.toLowerCase().includes(q);
    });
  }, [students, search, currentUserId]);

  return (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label>Linked student profile</label>
      <input
        placeholder="Search student profile..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 6 }}
      />
      <select value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Select student profile</option>
        {filtered.map((s) => (
          <option key={s.id} value={s.id}>
            {s.display_label}{s.linked_user_id && s.linked_user_id === currentUserId ? ' (currently linked)' : ''}
          </option>
        ))}
      </select>
      <small style={{ color: 'var(--muted)' }}>One student profile can only be linked to one user account.</small>
    </div>
  );
}

function UserCreateModal({ students, onClose, onSaved }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [form, setForm] = React.useState({
    name: '',
    username: '',
    role: 'teacher',
    password: '',
    confirm_password: '',
    student_id: null,
    is_active: true,
    login_disabled: false,
    must_change_password: true,
  });
  const [errors, setErrors] = React.useState({});
  const [busy, setBusy] = React.useState(false);

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Name is required';
    if (!form.username.trim()) next.username = 'Username is required';
    if (!form.password) next.password = 'Initial password is required';
    if (form.password && form.password.length < 8) next.password = 'Password must be at least 8 characters';
    if (form.password !== form.confirm_password) next.confirm_password = 'Passwords do not match';
    if (form.role === 'student' && !form.student_id) next.student_id = 'Student role requires linked student profile';
    return next;
  };

  const save = async () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      await window.api('/api/users', { method: 'POST', body: form });
      showToast('User created');
      onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <window.Modal title="Create User" onClose={onClose}>
      <div className="form-grid">
        <div className="form-group">
          <label>Name</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          {errors.name ? <small style={{ color: 'var(--danger)' }}>{errors.name}</small> : null}
        </div>

        <div className="form-group">
          <label>Username</label>
          <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/\s+/g, '.') }))} />
          {errors.username ? <small style={{ color: 'var(--danger)' }}>{errors.username}</small> : <small style={{ color: 'var(--muted)' }}>Hint: use lowercase letters and dots.</small>}
        </div>

        <div className="form-group">
          <label>Role</label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, student_id: e.target.value === 'student' ? f.student_id : null }))}>
            <option value="admin">Admin</option>
            <option value="teacher">Teacher</option>
            <option value="student">Student</option>
          </select>
        </div>

        <div className="form-group">
          <label>Initial Password</label>
          <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          {errors.password ? <small style={{ color: 'var(--danger)' }}>{errors.password}</small> : null}
        </div>

        <div className="form-group">
          <label>Confirm Password</label>
          <input type="password" value={form.confirm_password} onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))} />
          {errors.confirm_password ? <small style={{ color: 'var(--danger)' }}>{errors.confirm_password}</small> : null}
        </div>

        {form.role === 'student' ? (
          <>
            <StudentLinkField value={form.student_id} onChange={(value) => setForm(f => ({ ...f, student_id: value }))} students={students} currentUserId={null} />
            {errors.student_id ? <small style={{ color: 'var(--danger)', gridColumn: '1 / -1' }}>{errors.student_id}</small> : null}
          </>
        ) : null}

        <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} /> Account active</label>
        <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.login_disabled} onChange={e => setForm(f => ({ ...f, login_disabled: e.target.checked }))} /> Disable login</label>
        <label style={{ gridColumn: '1 / -1' }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.must_change_password} onChange={e => setForm(f => ({ ...f, must_change_password: e.target.checked }))} /> Require password change at first login</label>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Create'}</button>
      </div>
    </window.Modal>
  );
}

function UserEditModal({ user, students, onClose, onSaved }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [form, setForm] = React.useState({
    name: user.name,
    username: user.username,
    role: user.role,
    student_id: user.linked_student_id || null,
    is_active: !!user.is_active,
    login_disabled: !!user.login_disabled,
  });
  const [errors, setErrors] = React.useState({});
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = 'Name is required';
    if (!form.username.trim()) nextErrors.username = 'Username is required';
    if (form.role === 'student' && !form.student_id) nextErrors.student_id = 'Student role requires linked student profile';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      await window.api(`/api/users/${user.id}`, { method: 'PUT', body: form });
      showToast('User updated');
      onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <window.Modal title={`Edit User: ${user.username}`} onClose={onClose}>
      <div className="form-grid">
        <div className="form-group"><label>Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />{errors.name ? <small style={{ color: 'var(--danger)' }}>{errors.name}</small> : null}</div>
        <div className="form-group"><label>Username</label><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />{errors.username ? <small style={{ color: 'var(--danger)' }}>{errors.username}</small> : null}</div>
        <div className="form-group"><label>Role</label><select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, student_id: e.target.value === 'student' ? f.student_id : null }))}><option value="admin">Admin</option><option value="teacher">Teacher</option><option value="student">Student</option></select></div>
        <div className="form-group">
          <label>Current profile link</label>
          <div style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, minHeight: 38, display: 'flex', alignItems: 'center' }}>
            {user.linked_student_id ? `Student #${user.linked_student_id}: ${user.linked_student_name}` : 'No linked profile'}
          </div>
        </div>

        {form.role === 'student' ? (
          <>
            <StudentLinkField value={form.student_id} onChange={(value) => setForm(f => ({ ...f, student_id: value }))} students={students} currentUserId={user.id} />
            {errors.student_id ? <small style={{ color: 'var(--danger)', gridColumn: '1 / -1' }}>{errors.student_id}</small> : null}
          </>
        ) : null}

        <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} /> Account active</label>
        <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.login_disabled} onChange={e => setForm(f => ({ ...f, login_disabled: e.target.checked }))} /> Disable login</label>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </window.Modal>
  );
}

function ResetPasswordModal({ user, onClose, onSaved }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [form, setForm] = React.useState({ new_password: '', confirm_password: '', temporary: true });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const save = async () => {
    if (form.new_password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (form.new_password !== form.confirm_password) {
      setError('Password and confirmation do not match');
      return;
    }

    setError('');
    setBusy(true);
    try {
      await window.api(`/api/users/${user.id}/reset-password`, { method: 'POST', body: form });
      showToast('Password reset complete');
      onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <window.Modal title={`Reset Password: ${user.username}`} onClose={onClose}>
      <div className="form-group">
        <label>New password</label>
        <input type="password" value={form.new_password} onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))} />
      </div>
      <div className="form-group">
        <label>Confirm password</label>
        <input type="password" value={form.confirm_password} onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))} />
      </div>
      {error ? <small style={{ color: 'var(--danger)' }}>{error}</small> : null}
      <label style={{ marginTop: 10, display: 'block' }}>
        <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.temporary} onChange={e => setForm(f => ({ ...f, temporary: e.target.checked }))} />
        Mark as temporary password (force change on next login)
      </label>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-amber" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Reset Password'}</button>
      </div>
    </window.Modal>
  );
}

function RetireUserModal({ user, onClose, onConfirm }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      showToast('Retirement reason is required', 'error');
      return;
    }

    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } catch {
      // toast already shown by caller
    } finally {
      setBusy(false);
    }
  };

  return (
    <window.Modal title={`Retire User: ${user.username}`} onClose={onClose}>
      <p style={{ marginTop: 0 }}>
        This will <strong>retire</strong> the account safely (no hard delete). Historical records and audit references remain intact.
      </p>
      <div className="form-group">
        <label>Reason</label>
        <textarea rows="3" value={reason} onChange={e => setReason(e.target.value)} placeholder="Example: Staff exited on good terms" />
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" disabled={busy} onClick={submit}>{busy ? 'Retiring...' : 'Confirm Retire'}</button>
      </div>
    </window.Modal>
  );
}
