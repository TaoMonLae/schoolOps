window.StudentCouncil = function StudentCouncil({ user }) {
  const { useEffect, useMemo, useState, useContext } = React;
  const { showToast } = useContext(window.ToastContext);

  const [context, setContext] = useState(null);
  const [overview, setOverview] = useState({ members: [], issueSummary: [], openActionItems: 0, upcomingMeeting: null });
  const [assignments, setAssignments] = useState([]);
  const [issues, setIssues] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [resourceLogs, setResourceLogs] = useState([]);
  const [funds, setFunds] = useState({ ledger: [], summary: {} });
  const [students, setStudents] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  const [assignmentForm, setAssignmentForm] = useState({ student_id: '', council_role: 'president', start_date: window.todayLocalISO(), end_date: '', active: true });
  const [issueForm, setIssueForm] = useState({ type: 'hostel_concern', title: '', description: '', assigned_role: '', due_date: '', priority: 'medium', linked_rule_category: '' });
  const [meetingForm, setMeetingForm] = useState({ meeting_number: '', meeting_date: window.todayLocalISO(), location: '', chairperson_role: '', discussion_notes: '', agenda_text: '', action_text: '', next_meeting_date: '' });
  const [rosterForm, setRosterForm] = useState({ roster_type: 'cleaning', week_start: window.todayLocalISO(), week_end: window.todayLocalISO(), duty_group: '', status: 'planned', notes: '', assignments_text: '' });
  const [resourceForm, setResourceForm] = useState({ item_name: '', log_type: 'inventory_check', student_id: '', quantity: '', condition_status: '', notes: '', log_date: window.todayLocalISO() });
  const [fundForm, setFundForm] = useState({ entry_type: 'collection', amount: '', description: '', entry_date: window.todayLocalISO(), supporting_ref: '' });

  const isManager = !!context?.isManager;
  const isCouncilMember = !!context?.isCouncilMember;
  const canManage = isManager || isCouncilMember;

  const roleTabs = useMemo(() => {
    const base = [{ key: 'overview', label: 'Student Council Overview' }];
    if (!canManage) return base;
    return base.concat([
      { key: 'my_role', label: 'My Council Role' },
      { key: 'members', label: 'Council Members' },
      { key: 'issues', label: 'Council Issues' },
      { key: 'meetings', label: 'Meeting Records' },
      { key: 'rosters', label: 'Duty Rosters' },
      { key: 'resources', label: 'Resource Logs' },
      { key: 'funds', label: 'Council Funds' },
    ]);
  }, [canManage]);

  async function loadData() {
    setLoading(true);
    try {
      const [ctx, ov] = await Promise.all([
        api('/api/student-council/context'),
        api('/api/student-council/overview'),
      ]);
      setContext(ctx);
      setOverview(ov);

      if (ctx.isManager) {
        const studentRows = await api('/api/students?limit=300');
        setStudents(Array.isArray(studentRows) ? studentRows : []);
      }

      if (ctx.isManager || ctx.isCouncilMember) {
        const tasks = [
          api('/api/student-council/assignments').then(setAssignments),
          api('/api/student-council/issues').then(setIssues),
          api('/api/student-council/meetings').then(setMeetings),
          api('/api/student-council/duty-rosters').then(setRosters),
          api('/api/student-council/resource-logs').then(setResourceLogs),
        ];
        if (ctx.isManager || ctx.councilRole === 'treasurer') {
          tasks.push(api('/api/student-council/funds').then(setFunds));
        }
        await Promise.all(tasks);
      }
    } catch (err) {
      showToast(err.message || 'Failed to load student council data', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  async function submitAssignment(e) {
    e.preventDefault();
    try {
      await api('/api/student-council/assignments', { method: 'POST', body: assignmentForm });
      showToast('Council assignment saved');
      setAssignmentForm({ ...assignmentForm, student_id: '' });
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function submitIssue(e) {
    e.preventDefault();
    try {
      await api('/api/student-council/issues', { method: 'POST', body: issueForm });
      showToast('Issue logged');
      setIssueForm({ ...issueForm, title: '', description: '' });
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function updateIssueStatus(id, status) {
    try {
      await api(`/api/student-council/issues/${id}`, { method: 'PATCH', body: { status } });
      showToast('Issue updated');
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function submitMeeting(e) {
    e.preventDefault();
    try {
      const body = {
        ...meetingForm,
        agenda_items: meetingForm.agenda_text.split('\n').map((v) => v.trim()).filter(Boolean),
        action_items: meetingForm.action_text.split('\n').map((v) => v.trim()).filter(Boolean),
      };
      await api('/api/student-council/meetings', { method: 'POST', body });
      showToast('Meeting record saved');
      setMeetingForm({ ...meetingForm, meeting_number: '', discussion_notes: '', agenda_text: '', action_text: '' });
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function submitRoster(e) {
    e.preventDefault();
    try {
      const body = {
        ...rosterForm,
        assignments: rosterForm.assignments_text.split('\n').map((v) => v.trim()).filter(Boolean),
      };
      await api('/api/student-council/duty-rosters', { method: 'POST', body });
      showToast('Duty roster created');
      setRosterForm({ ...rosterForm, duty_group: '', notes: '', assignments_text: '' });
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function updateRosterStatus(id, status) {
    try {
      await api(`/api/student-council/duty-rosters/${id}`, {
        method: 'PATCH',
        body: { status, create_issue_on_miss: status === 'missed' },
      });
      showToast('Roster status updated');
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function submitResourceLog(e) {
    e.preventDefault();
    try {
      await api('/api/student-council/resource-logs', { method: 'POST', body: resourceForm });
      showToast('Resource log saved');
      setResourceForm({ ...resourceForm, item_name: '', quantity: '', notes: '' });
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function submitFund(e) {
    e.preventDefault();
    try {
      await api('/api/student-council/funds', { method: 'POST', body: { ...fundForm, amount: Number(fundForm.amount || 0) } });
      showToast('Fund ledger entry added');
      setFundForm({ ...fundForm, amount: '', description: '', supporting_ref: '' });
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  }

  if (loading) return <window.StatePanel type="loading" message="Loading Student Council module..." />;

  return (
    <div className="stack-lg">
      <div className="section-card">
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div>
            <div className="section-title">Student Council Operations</div>
            <div className="muted" style={{ marginTop:6 }}>Role-based tools for student affairs, meetings, hostel workflows, resources, and council funds.</div>
          </div>
          <div>
            <span className="badge badge-blue" style={{ marginRight:8 }}>{context?.roleLabel || 'No active council role'}</span>
            <span className={`badge ${canManage ? 'badge-green' : 'badge-gray'}`}>{canManage ? 'Management Access' : 'Read-only'}</span>
          </div>
        </div>
        <div style={{ marginTop:14, display:'flex', gap:8, flexWrap:'wrap' }}>
          {roleTabs.map((tab) => (
            <button key={tab.key} className={`btn btn-sm ${activeTab === tab.key ? '' : 'btn-secondary'}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="grid cols-2">
          <div className="section-card">
            <div className="section-title">Council Members</div>
            <div style={{ marginTop:10, display:'grid', gap:8 }}>
              {overview.members.length ? overview.members.map((m) => (
                <div key={m.id} className="tile" style={{ padding:8 }}>
                  <strong>{m.student_name}</strong>
                  <div className="muted">{(m.council_role || '').replaceAll('_', ' ')}</div>
                </div>
              )) : <window.StatePanel type="empty" compact message="No active members assigned." />}
            </div>
          </div>
          <div className="section-card">
            <div className="section-title">Operational Snapshot</div>
            <div className="kpi-grid" style={{ marginTop:12 }}>
              {(overview.issueSummary || []).map((s) => (
                <div className="kpi-card" key={s.status}><div className="kpi-label">{s.status}</div><div className="kpi-value">{s.count}</div></div>
              ))}
              <div className="kpi-card"><div className="kpi-label">Open action items</div><div className="kpi-value">{overview.openActionItems || 0}</div></div>
            </div>
            <div style={{ marginTop:14 }}>
              <div className="muted">Upcoming meeting</div>
              {overview.upcomingMeeting ? (
                <div><strong>#{overview.upcomingMeeting.meeting_number}</strong> on {overview.upcomingMeeting.meeting_date} at {overview.upcomingMeeting.location || 'TBD'}</div>
              ) : <div className="muted">No upcoming meeting scheduled.</div>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'my_role' && canManage && (
        <div className="section-card">
          <div className="section-title">My Council Role Dashboard</div>
          <ul style={{ marginTop:12, paddingLeft:18 }}>
            {context?.councilRole === 'president' && <><li>View all council members and unresolved concerns.</li><li>Track escalated hostel/resource issues and meeting action items.</li></>}
            {context?.councilRole === 'vice_president' && <><li>Supervise hostel monitor escalations.</li><li>Follow up orientation and hostel welfare tasks.</li></>}
            {context?.councilRole === 'secretary' && <><li>Maintain meeting minutes, attendance and announcements.</li><li>Oversee records for resource operations.</li></>}
            {context?.councilRole === 'treasurer' && <><li>Maintain collections/expenses ledger and supporting records.</li></>}
            {context?.councilRole === 'boys_hostel_monitor' && <><li>Log boys hostel concerns, curfew and safety walkthroughs.</li><li>Manage weekly duty assignments for male students.</li></>}
            {context?.councilRole === 'girls_hostel_monitor' && <><li>Log girls hostel and kitchen/dining concerns.</li><li>Manage weekly duty assignments for female students.</li></>}
            {context?.councilRole === 'resource_monitor' && <><li>Track resource sign-outs, damaged/missing items and inventory checks.</li></>}
            {['cleaning_duty_leader', 'cooking_duty_leader'].includes(context?.councilRole) && <><li>Maintain weekly duty rosters and missed-duty follow-up.</li></>}
            {!context?.councilRole && <li>You are viewing read-only Student Council overview.</li>}
          </ul>
        </div>
      )}

      {activeTab === 'members' && canManage && (
        <div className="grid cols-2">
          <div className="section-card">
            <div className="section-title">Council Members</div>
            <table className="table" style={{ marginTop:10 }}>
              <thead><tr><th>Name</th><th>Role</th><th>Start</th><th>Status</th></tr></thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}><td>{a.student_name}</td><td>{a.council_role.replaceAll('_', ' ')}</td><td>{a.start_date}</td><td><window.StatusBadge status={a.active ? 'active' : 'inactive'} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {isManager && (
            <div className="section-card">
              <div className="section-title">Assign Council Role</div>
              <form className="stack-sm" onSubmit={submitAssignment} style={{ marginTop:10 }}>
                <select value={assignmentForm.student_id} onChange={(e) => setAssignmentForm({ ...assignmentForm, student_id: e.target.value })} required>
                  <option value="">Select student</option>
                  {students.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.level}</option>)}
                </select>
                <select value={assignmentForm.council_role} onChange={(e) => setAssignmentForm({ ...assignmentForm, council_role: e.target.value })}>
                  {(context?.availableRoles || []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <div className="grid cols-2"><input type="date" value={assignmentForm.start_date} onChange={(e) => setAssignmentForm({ ...assignmentForm, start_date: e.target.value })} required /><input type="date" value={assignmentForm.end_date} onChange={(e) => setAssignmentForm({ ...assignmentForm, end_date: e.target.value })} /></div>
                <button className="btn" type="submit">Save Assignment</button>
              </form>
            </div>
          )}
        </div>
      )}

      {activeTab === 'issues' && canManage && (
        <div className="grid cols-2">
          <div className="section-card">
            <div className="section-title">Council Issues</div>
            <table className="table" style={{ marginTop:10 }}>
              <thead><tr><th>Type</th><th>Title</th><th>Status</th><th>Assigned</th><th>Update</th></tr></thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id}>
                    <td>{i.type.replaceAll('_', ' ')}</td><td>{i.title}</td>
                    <td><window.StatusBadge status={i.status} /></td>
                    <td>{(i.assigned_role || 'unassigned').replaceAll('_', ' ')}</td>
                    <td><select value={i.status} onChange={(e) => updateIssueStatus(i.id, e.target.value)}>{['open','in_progress','resolved','escalated'].map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="section-card">
            <div className="section-title">Create Issue</div>
            <form className="stack-sm" onSubmit={submitIssue} style={{ marginTop:10 }}>
              <select value={issueForm.type} onChange={(e) => setIssueForm({ ...issueForm, type: e.target.value })}>{(context?.availableIssueTypes || []).map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}</select>
              <input value={issueForm.title} onChange={(e) => setIssueForm({ ...issueForm, title: e.target.value })} placeholder="Issue title" required />
              <textarea rows="3" value={issueForm.description} onChange={(e) => setIssueForm({ ...issueForm, description: e.target.value })} placeholder="Description" />
              <select value={issueForm.assigned_role} onChange={(e) => setIssueForm({ ...issueForm, assigned_role: e.target.value })}><option value="">Assign role (optional)</option>{(context?.availableRoles || []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
              <div className="grid cols-2"><select value={issueForm.priority} onChange={(e) => setIssueForm({ ...issueForm, priority: e.target.value })}>{['low','medium','high','urgent'].map((p) => <option key={p} value={p}>{p}</option>)}</select><input type="date" value={issueForm.due_date} onChange={(e) => setIssueForm({ ...issueForm, due_date: e.target.value })} /></div>
              <input value={issueForm.linked_rule_category} onChange={(e) => setIssueForm({ ...issueForm, linked_rule_category: e.target.value })} placeholder="Linked school rule area (curfew, dormitory conduct...)" />
              <button className="btn" type="submit">Create Issue</button>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'meetings' && canManage && (
        <div className="grid cols-2">
          <div className="section-card">
            <div className="section-title">Meeting Records</div>
            <div className="stack-sm" style={{ marginTop:10 }}>
              {meetings.map((m) => <div className="tile" key={m.id}><strong>Meeting #{m.meeting_number}</strong><div className="muted">{m.meeting_date} · {m.location || 'TBD'}</div><div>Agenda: {(m.agenda_items || []).length} items · Actions: {(m.action_items || []).length}</div></div>)}
            </div>
          </div>
          <div className="section-card">
            <div className="section-title">Add Meeting</div>
            <form className="stack-sm" style={{ marginTop:10 }} onSubmit={submitMeeting}>
              <div className="grid cols-2"><input value={meetingForm.meeting_number} onChange={(e) => setMeetingForm({ ...meetingForm, meeting_number: e.target.value })} placeholder="Meeting #" required /><input type="date" value={meetingForm.meeting_date} onChange={(e) => setMeetingForm({ ...meetingForm, meeting_date: e.target.value })} required /></div>
              <input value={meetingForm.location} onChange={(e) => setMeetingForm({ ...meetingForm, location: e.target.value })} placeholder="Location" />
              <select value={meetingForm.chairperson_role} onChange={(e) => setMeetingForm({ ...meetingForm, chairperson_role: e.target.value })}><option value="">Chairperson role</option>{(context?.availableRoles || []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
              <textarea rows="3" value={meetingForm.agenda_text} onChange={(e) => setMeetingForm({ ...meetingForm, agenda_text: e.target.value })} placeholder="Agenda items (one per line)" />
              <textarea rows="3" value={meetingForm.action_text} onChange={(e) => setMeetingForm({ ...meetingForm, action_text: e.target.value })} placeholder="Action items (one per line)" />
              <textarea rows="3" value={meetingForm.discussion_notes} onChange={(e) => setMeetingForm({ ...meetingForm, discussion_notes: e.target.value })} placeholder="Discussion notes" />
              <input type="date" value={meetingForm.next_meeting_date} onChange={(e) => setMeetingForm({ ...meetingForm, next_meeting_date: e.target.value })} />
              <button className="btn" type="submit">Save Meeting</button>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'rosters' && canManage && (
        <div className="grid cols-2">
          <div className="section-card">
            <div className="section-title">Weekly Duty Rosters</div>
            <table className="table" style={{ marginTop:10 }}>
              <thead><tr><th>Type</th><th>Week</th><th>Status</th><th>Update</th></tr></thead>
              <tbody>
                {rosters.map((r) => <tr key={r.id}><td>{r.roster_type}</td><td>{r.week_start} → {r.week_end}</td><td><window.StatusBadge status={r.status} /></td><td><select value={r.status} onChange={(e) => updateRosterStatus(r.id, e.target.value)}>{['planned','in_progress','completed','missed'].map((s) => <option key={s} value={s}>{s}</option>)}</select></td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="section-card">
            <div className="section-title">Create Weekly Roster</div>
            <form className="stack-sm" style={{ marginTop:10 }} onSubmit={submitRoster}>
              <div className="grid cols-2"><select value={rosterForm.roster_type} onChange={(e) => setRosterForm({ ...rosterForm, roster_type: e.target.value })}><option value="cleaning">Cleaning</option><option value="cooking">Cooking</option></select><select value={rosterForm.status} onChange={(e) => setRosterForm({ ...rosterForm, status: e.target.value })}>{['planned','in_progress','completed','missed'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              <div className="grid cols-2"><input type="date" value={rosterForm.week_start} onChange={(e) => setRosterForm({ ...rosterForm, week_start: e.target.value })} required /><input type="date" value={rosterForm.week_end} onChange={(e) => setRosterForm({ ...rosterForm, week_end: e.target.value })} required /></div>
              <input value={rosterForm.duty_group} onChange={(e) => setRosterForm({ ...rosterForm, duty_group: e.target.value })} placeholder="Duty group / hostel wing" />
              <textarea rows="3" value={rosterForm.assignments_text} onChange={(e) => setRosterForm({ ...rosterForm, assignments_text: e.target.value })} placeholder="Assignments (one student/team per line)" />
              <textarea rows="2" value={rosterForm.notes} onChange={(e) => setRosterForm({ ...rosterForm, notes: e.target.value })} placeholder="Notes" />
              <button className="btn" type="submit">Save Roster</button>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'resources' && canManage && (
        <div className="grid cols-2">
          <div className="section-card">
            <div className="section-title">Resource Logs</div>
            <table className="table" style={{ marginTop:10 }}>
              <thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Student</th></tr></thead>
              <tbody>{resourceLogs.map((r) => <tr key={r.id}><td>{r.log_date}</td><td>{r.item_name}</td><td>{r.log_type}</td><td>{r.student_name || '-'}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="section-card">
            <div className="section-title">Add Resource Log</div>
            <form className="stack-sm" style={{ marginTop:10 }} onSubmit={submitResourceLog}>
              <input value={resourceForm.item_name} onChange={(e) => setResourceForm({ ...resourceForm, item_name: e.target.value })} placeholder="Item name" required />
              <div className="grid cols-2"><select value={resourceForm.log_type} onChange={(e) => setResourceForm({ ...resourceForm, log_type: e.target.value })}>{['sign_out','sign_in','inventory_check','damaged','missing'].map((t) => <option key={t} value={t}>{t}</option>)}</select><input type="date" value={resourceForm.log_date} onChange={(e) => setResourceForm({ ...resourceForm, log_date: e.target.value })} /></div>
              <select value={resourceForm.student_id} onChange={(e) => setResourceForm({ ...resourceForm, student_id: e.target.value })}><option value="">Student (optional)</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <input value={resourceForm.quantity} onChange={(e) => setResourceForm({ ...resourceForm, quantity: e.target.value })} placeholder="Quantity" />
              <input value={resourceForm.condition_status} onChange={(e) => setResourceForm({ ...resourceForm, condition_status: e.target.value })} placeholder="Condition" />
              <textarea rows="2" value={resourceForm.notes} onChange={(e) => setResourceForm({ ...resourceForm, notes: e.target.value })} placeholder="Notes" />
              <button className="btn" type="submit">Save Log</button>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'funds' && canManage && (
        <div className="grid cols-2">
          <div className="section-card">
            <div className="section-title">Council Funds Ledger</div>
            <div className="kpi-grid" style={{ marginTop:10 }}>
              <div className="kpi-card"><div className="kpi-label">Collections</div><div className="kpi-value">{window.fmtRM(funds.summary?.total_collections || 0)}</div></div>
              <div className="kpi-card"><div className="kpi-label">Expenses</div><div className="kpi-value">{window.fmtRM(funds.summary?.total_expenses || 0)}</div></div>
              <div className="kpi-card"><div className="kpi-label">Balance</div><div className="kpi-value">{window.fmtRM(funds.summary?.balance || 0)}</div></div>
            </div>
            <table className="table" style={{ marginTop:10 }}>
              <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead>
              <tbody>{(funds.ledger || []).map((f) => <tr key={f.id}><td>{f.entry_date}</td><td>{f.entry_type}</td><td>{f.description}</td><td>{window.fmtRM(f.amount)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="section-card">
            <div className="section-title">Add Fund Entry</div>
            <form className="stack-sm" style={{ marginTop:10 }} onSubmit={submitFund}>
              <div className="grid cols-2"><select value={fundForm.entry_type} onChange={(e) => setFundForm({ ...fundForm, entry_type: e.target.value })}><option value="collection">Collection</option><option value="expense">Expense</option><option value="adjustment">Adjustment</option></select><input type="number" min="0" step="0.01" value={fundForm.amount} onChange={(e) => setFundForm({ ...fundForm, amount: e.target.value })} placeholder="Amount" required /></div>
              <input value={fundForm.description} onChange={(e) => setFundForm({ ...fundForm, description: e.target.value })} placeholder="Description" required />
              <input type="date" value={fundForm.entry_date} onChange={(e) => setFundForm({ ...fundForm, entry_date: e.target.value })} />
              <input value={fundForm.supporting_ref} onChange={(e) => setFundForm({ ...fundForm, supporting_ref: e.target.value })} placeholder="Supporting record reference" />
              <button className="btn" type="submit">Add Entry</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
