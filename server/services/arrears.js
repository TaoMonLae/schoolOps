const { db } = require('../db/database');

function monthIndex(month, year) {
  return (year * 12) + (month - 1);
}

function calculateMonthlyOverdueMonths(student, paidCount, targetMonth, targetYear) {
  if (!student.enroll_date) return 0;

  const enrolledAt = new Date(`${student.enroll_date}T00:00:00Z`);
  if (Number.isNaN(enrolledAt.getTime())) return 0;

  const enrollMonth = enrolledAt.getUTCMonth() + 1;
  const enrollYear = enrolledAt.getUTCFullYear();

  const start = monthIndex(enrollMonth, enrollYear);
  const end = monthIndex(targetMonth, targetYear);
  if (end < start) return 0;

  const totalDue = (end - start) + 1;
  return Math.max(totalDue - paidCount, 0);
}

function buildArrearsRecords(month, year, opts = {}) {
  const { activeOnly = false } = opts;
  const usePagination = typeof opts.limit === 'number' && typeof opts.offset === 'number';
  const limit = opts.limit;
  const offset = opts.offset;

  // Build student query with optional pagination
  const studentParams = [];
  let studentQuery = `
    SELECT s.*, u.username AS linked_username, u.is_active AS linked_user_active, u.login_disabled AS linked_login_disabled
    FROM students s
    LEFT JOIN users u ON u.id = s.user_id
  `;
  if (activeOnly) {
    studentQuery += " WHERE s.status = 'active'";
  }
  studentQuery += " ORDER BY s.name";
  if (usePagination) {
    studentQuery += " LIMIT ? OFFSET ?";
    studentParams.push(limit, offset);
  }
  const students = db.prepare(studentQuery).all(...studentParams);

  // Get total count if pagination requested
  let total = null;
  if (usePagination) {
    let countQuery = "SELECT COUNT(*) as total FROM students s";
    if (activeOnly) {
      countQuery += " WHERE s.status = 'active'";
    }
    total = db.prepare(countQuery).get().total;
  }

  if (students.length === 0) {
    if (usePagination) return { total: 0, rows: [] };
    return [];
  }

  // Filter payments to only these students for efficiency
  const studentIds = students.map(s => s.id);
  const placeholders = studentIds.map(() => '?').join(',');
  const targetDate = year * 100 + month;

  // Get payments for these students only
  const paidByStudent = db.prepare(`
    SELECT
      fp.student_id,
      fp.period_month,
      fp.period_year,
      fp.amount
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    WHERE fp.voided = 0
      AND fp.period_year * 100 + fp.period_month <= ?
      AND fp.student_id IN (${placeholders})
      ${activeOnly ? "AND s.status = 'active'" : ''}
  `).all(targetDate, ...studentIds);

  // Get primary contacts for these students only
  const primaryContacts = db.prepare(`
    SELECT c.student_id, c.contact_name, c.phone, c.whatsapp, c.contact_type, c.relationship
    FROM student_contacts c
    JOIN (
      SELECT
        student_id,
        COALESCE(
          MIN(CASE WHEN is_active = 1 AND preferred_contact = 1 THEN id END),
          MIN(CASE WHEN is_active = 1 AND emergency_contact = 1 THEN id END),
          MIN(CASE WHEN is_active = 1 THEN id END)
        ) AS primary_id
      FROM student_contacts
      WHERE student_id IN (${placeholders})
      GROUP BY student_id
    ) picked ON picked.primary_id = c.id
  `).all(...studentIds);

  // Get contact search blobs for these students only
  const contactSearchRows = db.prepare(`
    SELECT
      student_id,
      lower(group_concat(COALESCE(contact_name, ''), ' ')) AS names_blob,
      lower(group_concat(COALESCE(phone, ''), ' ')) AS phones_blob,
      lower(group_concat(COALESCE(whatsapp, ''), ' ')) AS whatsapp_blob
    FROM student_contacts
    WHERE is_active = 1 AND student_id IN (${placeholders})
    GROUP BY student_id
  `).all(...studentIds);

  const paidPeriodsMap = new Map();
  const lastPaidMap = new Map();
  const paidThisMonthSet = new Set();

  for (const row of paidByStudent) {
    const key = String(row.student_id);
    if (!paidPeriodsMap.has(key)) paidPeriodsMap.set(key, new Set());
    paidPeriodsMap.get(key).add(`${row.period_year}-${row.period_month}`);

    const packed = (row.period_year * 100) + row.period_month;
    const currentLast = lastPaidMap.get(key);
    if (!currentLast || packed > currentLast.packed) {
      lastPaidMap.set(key, { packed, month: row.period_month, year: row.period_year });
    }

    if (row.period_month === month && row.period_year === year) {
      paidThisMonthSet.add(key);
    }
  }

  const primaryContactMap = new Map(primaryContacts.map((row) => [String(row.student_id), row]));
  const contactSearchMap = new Map(contactSearchRows.map((row) => [String(row.student_id), row]));

  const rows = students.map((student) => {
    const key = String(student.id);
    const paidPeriods = paidPeriodsMap.get(key) || new Set();
    const paidCount = paidPeriods.size;
    const paidThisMonth = paidThisMonthSet.has(key);
    const lastPaid = lastPaidMap.get(key) || null;

    let overdueMonths = 0;
    let outstandingAmount = 0;

    if (student.fee_frequency === 'monthly') {
      overdueMonths = calculateMonthlyOverdueMonths(student, paidCount, month, year);
      outstandingAmount = overdueMonths * Number(student.fee_amount || 0);
    }

    const arrearsStatus = overdueMonths >= 2
      ? 'serious'
      : overdueMonths === 1
        ? 'overdue'
        : 'current';
    const mainContact = primaryContactMap.get(key) || null;
    const searchContact = contactSearchMap.get(key) || null;

    return {
      ...student,
      current_month_status: paidThisMonth ? 'paid' : 'unpaid',
      overdue_months: overdueMonths,
      outstanding_amount: outstandingAmount,
      last_paid_month: lastPaid ? lastPaid.month : null,
      last_paid_year: lastPaid ? lastPaid.year : null,
      arrears_status: arrearsStatus,
      main_contact_name: mainContact ? mainContact.contact_name : null,
      main_contact_phone: mainContact ? mainContact.phone : null,
      main_contact_whatsapp: mainContact ? mainContact.whatsapp : null,
      main_contact_type: mainContact ? mainContact.contact_type : null,
      main_contact_relationship: mainContact ? mainContact.relationship : null,
      contact_search_blob: searchContact ? `${searchContact.names_blob || ''} ${searchContact.phones_blob || ''} ${searchContact.whatsapp_blob || ''}`.trim() : '',
    };
  });

  if (usePagination) {
    return { total, rows };
  }
  return rows;
}

module.exports = {
  buildArrearsRecords,
};
