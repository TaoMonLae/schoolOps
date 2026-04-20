// ── Discipline Module — Student Portal ────────────────────────────────────────

(function () {
  const { useState, useEffect, useCallback, useContext } = React;
  const fmtDate = (d) => d ? d.slice(0, 10) : '—';

  function severityBadge(sev) {
    const map = { minor: 'badge-blue', moderate: 'badge-amber', serious: 'badge-red' };
    return <span className={`badge ${map[sev] || 'badge-gray'}`}>{sev}</span>;
  }
  function statusBadge(s) {
    const map = { pending: 'badge-gray', reviewed: 'badge-blue', confirmed: 'badge-amber', resolved: 'badge-green', appealed: 'badge-red' };
    return <span className={`badge ${map[s] || 'badge-gray'}`}>{s}</span>;
  }

  window.StudentDiscipline = function StudentDiscipline({ setPage }) {
    const { showToast } = useContext(window.ToastContext);
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(null);
    const [ackBusy, setAckBusy] = useState(false);

    const load = useCallback(async () => {
      setLoading(true);
      try {
        const data = await api('/api/discipline/me/records');
        setRecords(data);
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleAcknowledge = async (rec) => {
      setAckBusy(true);
      try {
        const result = await api(`/api/discipline/records/${rec.id}/acknowledge`, { method: 'POST', body: {} });
        showToast('Acknowledged. Thank you.', 'success');
        // update inline so the UI reflects immediately
        setSelected(prev => prev ? { ...prev, student_acknowledged_at: result.acknowledged_at } : null);
        setRecords(prev => prev.map(r => r.id === rec.id ? { ...r, student_acknowledged_at: result.acknowledged_at } : r));
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        setAckBusy(false);
      }
    };

    const unacknowledgedCount = records.filter(r => !r.student_acknowledged_at).length;
    const pendingCount = records.filter(r => ['pending', 'reviewed', 'appealed'].includes(r.status)).length;
    const openRelatedRule = (rec) => {
      if (typeof setPage === 'function') setPage('student_rules');
      window.dispatchEvent(new CustomEvent('student-rules:focus', {
        detail: { ruleCode: rec.rule_code, category: rec.rule_category },
      }));
    };

    return (
      <div className="student-dashboard">
        <div className="inline-stats" style={{ marginBottom: 14 }}>
          <span>Total violations: <strong>{records.length}</strong></span>
          <span>Active / pending: <strong>{pendingCount}</strong></span>
          <span>Awaiting acknowledgement: <strong style={{ color: 'var(--red)' }}>{unacknowledgedCount}</strong></span>
        </div>

        {unacknowledgedCount > 0 && (
          <div style={{
            background: 'var(--red-light)', border: '1px solid var(--red)',
            borderRadius: 10, padding: '12px 16px', marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div>
              <strong style={{ color: 'var(--red)' }}>
                {unacknowledgedCount} violation{unacknowledgedCount > 1 ? 's' : ''} require{unacknowledgedCount === 1 ? 's' : ''} your acknowledgement.
              </strong>
              <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 2 }}>
                Tap a record below and click "I have read this" to acknowledge.
              </div>
            </div>
          </div>
        )}

        {loading ? <window.StatePanel type="loading" message="Loading your disciplinary records…" /> : (
          records.length === 0
            ? (
              <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <strong style={{ fontSize: 16 }}>No disciplinary records</strong>
                <div style={{ color: 'var(--muted)', marginTop: 6, fontSize: 13 }}>
                  You have a clean disciplinary record. Keep it up!
                </div>
              </div>
            )
            : (
              <div style={{ display: 'grid', gap: 12 }}>
                {records.map(r => (
                  <div
                    key={r.id}
                    className="card"
                    style={{
                      cursor: 'pointer',
                      border: !r.student_acknowledged_at
                        ? '1.5px solid var(--red)'
                        : '1px solid var(--border)',
                      transition: 'box-shadow .15s, border-color .15s',
                    }}
                    onClick={() => setSelected(r)}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          {severityBadge(r.severity_at_time)}
                          {statusBadge(r.status)}
                          {!r.student_acknowledged_at && (
                            <span className="badge badge-red" style={{ animation: 'none' }}>Unread</span>
                          )}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{r.rule_title}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          <code style={{ fontSize: 11 }}>{r.rule_code}</code> · {r.rule_category}
                          {r.article_reference && ` · ${r.article_reference}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, fontSize: 13, color: 'var(--muted)' }}>
                        <div>{fmtDate(r.incident_date)}</div>
                        {r.student_acknowledged_at && (
                          <div style={{ color: 'var(--green)', fontSize: 12, marginTop: 4 }}>✓ Acknowledged</div>
                        )}
                      </div>
                    </div>
                    {r.details && (
                      <div style={{ marginTop: 10, fontSize: 13, color: 'var(--mid)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        {r.details.length > 120 ? r.details.slice(0, 120) + '…' : r.details}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
        )}

        {/* Detail modal */}
        {selected && (
          <div className="modal-overlay" onClick={() => setSelected(null)}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
              <div className="modal-title">Disciplinary Record</div>

              <div style={{ display: 'grid', gap: 14 }}>
                {/* Rule info */}
                <div style={{
                  padding: '12px 14px', background: 'var(--bg)',
                  border: '1px solid var(--border)', borderRadius: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    {severityBadge(selected.severity_at_time)}
                    <code style={{ fontSize: 12, fontWeight: 700 }}>{selected.rule_code}</code>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selected.rule_category}</span>
                    {selected.article_reference && (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selected.article_reference}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{selected.rule_title}</div>
                  {selected.rule_description && (
                    <div style={{ fontSize: 13, color: 'var(--mid)', marginTop: 6 }}>{selected.rule_description}</div>
                  )}
                </div>

                {/* Incident details */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label>Incident Date</label>
                    <strong>{fmtDate(selected.incident_date)}</strong>
                  </div>
                  <div>
                    <label>Status</label>
                    {statusBadge(selected.status)}
                  </div>
                  {selected.location && (
                    <div>
                      <label>Location</label>
                      {selected.location}
                    </div>
                  )}
                  {selected.reported_by_name && (
                    <div>
                      <label>Reported By</label>
                      {selected.reported_by_name}
                    </div>
                  )}
                  {selected.warning_level && (
                    <div>
                      <label>Warning Level</label>
                      <strong>#{selected.warning_level}</strong>
                    </div>
                  )}
                  <div>
                    <label>Parent/Guardian Notified</label>
                    {selected.parent_guardian_notified
                      ? <span style={{ color: 'var(--green)' }}>Yes</span>
                      : <span style={{ color: 'var(--muted)' }}>No</span>}
                  </div>
                </div>

                {selected.details && (
                  <div>
                    <label>Incident Details</label>
                    <div style={{
                      padding: '10px 12px', background: 'var(--bg)',
                      border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
                    }}>
                      {selected.details}
                    </div>
                  </div>
                )}

                {selected.action_taken && (
                  <div>
                    <label>Action Taken</label>
                    <div style={{
                      padding: '10px 12px', background: 'var(--amber-light)',
                      border: '1px solid rgba(240,185,11,.3)', borderRadius: 8, fontSize: 13,
                    }}>
                      {selected.action_taken}
                    </div>
                  </div>
                )}

                {/* Acknowledgement */}
                <div style={{
                  padding: '14px 16px',
                  background: selected.student_acknowledged_at ? 'var(--green-light)' : 'var(--red-light)',
                  border: `1px solid ${selected.student_acknowledged_at ? 'rgba(14,203,129,.25)' : 'rgba(246,70,93,.25)'}`,
                  borderRadius: 10,
                }}>
                  {selected.student_acknowledged_at ? (
                    <div style={{ color: 'var(--green)', fontWeight: 600, fontSize: 13 }}>
                      ✓ You acknowledged this record on {fmtDate(selected.student_acknowledged_at)}.
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 8, fontSize: 13 }}>
                        This record requires your acknowledgement.
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 12 }}>
                        By clicking the button below you confirm that you have read and understood this disciplinary record.
                        Acknowledging does not mean you agree with it — it only confirms you have received and read it.
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleAcknowledge(selected)}
                        disabled={ackBusy}
                      >
                        {ackBusy ? 'Processing…' : 'I have read this'}
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => openRelatedRule(selected)}
                  >
                    Read related rule
                  </button>
                  <div style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
                    Compare this violation against the full School Rules.
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setSelected(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };
})();
