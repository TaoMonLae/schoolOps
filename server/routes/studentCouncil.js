const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { createNotificationsForRoles, createNotification } = require('../services/notifications');

const router = express.Router();

const COUNCIL_ROLES = [
  'president',
  'vice_president',
  'secretary',
  'treasurer',
  'boys_hostel_monitor',
  'girls_hostel_monitor',
  'resource_monitor',
  'cooking_duty_leader',
  'cleaning_duty_leader',
];

const ISSUE_TYPES = [
  'hostel_concern',
  'curfew_issue',
  'quiet_hours_issue',
  'kitchen_dining_issue',
  'cleaning_duty_issue',
  'maintenance_issue',
  'resource_issue',
  'student_concern',
  'council_action_item',
];

const ISSUE_STATUS = ['open', 'in_progress', 'resolved', 'escalated'];
const ISSUE_PRIORITY = ['low', 'medium', 'high', 'urgent'];
const ROSTER_TYPE = ['cooking', 'cleaning'];
const ROSTER_STATUS = ['planned', 'in_progress', 'completed', 'missed'];
const FUND_TYPE = ['collection', 'expense', 'adjustment'];

const ROLE_LABELS = {
  president: 'President',
  vice_president: 'Vice-President',
  secretary: 'Secretary',
  treasurer: 'Treasurer',
  boys_hostel_monitor: "Boys' Hostel Monitor",
  girls_hostel_monitor: "Girls' Hostel Monitor",
  resource_monitor: 'Resource Monitor',
  cooking_duty_leader: 'Cooking Duty Leader',
  cleaning_duty_leader: 'Cleaning Duty Leader',
};

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function optionalText(value) {
  const txt = normalizeText(value);
  return txt ? txt : null;
}

function normalizeDate(value) {
  const txt = normalizeText(value);
  if (!txt) return null;
  return txt.slice(0, 10);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function hasRoleManagementAccess(user) {
  return user.role === 'admin' || user.role === 'teacher';
}

function getLinkedStudentId(userId) {
  const row = db.prepare('SELECT id FROM students WHERE user_id = ?').get(userId);
  return row?.id || null;
}

function getCurrentCouncilAssignmentByStudent(studentId) {
  if (!studentId) return null;
  return db.prepare(`
    SELECT ca.*, s.name AS student_name
    FROM council_assignments ca
    JOIN students s ON s.id = ca.student_id
    WHERE ca.student_id = ?
      AND ca.active = 1
      AND date(ca.start_date) <= date('now')
      AND (ca.end_date IS NULL OR date(ca.end_date) >= date('now'))
    ORDER BY date(ca.start_date) DESC, ca.id DESC
    LIMIT 1
  `).get(studentId) || null;
}

function getCouncilContext(req) {
  const linkedStudentId = getLinkedStudentId(req.user.id);
  const assignment = getCurrentCouncilAssignmentByStudent(linkedStudentId);

  return {
    isManager: hasRoleManagementAccess(req.user),
    linkedStudentId,
    assignment,
    councilRole: assignment?.council_role || null,
    isCouncilMember: !!assignment,
  };
}

function roleCanViewIssue(role, issue) {
  if (!role) return false;
  if (issue.assigned_role === role) return true;
  if (role === 'president') return true;
  if (role === 'vice_president' && ['boys_hostel_monitor', 'girls_hostel_monitor'].includes(issue.assigned_role)) return true;
  if (role === 'secretary' && ['resource_issue', 'council_action_item', 'student_concern'].includes(issue.type)) return true;
  if (role === 'resource_monitor' && issue.type === 'resource_issue') return true;
  if (role.includes('hostel_monitor') && ['hostel_concern', 'curfew_issue', 'quiet_hours_issue', 'kitchen_dining_issue', 'maintenance_issue', 'cleaning_duty_issue'].includes(issue.type)) return true;
  return false;
}

function requireCouncilOrManager(req, res, next) {
  const ctx = getCouncilContext(req);
  req.councilContext = ctx;

  if (ctx.isManager || ctx.isCouncilMember) return next();
  return res.status(403).json({ error: 'Student Council access is limited to council members and staff.' });
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

router.get('/context', requireAuth, (req, res) => {
  const ctx = getCouncilContext(req);
  res.json({
    user: req.user,
    ...ctx,
    roleLabel: ctx.councilRole ? ROLE_LABELS[ctx.councilRole] || ctx.councilRole : null,
    availableRoles: COUNCIL_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] || role })),
    availableIssueTypes: ISSUE_TYPES,
  });
});

router.get('/overview', requireAuth, (req, res) => {
  const members = db.prepare(`
    SELECT ca.id, ca.council_role, ca.start_date, ca.end_date, ca.active,
           s.id AS student_id, s.name AS student_name, s.level, s.gender
    FROM council_assignments ca
    JOIN students s ON s.id = ca.student_id
    WHERE ca.active = 1
      AND date(ca.start_date) <= date('now')
      AND (ca.end_date IS NULL OR date(ca.end_date) >= date('now'))
    ORDER BY ca.council_role, s.name
  `).all();

  const issueSummary = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM council_issues
    GROUP BY status
  `).all();

  const openActionItems = db.prepare(`
    SELECT COUNT(*) AS count
    FROM council_action_items
    WHERE status IN ('open','in_progress')
  `).get()?.count || 0;

  const upcomingMeeting = db.prepare(`
    SELECT id, meeting_number, meeting_date, location, chairperson_role, start_time, end_time
    FROM council_meetings
    WHERE date(meeting_date) >= date('now')
    ORDER BY date(meeting_date) ASC, id ASC
    LIMIT 1
  `).get() || null;

  res.json({ members, issueSummary, openActionItems, upcomingMeeting });
});

router.get('/assignments', requireAuth, requireCouncilOrManager, (req, res) => {
  const { active = '1' } = req.query;
  const activeFlag = active === '0' ? null : 1;

  let sql = `
    SELECT ca.*, s.name AS student_name, s.gender, s.level,
           assigner.name AS assigned_by_name, updater.name AS updated_by_name
    FROM council_assignments ca
    JOIN students s ON s.id = ca.student_id
    LEFT JOIN users assigner ON assigner.id = ca.assigned_by
    LEFT JOIN users updater ON updater.id = ca.updated_by
  `;
  const params = [];
  if (activeFlag !== null) {
    sql += ' WHERE ca.active = 1';
  }

  if (!req.councilContext.isManager) {
    sql += activeFlag !== null ? ' AND ca.student_id = ?' : ' WHERE ca.student_id = ?';
    params.push(req.councilContext.linkedStudentId || -1);
  }

  sql += ' ORDER BY ca.active DESC, date(ca.start_date) DESC, ca.id DESC';

  res.json(db.prepare(sql).all(...params));
});

router.post('/assignments', requireAuth, (req, res) => {
  if (!hasRoleManagementAccess(req.user)) {
    return res.status(403).json({ error: 'Only admin/staff can assign council roles.' });
  }

  const studentId = Number.parseInt(req.body.student_id, 10);
  const councilRole = normalizeText(req.body.council_role).toLowerCase();
  const startDate = normalizeDate(req.body.start_date);
  const endDate = normalizeDate(req.body.end_date);
  const active = req.body.active === undefined ? 1 : (req.body.active ? 1 : 0);

  if (!Number.isInteger(studentId)) return res.status(400).json({ error: 'Valid student_id is required.' });
  if (!COUNCIL_ROLES.includes(councilRole)) return res.status(400).json({ error: 'Invalid council role.' });
  if (!startDate) return res.status(400).json({ error: 'start_date is required.' });

  const student = db.prepare('SELECT id, name, user_id FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const tx = db.transaction(() => {
    if (active) {
      db.prepare(`
        UPDATE council_assignments
        SET active = 0, end_date = COALESCE(end_date, ?), updated_at = datetime('now'), updated_by = ?
        WHERE student_id = ? AND council_role = ? AND active = 1
      `).run(startDate, req.user.id, studentId, councilRole);
    }

    const result = db.prepare(`
      INSERT INTO council_assignments (student_id, council_role, start_date, end_date, active, assigned_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(studentId, councilRole, startDate, endDate, active, req.user.id, req.user.id);

    audit(req.user.id, 'create', 'council_assignments', result.lastInsertRowid, `Assigned ${councilRole} to student ${studentId}`);

    if (student.user_id) {
      createNotification({
        userId: student.user_id,
        type: 'council_assignment',
        title: 'Student Council role assigned',
        message: `You were assigned as ${ROLE_LABELS[councilRole] || councilRole}.`,
        entityType: 'council_assignment',
        entityId: result.lastInsertRowid,
      });
    }

    return result.lastInsertRowid;
  });

  const id = tx();
  res.status(201).json({ id });
});

router.patch('/assignments/:id', requireAuth, (req, res) => {
  if (!hasRoleManagementAccess(req.user)) {
    return res.status(403).json({ error: 'Only admin/staff can update council assignments.' });
  }

  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Valid assignment id is required.' });

  const existing = db.prepare('SELECT * FROM council_assignments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Assignment not found.' });

  const studentId = Number.parseInt(req.body.student_id, 10);
  const councilRole = normalizeText(req.body.council_role).toLowerCase();
  const startDate = normalizeDate(req.body.start_date);
  const endDate = normalizeDate(req.body.end_date);
  const active = req.body.active ? 1 : 0;

  if (!Number.isInteger(studentId)) return res.status(400).json({ error: 'Valid student_id is required.' });
  if (!COUNCIL_ROLES.includes(councilRole)) return res.status(400).json({ error: 'Invalid council role.' });
  if (!startDate) return res.status(400).json({ error: 'start_date is required.' });

  const student = db.prepare('SELECT id, name, user_id FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  let normalizedEndDate = endDate;
  if (!active && !normalizedEndDate) normalizedEndDate = todayIsoDate();
  if (active && normalizedEndDate && normalizedEndDate < startDate) {
    return res.status(400).json({ error: 'end_date cannot be before start_date for an active assignment.' });
  }

  const tx = db.transaction(() => {
    if (active) {
      const conflict = db.prepare(`
        SELECT id FROM council_assignments
        WHERE student_id = ? AND council_role = ? AND active = 1 AND id != ?
        ORDER BY date(start_date) DESC, id DESC
      `).all(studentId, councilRole, id);

      for (const row of conflict) {
        db.prepare(`
          UPDATE council_assignments
          SET active = 0, end_date = COALESCE(end_date, ?), updated_at = datetime('now'), updated_by = ?
          WHERE id = ?
        `).run(startDate, req.user.id, row.id);
      }
    }

    db.prepare(`
      UPDATE council_assignments
      SET student_id = ?,
          council_role = ?,
          start_date = ?,
          end_date = ?,
          active = ?,
          updated_at = datetime('now'),
          updated_by = ?
      WHERE id = ?
    `).run(studentId, councilRole, startDate, normalizedEndDate, active, req.user.id, id);

    audit(
      req.user.id,
      'update',
      'council_assignments',
      id,
      `Updated assignment ${id}: student ${existing.student_id}→${studentId}, role ${existing.council_role}→${councilRole}, active ${existing.active}→${active}`
    );

    if (student.user_id) {
      createNotification({
        userId: student.user_id,
        type: 'council_assignment',
        title: 'Student Council assignment updated',
        message: `Your council assignment was updated to ${ROLE_LABELS[councilRole] || councilRole}.`,
        entityType: 'council_assignment',
        entityId: id,
      });
    }
  });

  tx();
  res.json({ ok: true });
});

router.post('/assignments/:id/deactivate', requireAuth, (req, res) => {
  if (!hasRoleManagementAccess(req.user)) {
    return res.status(403).json({ error: 'Only admin/staff can deactivate council assignments.' });
  }

  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Valid assignment id is required.' });

  const assignment = db.prepare(`
    SELECT ca.*, s.name AS student_name, s.user_id
    FROM council_assignments ca
    JOIN students s ON s.id = ca.student_id
    WHERE ca.id = ?
  `).get(id);

  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
  if (!assignment.active) return res.json({ ok: true, alreadyInactive: true });

  const today = todayIsoDate();
  const endDate = normalizeDate(assignment.end_date) || today;

  db.prepare(`
    UPDATE council_assignments
    SET active = 0, end_date = ?, updated_at = datetime('now'), updated_by = ?
    WHERE id = ?
  `).run(endDate, req.user.id, id);

  audit(
    req.user.id,
    'deactivate',
    'council_assignments',
    id,
    `Deactivated assignment ${id} (${assignment.council_role}) for student ${assignment.student_id}`
  );

  if (assignment.user_id) {
    createNotification({
      userId: assignment.user_id,
      type: 'council_assignment',
      title: 'Student Council assignment ended',
      message: `Your ${ROLE_LABELS[assignment.council_role] || assignment.council_role} assignment was ended.`,
      entityType: 'council_assignment',
      entityId: id,
    });
  }

  res.json({ ok: true, id, end_date: endDate });
});

router.get('/issues', requireAuth, requireCouncilOrManager, (req, res) => {
  const status = optionalText(req.query.status);
  const roleFilter = optionalText(req.query.assigned_role);

  let sql = `
    SELECT ci.*, reporter.name AS reported_by_name, assignee.name AS assigned_student_name,
           target.name AS target_student_name
    FROM council_issues ci
    LEFT JOIN users reporter ON reporter.id = ci.reported_by
    LEFT JOIN students assignee ON assignee.id = ci.assigned_student_id
    LEFT JOIN students target ON target.id = ci.target_student_id
    WHERE 1 = 1
  `;
  const params = [];

  if (status) {
    sql += ' AND ci.status = ?';
    params.push(status);
  }
  if (roleFilter) {
    sql += ' AND ci.assigned_role = ?';
    params.push(roleFilter);
  }

  if (!req.councilContext.isManager) {
    const linkedStudentId = req.councilContext.linkedStudentId || -1;
    sql += ' AND (ci.assigned_student_id = ? OR ci.reported_by = ? OR ci.assigned_role = ?)';
    params.push(linkedStudentId, req.user.id, req.councilContext.councilRole || '');
  }

  sql += ' ORDER BY datetime(ci.created_at) DESC, ci.id DESC';
  const rows = db.prepare(sql).all(...params);

  if (!req.councilContext.isManager && req.councilContext.councilRole) {
    return res.json(rows.filter((issue) => roleCanViewIssue(req.councilContext.councilRole, issue)));
  }

  return res.json(rows);
});

router.post('/issues', requireAuth, requireCouncilOrManager, (req, res) => {
  const type = normalizeText(req.body.type).toLowerCase();
  const title = normalizeText(req.body.title);
  const description = optionalText(req.body.description);
  const assignedRole = optionalText(req.body.assigned_role)?.toLowerCase() || null;
  const assignedStudentId = req.body.assigned_student_id ? Number.parseInt(req.body.assigned_student_id, 10) : null;
  const targetStudentId = req.body.target_student_id ? Number.parseInt(req.body.target_student_id, 10) : null;
  const status = normalizeText(req.body.status || 'open').toLowerCase();
  const priority = normalizeText(req.body.priority || 'medium').toLowerCase();
  const dueDate = normalizeDate(req.body.due_date);
  const resolutionNotes = optionalText(req.body.resolution_notes);
  const linkedRuleCategory = optionalText(req.body.linked_rule_category);

  if (!ISSUE_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid issue type.' });
  if (!title) return res.status(400).json({ error: 'title is required.' });
  if (!ISSUE_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (!ISSUE_PRIORITY.includes(priority)) return res.status(400).json({ error: 'Invalid priority.' });
  if (assignedRole && !COUNCIL_ROLES.includes(assignedRole)) return res.status(400).json({ error: 'Invalid assigned_role.' });

  if (!req.councilContext.isManager && assignedRole && assignedRole !== req.councilContext.councilRole) {
    return res.status(403).json({ error: 'You can only assign issues to your own role.' });
  }

  const result = db.prepare(`
    INSERT INTO council_issues (
      type, title, description, reported_by, assigned_role, assigned_student_id, target_student_id,
      status, priority, due_date, resolution_notes, linked_rule_category
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    type,
    title,
    description,
    req.user.id,
    assignedRole,
    assignedStudentId,
    targetStudentId,
    status,
    priority,
    dueDate,
    resolutionNotes,
    linkedRuleCategory,
  );

  audit(req.user.id, 'create', 'council_issues', result.lastInsertRowid, `${type}: ${title}`);

  if (status === 'escalated') {
    createNotificationsForRoles(['admin', 'teacher'], {
      type: 'council_issue_escalated',
      title: 'Council issue escalated',
      message: `${title} was marked as escalated.`,
      entityType: 'council_issue',
      entityId: result.lastInsertRowid,
    });
  }

  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch('/issues/:id(\\d+)', requireAuth, requireCouncilOrManager, (req, res) => {
  const issueId = Number.parseInt(req.params.id, 10);
  const issue = db.prepare('SELECT * FROM council_issues WHERE id = ?').get(issueId);
  if (!issue) return res.status(404).json({ error: 'Issue not found.' });

  if (!req.councilContext.isManager) {
    const own = issue.reported_by === req.user.id
      || issue.assigned_student_id === req.councilContext.linkedStudentId
      || issue.assigned_role === req.councilContext.councilRole;
    if (!own) return res.status(403).json({ error: 'Not allowed to update this issue.' });
  }

  const status = req.body.status ? normalizeText(req.body.status).toLowerCase() : issue.status;
  const priority = req.body.priority ? normalizeText(req.body.priority).toLowerCase() : issue.priority;
  const assignedRole = req.body.assigned_role ? normalizeText(req.body.assigned_role).toLowerCase() : issue.assigned_role;
  const assignedStudentId = req.body.assigned_student_id !== undefined
    ? (req.body.assigned_student_id ? Number.parseInt(req.body.assigned_student_id, 10) : null)
    : issue.assigned_student_id;
  const dueDate = req.body.due_date !== undefined ? normalizeDate(req.body.due_date) : issue.due_date;
  const resolutionNotes = req.body.resolution_notes !== undefined ? optionalText(req.body.resolution_notes) : issue.resolution_notes;

  if (!ISSUE_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (!ISSUE_PRIORITY.includes(priority)) return res.status(400).json({ error: 'Invalid priority.' });
  if (assignedRole && !COUNCIL_ROLES.includes(assignedRole)) return res.status(400).json({ error: 'Invalid assigned_role.' });

  db.prepare(`
    UPDATE council_issues
    SET status = ?, priority = ?, assigned_role = ?, assigned_student_id = ?,
        due_date = ?, resolution_notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, priority, assignedRole, assignedStudentId, dueDate, resolutionNotes, issueId);

  if (req.body.escalate_to_discipline && issue.target_student_id && req.body.discipline_rule_id) {
    const ruleId = Number.parseInt(req.body.discipline_rule_id, 10);
    const rule = db.prepare('SELECT id, severity FROM disciplinary_rules WHERE id = ? AND active = 1').get(ruleId);
    if (rule) {
      db.prepare(`
        INSERT INTO disciplinary_records (
          student_id, rule_id, incident_date, reported_by, details, severity_at_time, status, action_taken
        ) VALUES (?, ?, date('now'), ?, ?, ?, 'pending', ?)
      `).run(
        issue.target_student_id,
        rule.id,
        req.user.id,
        issue.description || issue.title,
        rule.severity,
        'Created via Student Council escalation',
      );
    }
  }

  if (status === 'escalated') {
    createNotificationsForRoles(['admin', 'teacher'], {
      type: 'council_issue_escalated',
      title: 'Council issue escalated',
      message: `${issue.title} was escalated by ${req.user.name}.`,
      entityType: 'council_issue',
      entityId: issueId,
    });
  }

  audit(req.user.id, 'update', 'council_issues', issueId, `Updated issue status to ${status}`);
  res.json({ ok: true });
});

router.get('/meetings', requireAuth, requireCouncilOrManager, (req, res) => {
  const meetings = db.prepare(`
    SELECT cm.*,
      chair.name AS chairperson_name,
      minutes.name AS minutes_taken_by_name
    FROM council_meetings cm
    LEFT JOIN students chair ON chair.id = cm.chairperson_student_id
    LEFT JOIN students minutes ON minutes.id = cm.minutes_taken_by_student_id
    ORDER BY date(cm.meeting_date) DESC, cm.id DESC
  `).all().map((meeting) => ({
    ...meeting,
    attendance: parseJsonArray(meeting.attendance),
    agenda_items: parseJsonArray(meeting.agenda_items),
    action_items: parseJsonArray(meeting.action_items),
  }));

  res.json(meetings);
});

router.post('/meetings', requireAuth, requireCouncilOrManager, (req, res) => {
  if (!req.councilContext.isManager && !['president', 'secretary'].includes(req.councilContext.councilRole)) {
    return res.status(403).json({ error: 'Only President, Secretary, or staff can create meetings.' });
  }

  const meetingNumber = normalizeText(req.body.meeting_number);
  const meetingDate = normalizeDate(req.body.meeting_date);
  const startTime = optionalText(req.body.start_time);
  const endTime = optionalText(req.body.end_time);
  const location = optionalText(req.body.location);
  const chairpersonRole = optionalText(req.body.chairperson_role);
  const chairpersonStudentId = req.body.chairperson_student_id ? Number.parseInt(req.body.chairperson_student_id, 10) : null;
  const minutesTakenByStudentId = req.body.minutes_taken_by_student_id ? Number.parseInt(req.body.minutes_taken_by_student_id, 10) : null;
  const attendance = JSON.stringify(Array.isArray(req.body.attendance) ? req.body.attendance : []);
  const agendaItems = JSON.stringify(Array.isArray(req.body.agenda_items) ? req.body.agenda_items : []);
  const discussionNotes = optionalText(req.body.discussion_notes);
  const actionItems = JSON.stringify(Array.isArray(req.body.action_items) ? req.body.action_items : []);
  const nextMeetingDate = normalizeDate(req.body.next_meeting_date);

  if (!meetingNumber || !meetingDate) return res.status(400).json({ error: 'meeting_number and meeting_date are required.' });

  const result = db.prepare(`
    INSERT INTO council_meetings (
      meeting_number, meeting_date, start_time, end_time, location,
      chairperson_role, chairperson_student_id, minutes_taken_by_student_id,
      attendance, agenda_items, discussion_notes, action_items, next_meeting_date, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    meetingNumber,
    meetingDate,
    startTime,
    endTime,
    location,
    chairpersonRole,
    chairpersonStudentId,
    minutesTakenByStudentId,
    attendance,
    agendaItems,
    discussionNotes,
    actionItems,
    nextMeetingDate,
    req.user.id,
  );

  audit(req.user.id, 'create', 'council_meetings', result.lastInsertRowid, `Meeting ${meetingNumber}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.get('/duty-rosters', requireAuth, requireCouncilOrManager, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, creator.name AS created_by_name
    FROM council_duty_rosters r
    LEFT JOIN users creator ON creator.id = r.created_by
    ORDER BY date(r.week_start) DESC, r.id DESC
  `).all().map((row) => ({ ...row, assignments: parseJsonArray(row.assignments) }));

  res.json(rows);
});

router.post('/duty-rosters', requireAuth, requireCouncilOrManager, (req, res) => {
  const rosterType = normalizeText(req.body.roster_type).toLowerCase();
  const weekStart = normalizeDate(req.body.week_start);
  const weekEnd = normalizeDate(req.body.week_end);
  const dutyGroup = optionalText(req.body.duty_group);
  const assignments = JSON.stringify(Array.isArray(req.body.assignments) ? req.body.assignments : []);
  const status = normalizeText(req.body.status || 'planned').toLowerCase();
  const notes = optionalText(req.body.notes);

  if (!ROSTER_TYPE.includes(rosterType)) return res.status(400).json({ error: 'Invalid roster_type.' });
  if (!weekStart || !weekEnd) return res.status(400).json({ error: 'week_start and week_end are required.' });
  if (!ROSTER_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  if (!req.councilContext.isManager
    && !['boys_hostel_monitor', 'girls_hostel_monitor', 'cleaning_duty_leader', 'cooking_duty_leader'].includes(req.councilContext.councilRole)) {
    return res.status(403).json({ error: 'You are not allowed to manage duty rosters.' });
  }

  const result = db.prepare(`
    INSERT INTO council_duty_rosters (
      roster_type, week_start, week_end, duty_group, assignments, status, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(rosterType, weekStart, weekEnd, dutyGroup, assignments, status, notes, req.user.id);

  audit(req.user.id, 'create', 'council_duty_rosters', result.lastInsertRowid, `Roster ${rosterType} ${weekStart}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch('/duty-rosters/:id(\\d+)', requireAuth, requireCouncilOrManager, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const roster = db.prepare('SELECT * FROM council_duty_rosters WHERE id = ?').get(id);
  if (!roster) return res.status(404).json({ error: 'Roster not found.' });

  const status = req.body.status ? normalizeText(req.body.status).toLowerCase() : roster.status;
  const notes = req.body.notes !== undefined ? optionalText(req.body.notes) : roster.notes;

  if (!ROSTER_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  db.prepare(`
    UPDATE council_duty_rosters
    SET status = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, notes, id);

  if (status === 'missed' && req.body.create_issue_on_miss) {
    db.prepare(`
      INSERT INTO council_issues (
        type, title, description, reported_by, assigned_role, status, priority, due_date
      ) VALUES ('cleaning_duty_issue', ?, ?, ?, ?, 'open', 'high', date('now', '+3 days'))
    `).run(
      `Missed ${roster.roster_type} duty for week ${roster.week_start}`,
      notes || 'Duty roster marked as missed.',
      req.user.id,
      req.body.issue_assigned_role || 'vice_president',
    );
  }

  audit(req.user.id, 'update', 'council_duty_rosters', id, `Roster status ${status}`);
  res.json({ ok: true });
});

router.get('/resource-logs', requireAuth, requireCouncilOrManager, (req, res) => {
  const rows = db.prepare(`
    SELECT rl.*, s.name AS student_name, u.name AS created_by_name
    FROM council_resource_logs rl
    LEFT JOIN students s ON s.id = rl.student_id
    LEFT JOIN users u ON u.id = rl.created_by
    ORDER BY datetime(rl.log_date) DESC, rl.id DESC
  `).all();
  res.json(rows);
});

router.post('/resource-logs', requireAuth, requireCouncilOrManager, (req, res) => {
  if (!req.councilContext.isManager && !['resource_monitor', 'secretary'].includes(req.councilContext.councilRole)) {
    return res.status(403).json({ error: 'You are not allowed to manage resource logs.' });
  }

  const itemName = normalizeText(req.body.item_name);
  const logType = normalizeText(req.body.log_type || 'inventory_check').toLowerCase();
  const studentId = req.body.student_id ? Number.parseInt(req.body.student_id, 10) : null;
  const quantity = req.body.quantity !== undefined ? Number(req.body.quantity) : null;
  const conditionStatus = optionalText(req.body.condition_status);
  const notes = optionalText(req.body.notes);
  const logDate = normalizeDate(req.body.log_date) || new Date().toISOString().slice(0, 10);

  if (!itemName) return res.status(400).json({ error: 'item_name is required.' });

  const result = db.prepare(`
    INSERT INTO council_resource_logs (
      item_name, log_type, student_id, quantity, condition_status, notes, log_date, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(itemName, logType, studentId, quantity, conditionStatus, notes, logDate, req.user.id);

  if (['damaged', 'missing'].includes(logType)) {
    createNotificationsForRoles(['admin', 'teacher'], {
      type: 'resource_alert',
      title: 'Resource issue reported',
      message: `${itemName} logged as ${logType}.`,
      entityType: 'council_resource_log',
      entityId: result.lastInsertRowid,
    });
  }

  audit(req.user.id, 'create', 'council_resource_logs', result.lastInsertRowid, `${logType}: ${itemName}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.get('/funds', requireAuth, requireCouncilOrManager, (req, res) => {
  if (!req.councilContext.isManager && req.councilContext.councilRole !== 'treasurer') {
    return res.status(403).json({ error: 'Only treasurer or staff can view funds.' });
  }

  const rows = db.prepare(`
    SELECT cf.*, u.name AS created_by_name
    FROM council_funds cf
    LEFT JOIN users u ON u.id = cf.created_by
    ORDER BY date(cf.entry_date) DESC, cf.id DESC
  `).all();

  const summary = db.prepare(`
    SELECT
      SUM(CASE WHEN entry_type = 'collection' THEN amount ELSE 0 END) AS total_collections,
      SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END) AS total_expenses,
      SUM(CASE WHEN entry_type = 'adjustment' THEN amount ELSE 0 END) AS total_adjustments
    FROM council_funds
  `).get();

  const balance = Number(summary.total_collections || 0) - Number(summary.total_expenses || 0) + Number(summary.total_adjustments || 0);
  res.json({ ledger: rows, summary: { ...summary, balance } });
});

router.post('/funds', requireAuth, requireCouncilOrManager, (req, res) => {
  if (!req.councilContext.isManager && req.councilContext.councilRole !== 'treasurer') {
    return res.status(403).json({ error: 'Only treasurer or staff can add fund entries.' });
  }

  const entryType = normalizeText(req.body.entry_type).toLowerCase();
  const amount = Number(req.body.amount || 0);
  const description = normalizeText(req.body.description);
  const entryDate = normalizeDate(req.body.entry_date) || new Date().toISOString().slice(0, 10);
  const supportingRef = optionalText(req.body.supporting_ref);

  if (!FUND_TYPE.includes(entryType)) return res.status(400).json({ error: 'Invalid entry_type.' });
  if (!(amount > 0)) return res.status(400).json({ error: 'amount must be greater than zero.' });
  if (!description) return res.status(400).json({ error: 'description is required.' });

  const result = db.prepare(`
    INSERT INTO council_funds (entry_type, amount, description, entry_date, supporting_ref, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entryType, amount, description, entryDate, supportingRef, req.user.id);

  audit(req.user.id, 'create', 'council_funds', result.lastInsertRowid, `${entryType} ${amount}`);
  res.status(201).json({ id: result.lastInsertRowid });
});

module.exports = router;
