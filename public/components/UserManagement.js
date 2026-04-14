window.UserManagement = function UserManagement() {
  const { showToast } = React.useContext(window.ToastContext);
  const [users, setUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [resetting, setResetting] = React.useState(null);

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

  React.useEffect(() => { loadUsers(); }, [loadUsers]);

  const onQuickToggle = async (user, field, value) => {
    try {
      await window.api(`/api/users/${user.id}`, {
        method: 'PUT',
        body: { [field]: value },
      });
      showToast('User updated');
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>User Management</div>
          <small style={{ color: 'var(--muted)' }}>Create users, manage access, and reset passwords.</small>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create User</button>
      </div>

      {loading ? (
        <div className="empty"><div className="icon">⏳</div>Loading users...</div>
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Login</th>
              <th>Password</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td><code>{u.username}</code></td>
                <td><span style={{ textTransform: 'capitalize' }}>{u.role}</span></td>
                <td>{u.is_active ? <window.StatusBadge status="active" /> : <window.StatusBadge status="inactive" />}</td>
                <td>{u.login_disabled ? <window.StatusBadge status="flagged" /> : <window.StatusBadge status="approved" />}</td>
                <td>{u.must_change_password ? <window.StatusBadge status="overdue" /> : <window.StatusBadge status="current" />}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(u)}>Edit</button>
                    <button className="btn btn-amber btn-sm" onClick={() => setResetting(u)}>Reset Password</button>
                    {u.is_active ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => onQuickToggle(u, 'is_active', 0)}>Deactivate</button>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => onQuickToggle(u, 'is_active', 1)}>Activate</button>
                    )}
                    {u.login_disabled ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => onQuickToggle(u, 'login_disabled', 0)}>Enable Login</button>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => onQuickToggle(u, 'login_disabled', 1)}>Disable Login</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {showCreate && (
        <UserCreateModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); loadUsers(); }}
        />
      )}

      {editing && (
        <UserEditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadUsers(); }}
        />
      )}

      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => { setResetting(null); loadUsers(); }}
        />
      )}
    </div>
  );
};

function UserCreateModal({ onClose, onSaved }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [form, setForm] = React.useState({
    name: '', username: '', role: 'teacher', password: '', is_active: true, login_disabled: false, must_change_password: true,
  });
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
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
        <div className="form-group"><label>Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div className="form-group"><label>Username</label><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} /></div>
        <div className="form-group"><label>Role</label><select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}><option value="admin">Admin</option><option value="teacher">Teacher</option><option value="student">Student</option></select></div>
        <div className="form-group"><label>Initial Password</label><input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></div>
        <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} /> Account Active</label>
        <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.login_disabled} onChange={e => setForm(f => ({ ...f, login_disabled: e.target.checked }))} /> Disable Login</label>
        <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.must_change_password} onChange={e => setForm(f => ({ ...f, must_change_password: e.target.checked }))} /> Require password change at first login</label>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Create'}</button>
      </div>
    </window.Modal>
  );
}

function UserEditModal({ user, onClose, onSaved }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [form, setForm] = React.useState({
    name: user.name,
    username: user.username,
    role: user.role,
    is_active: !!user.is_active,
    login_disabled: !!user.login_disabled,
  });
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
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
        <div className="form-group"><label>Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div className="form-group"><label>Username</label><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} /></div>
        <div className="form-group"><label>Role</label><select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}><option value="admin">Admin</option><option value="teacher">Teacher</option><option value="student">Student</option></select></div>
        <div></div>
        <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} /> Account Active</label>
        <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.login_disabled} onChange={e => setForm(f => ({ ...f, login_disabled: e.target.checked }))} /> Disable Login</label>
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
  const [form, setForm] = React.useState({ new_password: '', temporary: true });
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
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
        <label>New temporary password</label>
        <input type="password" value={form.new_password} onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))} />
      </div>
      <label style={{ marginTop: 10, display: 'block' }}>
        <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.temporary} onChange={e => setForm(f => ({ ...f, temporary: e.target.checked }))} />
        Force user to change password on next login
      </label>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-amber" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Reset Password'}</button>
      </div>
    </window.Modal>
  );
}
