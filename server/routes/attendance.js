const express = require('express');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const VALID_STATUSES = ['present', 'absent', 'late', 'excused'];
const WEEKDAY_CURFEW_START_MINUTES = 15 * 60;
const WEEKDAY_CURFEW_END_MINUTES = 18 * 60;

function normalizeDate(input) {
  const text = (input || '').toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function normalizeDateTime(input) {
  const text = (input || '').toString().trim().replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) return null;
  return text.length === 16 ? `${text}:00` : text;
}

function formatDateTime(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function parseStoredDateTime(value) {
  if (!value) return null;
  const normalized = value.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDayType(dateValue) {
  const day = dateValue.getDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

function getMinutesSinceMidnight(dateValue) {
  return dateValue.getHours() * 60 + dateValue.getMinutes();
}

function formatDateForStorage(dateValue) {
  return formatDateTime(dateValue).slice(0, 10);
}

function weekdayCurfewDateTime(dateValue) {
  const year = dateValue.getFullYear();
  const month = dateValue.getMonth();
  const date = dateValue.getDate();
  return formatDateTime(new Date(year, month, date, 18, 0, 0));
}

function serializeMovement(row) {
  return {
    ...row,
    is_open: !row.return_time,
  };
}

function getActiveStudent(studentId) {
  return db.prepare(`
    SELECT id, name, level, hostel_status, dorm_house, room, bed_number
    FROM students
    WHERE id = ? AND status = 'active'
  `).get(studentId);
}

function getOpenMovement(studentId) {
  return db.prepare(`
    SELECT *
    FROM student_movement_logs
    WHERE student_id = ? AND return_time IS NULL
    ORDER BY leave_time DESC, id DESC
    LIMIT 1
  `).get(studentId);
}

function getLinkedStudentForUser(userId) {
  const direct = db.prepare(`
    SELECT id, user_id, name, level, hostel_status, dorm_house, room, bed_number
    FROM students
    WHERE user_id = ? AND status = 'active'
    LIMIT 1
  `).get(userId);
  if (direct) return direct;

  const user = db.prepare(`
    SELECT id, name, username, role, is_active, login_disabled
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user || user.role !== 'student' || !user.is_active || user.login_disabled) return null;

  const candidates = db.prepare(`
    SELECT id, user_id, name, level, hostel_status, dorm_house, room, bed_number
    FROM students
    WHERE status = 'active'
      AND user_id IS NULL
      AND (
        lower(trim(name)) = lower(trim(?))
        OR lower(trim(name)) = lower(trim(?))
      )
    ORDER BY id ASC
    LIMIT 2
  `).all(user.name || '', user.username || '');

  if (candidates.length !== 1) return null;

  const student = candidates[0];
  db.prepare('UPDATE students SET user_id = ? WHERE id = ? AND user_id IS NULL').run(user.id, student.id);

  return {
    ...student,
    user_id: user.id,
  };
}

function createMovementLog({
  studentId,
  leaveTimeText,
  destination,
  reason,
  dayType,
  approvalStatus,
  expectedReturnTime,
  approvedBy,
  approvedAt,
  recordedOutBy,
}) {
  return db.prepare(`
    INSERT INTO student_movement_logs (
      student_id, leave_time, destination, reason, day_type, approval_status,
      expected_return_time, compliance_status, approved_by, approved_at, recorded_out_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'out', ?, ?, ?)
  `).run(
    studentId,
    leaveTimeText,
    destination,
    reason,
    dayType,
    approvalStatus,
    expectedReturnTime,
    approvedBy,
    approvedAt,
    recordedOutBy,
  );
}

function parseMonthYear(req) {
  const now = new Date();
  const month = Number.parseInt(req.query.month, 10) || now.getMonth() + 1;
  const year = Number.parseInt(req.query.year, 10) || now.getFullYear();
  return { month, year };
}

function parseDateRange(req) {
  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = normalizeDate(req.query.from) || defaultStart.toISOString().slice(0, 10);
  const to = normalizeDate(req.query.to) || now.toISOString().slice(0, 10);
  return { from, to };
}

function attendancePercentage(studentId, from, to) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_days,
      SUM(CASE WHEN status IN ('present','late','excused') THEN 1 ELSE 0 END) AS attended_days
    FROM attendance_records
    WHERE student_id = ? AND attendance_date BETWEEN ? AND ?
  `).get(studentId, from, to);

  const total = Number(row?.total_days || 0);
  const attended = Number(row?.attended_days || 0);
  return total > 0 ? Number(((attended / total) * 100).toFixed(1)) : null;
}

router.get('/today-summary', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_students,
      SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS present_count,
      SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
      SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) AS late_count,
      SUM(CASE WHEN ar.status = 'excused' THEN 1 ELSE 0 END) AS excused_count,
      SUM(CASE WHEN ar.status IS NULL THEN 1 ELSE 0 END) AS not_marked_count
    FROM students s
    LEFT JOIN attendance_records ar
      ON ar.student_id = s.id AND ar.attendance_date = ?
    WHERE s.status = 'active'
  `).get(today);

  const absentStudents = db.prepare(`
    SELECT s.id, s.name, s.level, s.hostel_status, s.dorm_house, s.room, s.bed_number, ar.notes
    FROM attendance_records ar
    JOIN students s ON s.id = ar.student_id
    WHERE ar.attendance_date = ? AND ar.status = 'absent' AND s.status = 'active'
    ORDER BY s.name
  `).all(today);

  const repeatedAbsenceAlerts = db.prepare(`
    SELECT s.id, s.name, s.level, COUNT(*) AS absence_count
    FROM attendance_records ar
    JOIN students s ON s.id = ar.student_id
    WHERE ar.status = 'absent'
      AND ar.attendance_date BETWEEN date(?, '-14 days') AND ?
      AND s.status = 'active'
    GROUP BY s.id
    HAVING COUNT(*) >= 3
    ORDER BY absence_count DESC, s.name
    LIMIT 20
  `).all(today, today);

  const movementTotals = db.prepare(`
    SELECT
      COUNT(*) AS total_out_today,
      SUM(CASE WHEN return_time IS NULL THEN 1 ELSE 0 END) AS currently_out,
      SUM(CASE WHEN compliance_status = 'returned_late' THEN 1 ELSE 0 END) AS returned_late
    FROM student_movement_logs
    WHERE date(leave_time) = ?
  `).get(today);

  res.json({
    date: today,
    totals,
    absentStudents,
    repeatedAbsenceAlerts,
    movementTotals,
  });
});

router.get('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const targetDate = normalizeDate(req.query.date) || new Date().toISOString().slice(0, 10);
  const boarderFilter = (req.query.boarder || 'all').toString();

  let boarderWhere = '';
  if (boarderFilter === 'boarder') boarderWhere = "AND s.hostel_status = 'boarder'";
  if (boarderFilter === 'non_boarder') boarderWhere = "AND s.hostel_status != 'boarder'";

  const rows = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.level,
      s.status,
      s.hostel_status,
      s.dorm_house,
      s.room,
      s.bed_number,
      ar.status AS attendance_status,
      ar.notes AS attendance_notes,
      ar.marked_by,
      ar.updated_at,
      u.name AS marked_by_name
    FROM students s
    LEFT JOIN attendance_records ar
      ON ar.student_id = s.id AND ar.attendance_date = ?
    LEFT JOIN users u ON u.id = ar.marked_by
    WHERE s.status = 'active'
    ${boarderWhere}
    ORDER BY s.name
  `).all(targetDate);

  res.json({ date: targetDate, rows });
});

router.post('/bulk', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const targetDate = normalizeDate(req.body.date);
  const records = Array.isArray(req.body.records) ? req.body.records : [];

  if (!targetDate) return res.status(400).json({ error: 'Valid date is required (YYYY-MM-DD)' });
  if (!records.length) return res.status(400).json({ error: 'records is required' });

  const upsert = db.prepare(`
    INSERT INTO attendance_records (student_id, attendance_date, status, notes, marked_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, attendance_date)
    DO UPDATE SET
      status = excluded.status,
      notes = excluded.notes,
      marked_by = excluded.marked_by,
      updated_at = datetime('now')
  `);

  const tx = db.transaction(() => {
    for (const record of records) {
      const studentId = Number.parseInt(record.student_id, 10);
      const status = (record.status || '').toString().trim();
      const notes = record.notes ? record.notes.toString().trim() : null;

      if (!studentId || !VALID_STATUSES.includes(status)) {
        throw new Error('Invalid attendance record payload');
      }

      const student = db.prepare('SELECT id FROM students WHERE id = ? AND status = ?').get(studentId, 'active');
      if (!student) throw new Error(`Student ${studentId} not found or inactive`);

      upsert.run(studentId, targetDate, status, notes, req.user.id);
    }
  });

  try {
    tx();
    audit(req.user.id, 'UPSERT', 'attendance_records', null, `Bulk attendance update for ${targetDate} (${records.length} records)`);
    res.json({ ok: true, count: records.length, date: targetDate });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to save attendance' });
  }
});

router.get('/history', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { from, to } = parseDateRange(req);
  const status = (req.query.status || 'all').toString();
  const studentId = Number.parseInt(req.query.student_id, 10) || null;
  const boarderFilter = (req.query.boarder || 'all').toString();

  const where = ['ar.attendance_date BETWEEN ? AND ?', "s.status = 'active'"];
  const params = [from, to];

  if (VALID_STATUSES.includes(status)) {
    where.push('ar.status = ?');
    params.push(status);
  }

  if (studentId) {
    where.push('s.id = ?');
    params.push(studentId);
  }

  if (boarderFilter === 'boarder') where.push("s.hostel_status = 'boarder'");
  if (boarderFilter === 'non_boarder') where.push("s.hostel_status != 'boarder'");

  const rows = db.prepare(`
    SELECT
      ar.id,
      ar.attendance_date,
      ar.status,
      ar.notes,
      s.id AS student_id,
      s.name AS student_name,
      s.level,
      s.hostel_status,
      s.dorm_house,
      s.room,
      s.bed_number,
      u.name AS marked_by_name
    FROM attendance_records ar
    JOIN students s ON s.id = ar.student_id
    LEFT JOIN users u ON u.id = ar.marked_by
    WHERE ${where.join(' AND ')}
    ORDER BY ar.attendance_date DESC, s.name
    LIMIT 3000
  `).all(...params);

  const studentSummary = db.prepare(`
    SELECT
      s.id AS student_id,
      s.name AS student_name,
      s.level,
      SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS present_days,
      SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) AS late_days,
      SUM(CASE WHEN ar.status = 'excused' THEN 1 ELSE 0 END) AS excused_days,
      SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) AS absent_days,
      COUNT(*) AS total_days
    FROM attendance_records ar
    JOIN students s ON s.id = ar.student_id
    WHERE ar.attendance_date BETWEEN ? AND ? AND s.status = 'active'
    GROUP BY s.id
    ORDER BY s.name
  `).all(from, to).map((row) => ({
    ...row,
    attendance_percentage: attendancePercentage(row.student_id, from, to),
  }));

  res.json({ from, to, rows, studentSummary });
});

router.get('/movements', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const targetDate = normalizeDate(req.query.date) || formatDateForStorage(new Date());
  const status = (req.query.status || 'all').toString();

  const where = ['date(sml.leave_time) = ?'];
  const params = [targetDate];

  if (status === 'open') where.push('sml.return_time IS NULL');
  if (status === 'closed') where.push('sml.return_time IS NOT NULL');
  if (status === 'late') where.push("sml.compliance_status = 'returned_late'");

  const rows = db.prepare(`
    SELECT
      sml.*,
      s.name AS student_name,
      s.level AS student_level,
      s.hostel_status,
      s.dorm_house,
      s.room,
      s.bed_number,
      out_user.name AS recorded_out_by_name,
      in_user.name AS recorded_in_by_name,
      appr_user.name AS approved_by_name
    FROM student_movement_logs sml
    JOIN students s ON s.id = sml.student_id
    LEFT JOIN users out_user ON out_user.id = sml.recorded_out_by
    LEFT JOIN users in_user ON in_user.id = sml.recorded_in_by
    LEFT JOIN users appr_user ON appr_user.id = sml.approved_by
    WHERE ${where.join(' AND ')}
    ORDER BY sml.leave_time DESC, sml.id DESC
    LIMIT 300
  `).all(...params).map(serializeMovement);

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_logs,
      SUM(CASE WHEN return_time IS NULL THEN 1 ELSE 0 END) AS currently_out,
      SUM(CASE WHEN day_type = 'weekend' THEN 1 ELSE 0 END) AS weekend_logs,
      SUM(CASE WHEN compliance_status = 'returned_late' THEN 1 ELSE 0 END) AS late_returns
    FROM student_movement_logs
    WHERE date(leave_time) = ?
  `).get(targetDate);

  res.json({ date: targetDate, rows, summary });
});

router.get('/movements/self', requireAuth, requireRole('student'), (req, res) => {
  const student = getLinkedStudentForUser(req.user.id);
  if (!student) return res.status(404).json({ error: 'No student profile is linked to this account' });

  const rows = db.prepare(`
    SELECT
      sml.*,
      out_user.name AS recorded_out_by_name,
      in_user.name AS recorded_in_by_name,
      appr_user.name AS approved_by_name
    FROM student_movement_logs sml
    LEFT JOIN users out_user ON out_user.id = sml.recorded_out_by
    LEFT JOIN users in_user ON in_user.id = sml.recorded_in_by
    LEFT JOIN users appr_user ON appr_user.id = sml.approved_by
    WHERE sml.student_id = ?
    ORDER BY sml.leave_time DESC, sml.id DESC
    LIMIT 50
  `).all(student.id).map(serializeMovement);

  res.json({
    student,
    activeMovement: rows.find((row) => row.is_open) || null,
    rows,
  });
});

router.post('/movements/clock-out', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const studentId = Number.parseInt(req.body.student_id, 10);
  if (!studentId) return res.status(400).json({ error: 'Valid student_id is required' });

  const student = getActiveStudent(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (getOpenMovement(studentId)) {
    return res.status(400).json({ error: 'Student already has an open clock-out record' });
  }

  const leaveTimeText = normalizeDateTime(req.body.leave_time) || formatDateTime(new Date());
  const leaveTime = parseStoredDateTime(leaveTimeText);
  if (!leaveTime) return res.status(400).json({ error: 'Valid leave_time is required' });

  const dayType = getDayType(leaveTime);
  const destination = req.body.destination ? req.body.destination.toString().trim() : null;
  const reason = req.body.reason ? req.body.reason.toString().trim() : null;

  let approvalStatus = 'not_required';
  let expectedReturnTime = null;
  let approvedBy = null;
  let approvedAt = null;

  if (dayType === 'weekday') {
    const leaveMinutes = getMinutesSinceMidnight(leaveTime);
    if (leaveMinutes < WEEKDAY_CURFEW_START_MINUTES || leaveMinutes > WEEKDAY_CURFEW_END_MINUTES) {
      return res.status(400).json({ error: 'Weekday clock-out must be recorded between 3:00 PM and 6:00 PM' });
    }
    expectedReturnTime = weekdayCurfewDateTime(leaveTime);
  } else {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Weekend clock-out requires admin approval' });
    }
    approvalStatus = 'approved';
    approvedBy = req.user.id;
    approvedAt = leaveTimeText;
  }

  const result = createMovementLog({
    studentId,
    leaveTimeText,
    destination,
    reason,
    dayType,
    approvalStatus,
    expectedReturnTime,
    approvedBy,
    approvedAt,
    recordedOutBy: req.user.id,
  });

  audit(req.user.id, 'CLOCK_OUT', 'student_movement_logs', result.lastInsertRowid, `Clocked out ${student.name}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.post('/movements/self/clock-out', requireAuth, requireRole('student'), (req, res) => {
  const student = getLinkedStudentForUser(req.user.id);
  if (!student) return res.status(404).json({ error: 'No student profile is linked to this account' });
  if (getOpenMovement(student.id)) {
    return res.status(400).json({ error: 'You already have an open clock-out record' });
  }

  const leaveTimeText = normalizeDateTime(req.body.leave_time) || formatDateTime(new Date());
  const leaveTime = parseStoredDateTime(leaveTimeText);
  if (!leaveTime) return res.status(400).json({ error: 'Valid leave_time is required' });

  const dayType = getDayType(leaveTime);
  if (dayType === 'weekend') {
    return res.status(403).json({ error: 'Weekend outings must be approved and recorded by an admin' });
  }

  const leaveMinutes = getMinutesSinceMidnight(leaveTime);
  if (leaveMinutes < WEEKDAY_CURFEW_START_MINUTES || leaveMinutes > WEEKDAY_CURFEW_END_MINUTES) {
    return res.status(400).json({ error: 'Weekday clock-out is available only between 3:00 PM and 6:00 PM' });
  }

  const destination = req.body.destination ? req.body.destination.toString().trim() : null;
  const reason = req.body.reason ? req.body.reason.toString().trim() : null;
  const expectedReturnTime = weekdayCurfewDateTime(leaveTime);

  const result = createMovementLog({
    studentId: student.id,
    leaveTimeText,
    destination,
    reason,
    dayType,
    approvalStatus: 'not_required',
    expectedReturnTime,
    approvedBy: null,
    approvedAt: null,
    recordedOutBy: req.user.id,
  });

  audit(req.user.id, 'CLOCK_OUT_SELF', 'student_movement_logs', result.lastInsertRowid, `Self clock-out for ${student.name}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.post('/movements/:id(\\d+)/clock-in', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const movementId = Number.parseInt(req.params.id, 10);
  const movement = db.prepare(`
    SELECT sml.*, s.name AS student_name
    FROM student_movement_logs sml
    JOIN students s ON s.id = sml.student_id
    WHERE sml.id = ?
  `).get(movementId);

  if (!movement) return res.status(404).json({ error: 'Movement record not found' });
  if (movement.return_time) return res.status(400).json({ error: 'Student has already clocked back in' });

  const returnTimeText = normalizeDateTime(req.body.return_time) || formatDateTime(new Date());
  const returnTime = parseStoredDateTime(returnTimeText);
  const leaveTime = parseStoredDateTime(movement.leave_time);
  if (!returnTime) return res.status(400).json({ error: 'Valid return_time is required' });
  if (leaveTime && returnTime < leaveTime) {
    return res.status(400).json({ error: 'Return time cannot be earlier than leave time' });
  }

  let complianceStatus = 'returned_on_time';
  if (movement.day_type === 'weekday' && movement.expected_return_time) {
    const dueTime = parseStoredDateTime(movement.expected_return_time);
    if (dueTime && returnTime > dueTime) complianceStatus = 'returned_late';
  }

  db.prepare(`
    UPDATE student_movement_logs
    SET return_time = ?, compliance_status = ?, recorded_in_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(returnTimeText, complianceStatus, req.user.id, movementId);

  audit(req.user.id, 'CLOCK_IN', 'student_movement_logs', movementId, `Clocked in ${movement.student_name}`);
  res.json({ ok: true, compliance_status: complianceStatus });
});

router.post('/movements/self/:id(\\d+)/clock-in', requireAuth, requireRole('student'), (req, res) => {
  const student = getLinkedStudentForUser(req.user.id);
  if (!student) return res.status(404).json({ error: 'No student profile is linked to this account' });

  const movementId = Number.parseInt(req.params.id, 10);
  const movement = db.prepare(`
    SELECT *
    FROM student_movement_logs
    WHERE id = ? AND student_id = ?
  `).get(movementId, student.id);

  if (!movement) return res.status(404).json({ error: 'Movement record not found' });
  if (movement.return_time) return res.status(400).json({ error: 'You have already clocked back in for this outing' });

  const returnTimeText = normalizeDateTime(req.body.return_time) || formatDateTime(new Date());
  const returnTime = parseStoredDateTime(returnTimeText);
  const leaveTime = parseStoredDateTime(movement.leave_time);
  if (!returnTime) return res.status(400).json({ error: 'Valid return_time is required' });
  if (leaveTime && returnTime < leaveTime) {
    return res.status(400).json({ error: 'Return time cannot be earlier than leave time' });
  }

  let complianceStatus = 'returned_on_time';
  if (movement.day_type === 'weekday' && movement.expected_return_time) {
    const dueTime = parseStoredDateTime(movement.expected_return_time);
    if (dueTime && returnTime > dueTime) complianceStatus = 'returned_late';
  }

  db.prepare(`
    UPDATE student_movement_logs
    SET return_time = ?, compliance_status = ?, recorded_in_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(returnTimeText, complianceStatus, req.user.id, movementId);

  audit(req.user.id, 'CLOCK_IN_SELF', 'student_movement_logs', movementId, `Self clock-in for ${student.name}`);
  res.json({ ok: true, compliance_status: complianceStatus });
});

router.put('/hostel/:studentId(\\d+)', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const studentId = Number.parseInt(req.params.studentId, 10);
  const hostelStatus = (req.body.hostel_status || 'non_boarder').toString();
  const allowed = ['boarder', 'non_boarder', 'inactive'];
  if (!allowed.includes(hostelStatus)) return res.status(400).json({ error: 'Invalid hostel_status' });

  const student = db.prepare('SELECT id, name FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  db.prepare(`
    UPDATE students
    SET hostel_status = ?,
        dorm_house = ?,
        room = ?,
        bed_number = ?,
        notes = CASE WHEN ? IS NULL OR ? = '' THEN notes ELSE ? END
    WHERE id = ?
  `).run(
    hostelStatus,
    req.body.dorm_house ? req.body.dorm_house.toString().trim() : null,
    req.body.room ? req.body.room.toString().trim() : null,
    req.body.bed_number ? req.body.bed_number.toString().trim() : null,
    req.body.notes || null,
    req.body.notes || null,
    req.body.notes || null,
    studentId,
  );

  audit(req.user.id, 'UPDATE', 'students', studentId, `Updated hostel assignment for ${student.name}`);
  res.json({ ok: true });
});

router.get('/export/monthly', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = parseMonthYear(req);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      ar.attendance_date,
      s.name AS student_name,
      s.level,
      s.hostel_status,
      COALESCE(s.dorm_house, '') AS dorm_house,
      COALESCE(s.room, '') AS room,
      COALESCE(s.bed_number, '') AS bed_number,
      ar.status,
      COALESCE(ar.notes, '') AS notes,
      COALESCE(u.name, '') AS marked_by
    FROM attendance_records ar
    JOIN students s ON s.id = ar.student_id
    LEFT JOIN users u ON u.id = ar.marked_by
    WHERE ar.attendance_date BETWEEN ? AND ?
    ORDER BY ar.attendance_date, s.name
  `).all(start, end);

  const lines = [
    ['Date', 'Student', 'Level', 'Hostel Status', 'Dorm/House', 'Room', 'Bed', 'Status', 'Notes', 'Marked By'].join(','),
    ...rows.map((row) => [
      row.attendance_date,
      row.student_name,
      row.level,
      row.hostel_status,
      row.dorm_house,
      row.room,
      row.bed_number,
      row.status,
      row.notes.replaceAll('"', '""'),
      row.marked_by,
    ].map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')),
  ];

  const csv = lines.join('\n');
  const filename = `attendance_${year}_${String(month).padStart(2, '0')}.csv`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

module.exports = router;
