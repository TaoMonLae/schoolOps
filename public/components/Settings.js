window.Settings = function Settings({ mode = 'settings', onSaved }) {
  const { showToast } = React.useContext(window.ToastContext);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [runningBackup, setRunningBackup] = React.useState(false);
  const [form, setForm] = React.useState({
    school_name: '',
    subtitle: '',
    report_footer_text: '',
    currency: 'RM',
    contact_block: '',
    logo_url: '',
    theme: 'classic',
  });
  const [status, setStatus] = React.useState(null);
  const [backupInfo, setBackupInfo] = React.useState(null);
  const [uploadingLogo, setUploadingLogo] = React.useState(false);
  const fileRef = React.useRef(null);

  const loadSettings = React.useCallback(async () => {
    const s = await api('/api/settings');
    setForm({
      school_name: s.school_name || '',
      subtitle: s.subtitle || '',
      report_footer_text: s.report_footer_text || '',
      currency: s.currency || 'RM',
      contact_block: s.contact_block || '',
      logo_url: s.logo_url || '',
      theme: s.theme || 'classic',
    });
  }, []);

  const loadHealth = React.useCallback(async () => {
    const [st, bi] = await Promise.all([
      api('/api/system/status'),
      api('/api/system/backup/instructions'),
    ]);
    setStatus(st);
    setBackupInfo(bi);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadSettings(), loadHealth()]);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [loadSettings, loadHealth, showToast]);

  React.useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/settings', { method: 'PUT', body: form });
      showToast('Settings saved');
      await loadHealth();
      if (onSaved) await onSaved();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const runCreateBackup = async () => {
    setRunningBackup(true);
    try {
      const result = await api('/api/system/backup/create', { method: 'POST' });
      showToast('Backup created');
      await loadHealth();
      if (onSaved) await onSaved();
      if (result?.backup_file) {
        showToast(`Saved to ${result.backup_file}`);
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setRunningBackup(false);
    }
  };

  const runDownloadBackup = async () => {
    try {
      await downloadFile('/api/system/backup/download', `ledger-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
      showToast('Database backup downloaded');
      await loadHealth();
      if (onSaved) await onSaved();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const updated = await apiFormData('/api/settings/logo', formData, { method: 'POST' });
      setForm((prev) => ({ ...prev, logo_url: updated.logo_url || '' }));
      showToast('Logo uploaded');
      if (onSaved) await onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    try {
      const updated = await api('/api/settings/logo', { method: 'DELETE' });
      setForm((prev) => ({ ...prev, logo_url: updated.logo_url || '' }));
      showToast('Logo removed');
      if (onSaved) await onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (loading) return <div className="card">Loading settings…</div>;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {mode === 'settings' && (
        <div className="card">
          <div className="card-title">Branding & System Settings</div>
          <div className="form-grid">
            <div className="form-group span2">
              <label>School Logo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{
                  width: 96,
                  height: 96,
                  borderRadius: 16,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  {form.logo_url ? (
                    <img src={form.logo_url} alt="School logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span style={{ fontSize: 38 }}>📚</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary" type="button" onClick={() => fileRef.current?.click()} disabled={uploadingLogo}>
                    {uploadingLogo ? 'Uploading…' : 'Upload Logo'}
                  </button>
                  {form.logo_url ? (
                    <button className="btn btn-secondary" type="button" onClick={removeLogo}>Remove Logo</button>
                  ) : null}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleLogoUpload}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                PNG, JPEG, or WEBP up to 2MB. The logo will appear on the login screen and sidebar.
              </div>
            </div>
            <div className="form-group span2">
              <label>School Name</label>
              <input value={form.school_name} onChange={(e) => setForm(f => ({ ...f, school_name: e.target.value }))} />
            </div>
            <div className="form-group span2">
              <label>Subtitle / Tagline</label>
              <input value={form.subtitle} onChange={(e) => setForm(f => ({ ...f, subtitle: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Theme</label>
              <select value={form.theme} onChange={(e) => setForm(f => ({ ...f, theme: e.target.value }))}>
                <option value="classic">Classic School</option>
                <option value="night_study">Night Study</option>
              </select>
            </div>
            <div className="form-group">
              <label>Currency Label</label>
              <input value={form.currency} onChange={(e) => setForm(f => ({ ...f, currency: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Report Footer Text</label>
              <input value={form.report_footer_text} onChange={(e) => setForm(f => ({ ...f, report_footer_text: e.target.value }))} />
            </div>
            <div className="form-group span2">
              <label>Contact / Address Block</label>
              <textarea rows="4" value={form.contact_block} onChange={(e) => setForm(f => ({ ...f, contact_block: e.target.value }))} />
            </div>
          </div>
          <div className="form-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Backup Tools</div>
        <div style={{ marginBottom: 10 }}><strong>Database path:</strong> <code>{status?.db_path}</code></div>
        <div style={{ marginBottom: 10 }}><strong>Backup directory:</strong> <code>{status?.backup_dir}</code></div>
        <div style={{ marginBottom: 10 }}><strong>Last backup:</strong> {status?.last_backup_at || 'Not tracked yet'}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={runDownloadBackup}>⬇️ Download DB Backup</button>
          <button className="btn btn-primary" onClick={runCreateBackup} disabled={runningBackup}>{runningBackup ? 'Creating…' : '🧷 Create Backup Now'}</button>
        </div>
        {backupInfo?.instructions?.length > 0 && (
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--mid)' }}>
            {backupInfo.instructions.map((line, idx) => <div key={idx}>{line}</div>)}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">System Health</div>
        <table>
          <tbody>
            <tr><td>App Version</td><td>{status?.app_version}</td></tr>
            <tr><td>Environment</td><td>{status?.environment}</td></tr>
            <tr><td>DB Path</td><td><code>{status?.db_path}</code></td></tr>
            <tr><td>Last Backup Time</td><td>{status?.last_backup_at || 'Not tracked'}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
