const { db } = require('../db/database');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toMonthYear(dateValue) {
  if (!dateValue || typeof dateValue !== 'string' || dateValue.length < 7) return null;
  const [year, month] = dateValue.slice(0, 7).split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function isPeriodClosed(year, month) {
  const row = db.prepare(`
    SELECT id
    FROM monthly_closings
    WHERE year = ? AND month = ? AND COALESCE(is_reopened, 0) = 0
  `).get(year, month);
  return !!row;
}

function assertPeriodOpen({ year, month, action = 'editing transactions' }) {
  if (!isPeriodClosed(year, month)) return null;
  return `Period ${MONTHS[month - 1]} ${year} is closed. Reopen the period before ${action}.`;
}

function assertDatePeriodOpen(dateValue, action) {
  const period = toMonthYear(dateValue);
  if (!period) return null;
  return assertPeriodOpen({ year: period.year, month: period.month, action });
}

module.exports = {
  toMonthYear,
  isPeriodClosed,
  assertPeriodOpen,
  assertDatePeriodOpen,
  MONTHS,
};
