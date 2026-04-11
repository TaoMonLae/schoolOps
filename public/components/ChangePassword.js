window.ChangePassword = function ChangePassword({ onPasswordChanged, forceMode = false }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [form, setForm] = React.useState({ current_password: '', new_password: '', confirm_password: '' });
  const [busy, setBusy] = React.useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await window.api('/api/auth/change-password', { method: 'POST', body: form });
      showToast('Password updated successfully');
      setForm({ current_password: '', new_password: '', confirm_password: '' });
      if (onPasswordChanged) onPasswordChanged();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-title">{forceMode ? 'Change Temporary Password' : 'Change Password'}</div>
      {forceMode && (
        <div style={{ marginBottom: 12, padding: 10, background: 'var(--amber-light)', color: '#8a4d0f', borderRadius: 6 }}>
          You must change your temporary password before using other pages.
        </div>
      )}
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="form-group span2">
            <label>Current Password</label>
            <input type="password" value={form.current_password} onChange={e => setForm(f => ({ ...f, current_password: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" minLength={6} value={form.new_password} onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input type="password" minLength={6} value={form.confirm_password} onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))} required />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Update Password'}</button>
        </div>
      </form>
    </div>
  );
};
