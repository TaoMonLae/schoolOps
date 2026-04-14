const express  = require('express');
const XLSX      = require('xlsx');
const PDFDoc    = require('pdfkit');
const { db }    = require('../db/database');
const { buildArrearsRecords } = require('../services/arrears');
const { getSettings } = require('../services/settings');
const { requireAuth, requireRole } = require('../middleware/auth');
const { drawPdfLogo } = require('../services/pdfBranding');

const router = express.Router();

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];


function formatMoney(currency, amount) {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

function reportBranding() {
  const s = getSettings();
  return {
    school_name: s.school_name,
    subtitle: s.subtitle,
    report_footer_text: s.report_footer_text,
    currency: s.currency || 'RM',
    contact_block: s.contact_block || '',
    logo_url: s.logo_url || '',
  };
}

// ─── Query helpers ────────────────────────────────────────────────────────────
function getMonthlyData(month, year) {
  const m = String(month).padStart(2, '0');
  const y = String(year);

  // Active students
  const totalActive = db.prepare("SELECT COUNT(*) AS c FROM students WHERE status = 'active'").get().c;

  // Fee income
  const fees = db.prepare(`
    SELECT fp.*, s.name AS student_name, s.fee_amount AS expected_amount
    FROM fee_payments fp
    JOIN students s ON s.id = fp.student_id
    WHERE fp.period_month = ? AND fp.period_year = ? AND fp.voided = 0
    ORDER BY s.name
  `).all(month, year);

  const feeIncome    = fees.reduce((s, r) => s + r.amount, 0);
  const paidStudents = new Set(fees.map(r => r.student_id)).size;

  // Outstanding — active students who haven't paid this month
  const outstanding = db.prepare(`
    SELECT s.name, s.fee_amount
    FROM students s
    WHERE s.status = 'active'
      AND s.id NOT IN (
        SELECT student_id FROM fee_payments
        WHERE period_month = ? AND period_year = ? AND voided = 0
      )
  `).all(month, year);
  const outstandingTotal = outstanding.reduce((s, r) => s + r.fee_amount, 0);

  const arrearsRows = buildArrearsRecords(month, year, { activeOnly: true });
  const paidThisMonth = arrearsRows.filter(r => r.current_month_status === 'paid').length;
  const unpaidThisMonth = arrearsRows.filter(r => r.current_month_status === 'unpaid').length;
  const studentsInArrears = arrearsRows.filter(r => r.overdue_months > 0).length;
  const topOverdueStudents = arrearsRows
    .filter(r => r.overdue_months > 0)
    .sort((a, b) => (
      b.overdue_months - a.overdue_months ||
      b.outstanding_amount - a.outstanding_amount ||
      a.name.localeCompare(b.name)
    ))
    .slice(0, 8)
    .map(r => ({
      id: r.id,
      name: r.name,
      level: r.level,
      overdue_months: r.overdue_months,
      outstanding_amount: r.outstanding_amount,
      arrears_status: r.arrears_status,
    }));

  // Duty expenses (approved only)
  const dutyLogs = db.prepare(`
    SELECT dl.id, dl.duty_number, dl.date, dl.status,
           u.name AS submitted_by_name,
           COALESCE(att.attachment_count, 0) AS attachment_count,
           SUM(di.total_price) AS total
    FROM duty_logs dl
    JOIN users u ON u.id = dl.submitted_by
    JOIN duty_items di ON di.duty_log_id = dl.id
    LEFT JOIN (
      SELECT entity_id, COUNT(*) AS attachment_count
      FROM attachments
      WHERE entity_type = 'duty_log'
      GROUP BY entity_id
    ) att ON att.entity_id = dl.id
    WHERE strftime('%m', dl.date) = ?
      AND strftime('%Y', dl.date) = ?
      AND dl.status = 'approved'
    GROUP BY dl.id
    ORDER BY dl.date
  `).all(m, y);
  const dutyTotal = dutyLogs.reduce((s, r) => s + r.total, 0);

  // General expenditures by category
  const expenditures = db.prepare(`
    SELECT e.*, u.name AS added_by_name,
           COALESCE(att.attachment_count, 0) AS attachment_count
    FROM expenditures e
    LEFT JOIN users u ON u.id = e.added_by
    LEFT JOIN (
      SELECT entity_id, COUNT(*) AS attachment_count
      FROM attachments
      WHERE entity_type = 'expenditure'
      GROUP BY entity_id
    ) att ON att.entity_id = e.id
    WHERE strftime('%m', e.expense_date) = ?
      AND strftime('%Y', e.expense_date) = ?
    ORDER BY e.expense_date
  `).all(m, y);

  const byCategory = {};
  for (const e of expenditures) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }
  const expTotal = expenditures.reduce((s, r) => s + r.amount, 0);

  const totalExpenses = dutyTotal + expTotal;

  const branding = reportBranding();

  return {
    month, year,
    label: `${MONTHS[month - 1]} ${year}`,
    totalActive,
    feeIncome, paidStudents, outstandingTotal, outstanding,
    paidThisMonth, unpaidThisMonth, studentsInArrears, topOverdueStudents,
    fees,
    dutyTotal, dutyLogs,
    expTotal, byCategory, expenditures,
    totalExpenses,
    netBalance: feeIncome - totalExpenses,
    branding,
  };
}

function getYearlyData(year) {
  const monthly = [];
  const expenditureCategoryTotals = {};
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  // Don't query future months — they have no data and waste DB resources
  const maxMonth = (Number(year) === currentYear) ? currentMonth : 12;

  for (let month = 1; month <= maxMonth; month++) {
    const m = getMonthlyData(month, year);
    monthly.push({
      month,
      label: MONTHS[month - 1],
      feeIncome: m.feeIncome,
      totalExpenses: m.totalExpenses,
      netBalance: m.netBalance,
      outstandingTotal: m.outstandingTotal,
      paidStudents: m.paidThisMonth,
      unpaidStudents: m.unpaidThisMonth,
    });

    Object.entries(m.byCategory).forEach(([category, amount]) => {
      expenditureCategoryTotals[category] = (expenditureCategoryTotals[category] || 0) + amount;
    });
  }

  const totals = monthly.reduce((acc, row) => ({
    feeIncome: acc.feeIncome + row.feeIncome,
    totalExpenses: acc.totalExpenses + row.totalExpenses,
    netBalance: acc.netBalance + row.netBalance,
    outstandingTotal: acc.outstandingTotal + row.outstandingTotal,
  }), { feeIncome: 0, totalExpenses: 0, netBalance: 0, outstandingTotal: 0 });

  return {
    year,
    label: `${year}`,
    monthly,
    totals,
    expenditureCategoryTotals,
    branding: reportBranding(),
  };
}

function getTrendData(months = 12) {
  const cappedMonths = Math.max(1, Math.min(36, Number.parseInt(months, 10) || 12));
  const now = new Date();
  const points = [];

  for (let i = cappedMonths - 1; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = dt.getMonth() + 1;
    const year = dt.getFullYear();
    const m = getMonthlyData(month, year);

    points.push({
      month,
      year,
      label: `${MONTHS[month - 1].slice(0, 3)} ${year}`,
      feeIncome: m.feeIncome,
      expenses: m.totalExpenses,
      netBalance: m.netBalance,
      numberPaid: m.paidThisMonth,
      numberUnpaid: m.unpaidThisMonth,
      outstandingTotal: m.outstandingTotal,
    });
  }

  return {
    months: cappedMonths,
    points,
    branding: reportBranding(),
  };
}

function parseMonthYear(req) {
  const now = new Date();
  const parsedMonth = Number.parseInt(req.query.month, 10);
  const parsedYear = Number.parseInt(req.query.year, 10);
  return {
    month: Number.isNaN(parsedMonth) ? now.getMonth() + 1 : parsedMonth,
    year: Number.isNaN(parsedYear) ? now.getFullYear() : parsedYear,
  };
}

function parseYear(req) {
  const now = new Date();
  const parsedYear = Number.parseInt(req.query.year, 10);
  return Number.isNaN(parsedYear) ? now.getFullYear() : parsedYear;
}

function getStudentContactExportRows(search = '') {
  const q = `%${(search || '').toString().trim().toLowerCase()}%`;
  return db.prepare(`
    SELECT
      s.id AS student_id,
      s.name AS student_name,
      s.level AS student_level,
      s.status AS student_status,
      c.contact_name,
      c.relationship,
      c.contact_type,
      c.phone,
      c.whatsapp,
      c.address,
      c.emergency_contact,
      c.preferred_contact,
      c.is_active,
      c.notes
    FROM students s
    LEFT JOIN student_contacts c ON c.student_id = s.id
    WHERE (
      lower(s.name) LIKE ?
      OR lower(COALESCE(c.contact_name, '')) LIKE ?
      OR lower(COALESCE(c.phone, '')) LIKE ?
      OR lower(COALESCE(c.whatsapp, '')) LIKE ?
    )
    ORDER BY s.name, c.preferred_contact DESC, c.emergency_contact DESC, c.contact_name
  `).all(q, q, q, q);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/reports/monthly?month=&year=
router.get('/monthly', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = parseMonthYear(req);
  res.json(getMonthlyData(month, year));
});

// GET /api/reports/yearly?year=
router.get('/yearly', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const year = parseYear(req);
  res.json(getYearlyData(year));
});

// GET /api/reports/trends?months=12
router.get('/trends', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  res.json(getTrendData(req.query.months));
});


// GET /api/reports/stock/current
router.get('/stock/current', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.name, i.unit, i.current_stock, i.reorder_level, i.notes, i.is_active,
           c.name AS category_name,
           CASE WHEN i.current_stock <= i.reorder_level THEN 1 ELSE 0 END AS is_low_stock
    FROM inventory_items i
    LEFT JOIN stock_categories c ON c.id = i.category_id
    WHERE i.is_active = 1
    ORDER BY c.name, i.name
  `).all();

  res.json({
    generated_at: new Date().toISOString(),
    total_items: rows.length,
    low_stock_items: rows.filter(r => r.is_low_stock).length,
    rows,
  });
});

// GET /api/reports/stock/monthly-summary?month=&year=
router.get('/stock/monthly-summary', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = parseMonthYear(req);
  const mm = String(month).padStart(2, '0');
  const yy = String(year);

  const byType = db.prepare(`
    SELECT movement_type, COUNT(*) AS movement_count,
           SUM(CASE WHEN movement_type = 'adjustment' THEN ABS(quantity) ELSE ABS(quantity) END) AS total_quantity
    FROM stock_movements
    WHERE strftime('%m', movement_date) = ? AND strftime('%Y', movement_date) = ?
    GROUP BY movement_type
    ORDER BY movement_type
  `).all(mm, yy);

  const byItem = db.prepare(`
    SELECT i.name AS item_name, i.unit,
           SUM(CASE WHEN sm.movement_type = 'purchase' THEN ABS(sm.quantity) ELSE 0 END) AS purchased,
           SUM(CASE WHEN sm.movement_type = 'usage' THEN ABS(sm.quantity) ELSE 0 END) AS used,
           SUM(CASE WHEN sm.movement_type = 'waste' THEN ABS(sm.quantity) ELSE 0 END) AS wasted,
           SUM(CASE WHEN sm.movement_type = 'adjustment' THEN sm.quantity ELSE 0 END) AS adjusted_net
    FROM stock_movements sm
    JOIN inventory_items i ON i.id = sm.item_id
    WHERE strftime('%m', sm.movement_date) = ? AND strftime('%Y', sm.movement_date) = ?
    GROUP BY sm.item_id
    ORDER BY i.name
  `).all(mm, yy);

  res.json({
    month,
    year,
    label: `${MONTHS[month - 1]} ${year}`,
    byType,
    byItem,
  });
});

// GET /api/reports/export/unpaid-excel?month=&year=&status=&search=
router.get('/export/unpaid-excel', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = parseMonthYear(req);

  const q = (req.query.search || '').toString().trim().toLowerCase();

  let rows = buildArrearsRecords(month, year, { activeOnly: true }).filter(r => r.current_month_status === 'unpaid');

  if (req.query.status === 'overdue') {
    rows = rows.filter(r => r.overdue_months === 1);
  } else if (req.query.status === 'serious') {
    rows = rows.filter(r => r.overdue_months >= 2);
  } else if (req.query.status === 'current') {
    rows = rows.filter(r => r.overdue_months === 0);
  }

  if (q) {
    rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.level.toLowerCase().includes(q));
  }

  const wb = XLSX.utils.book_new();
  const sheetRows = [
    ['Student Name', 'Level', 'Monthly Fee', 'Overdue Months', 'Total Outstanding'],
    ...rows.map(r => [r.name, r.level, r.fee_amount, r.overdue_months, r.outstanding_amount]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Unpaid Students');

  const filename = `Unpaid_${year}_${String(month).padStart(2, '0')}.xlsx`;
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/reports/export/student-contacts-excel?search=
router.get('/export/student-contacts-excel', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const rows = getStudentContactExportRows(req.query.search);
  const wb = XLSX.utils.book_new();
  const sheetRows = [
    [
      'Student Name',
      'Level',
      'Student Status',
      'Contact Name',
      'Relationship',
      'Contact Type',
      'Phone',
      'WhatsApp',
      'Address',
      'Emergency Contact',
      'Preferred Contact',
      'Contact Status',
      'Notes',
    ],
    ...rows.map((row) => ([
      row.student_name,
      row.student_level,
      row.student_status,
      row.contact_name || '',
      row.relationship || '',
      row.contact_type || '',
      row.phone || '',
      row.whatsapp || '',
      row.address || '',
      row.emergency_contact ? 'Yes' : 'No',
      row.preferred_contact ? 'Yes' : 'No',
      row.is_active === 0 ? 'Inactive' : 'Active',
      row.notes || '',
    ])),
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws['!cols'] = [
    { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 18 },
    { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Student Contacts');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = 'Student_Guardian_Contacts.xlsx';
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/reports/export/excel?month=&year=
router.get('/export/excel', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = parseMonthYear(req);
  const d = getMonthlyData(month, year);

  const wb = XLSX.utils.book_new();
  const branding = reportBranding();
  const currency = branding.currency;

  // ── Sheet 1: Summary ──
  const summaryData = [
    [`${branding.school_name} Monthly Financial Report — ${d.label}`],
    [branding.subtitle],
    [branding.contact_block],
    [],
    ['INCOME'],
    ['Fee Payments Collected', formatMoney(currency, d.feeIncome)],
    ['No. of Students Paid',   d.paidStudents],
    ['Outstanding Balances',   formatMoney(currency, d.outstandingTotal)],
    [],
    ['EXPENSES'],
    ['Daily Duty (Cooking/Cleaning)', formatMoney(currency, d.dutyTotal)],
    ['Utilities',   formatMoney(currency, d.byCategory.utilities || 0)],
    ['Supplies',    formatMoney(currency, d.byCategory.supplies || 0)],
    ['Transport',   formatMoney(currency, d.byCategory.transport || 0)],
    ['Rent',        formatMoney(currency, d.byCategory.rent || 0)],
    ['Food',        formatMoney(currency, d.byCategory.food || 0)],
    ['Cleaning',    formatMoney(currency, d.byCategory.cleaning || 0)],
    ['Other',       formatMoney(currency, d.byCategory.other || 0)],
    ['Total Expenses', formatMoney(currency, d.totalExpenses)],
    [],
    ['NET BALANCE'],
    ['Income − Expenses', formatMoney(currency, d.netBalance)],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 35 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // ── Sheet 2: Fee Payments ──
  const feeRows = [
    ['Student', 'Amount (RM)', 'Paid Date', 'Method', 'Period'],
    ...d.fees.map(f => [
      f.student_name,
      f.amount,
      f.paid_date,
      f.method,
      `${MONTHS[f.period_month - 1]} ${f.period_year}`,
    ]),
    [],
    ['TOTAL', d.feeIncome],
  ];
  const wsFees = XLSX.utils.aoa_to_sheet(feeRows);
  wsFees['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsFees, 'Fee Payments');

  // ── Sheet 3: Outstanding ──
  const outRows = [
    ['Student', 'Monthly Fee (RM)'],
    ...d.outstanding.map(o => [o.name, o.fee_amount]),
    [],
    ['TOTAL OUTSTANDING', d.outstandingTotal],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(outRows), 'Outstanding');

  // ── Sheet 4: Duty Logs ──
  const dutyRows = [
    ['Duty No.', 'Date', 'Submitted By', 'Total (RM)', 'Attachments'],
    ...d.dutyLogs.map(dl => [dl.duty_number, dl.date, dl.submitted_by_name, dl.total, dl.attachment_count]),
    [],
    ['TOTAL DUTY', '', '', d.dutyTotal],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dutyRows), 'Duty Logs');

  // ── Sheet 5: Expenditures ──
  const expRows = [
    ['Date', 'Category', 'Description', 'Amount (RM)', 'Receipt Ref', 'Attachments'],
    ...d.expenditures.map(e => [e.expense_date, e.category, e.description, e.amount, e.receipt_ref || '', e.attachment_count]),
    [],
    ['TOTAL', '', '', d.expTotal],
  ];
  const wsExp = XLSX.utils.aoa_to_sheet(expRows);
  wsExp['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsExp, 'Expenditures');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `Report_${year}_${String(month).padStart(2,'0')}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/reports/export/yearly-excel?year=
router.get('/export/yearly-excel', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const year = parseYear(req);
  const d = getYearlyData(year);

  const wb = XLSX.utils.book_new();
  const branding = reportBranding();

  const summaryRows = [
    [`${branding.school_name} Yearly Financial Summary — ${year}`],
    [branding.subtitle],
    [branding.contact_block],
    [],
    ['Metric', 'Amount (RM)'],
    ['Total Fee Income', d.totals.feeIncome],
    ['Total Expenses', d.totals.totalExpenses],
    ['Net Balance', d.totals.netBalance],
    ['Cumulative Outstanding', d.totals.outstandingTotal],
    [],
    ['Expenditure Category', 'Total (RM)'],
    ...Object.entries(d.expenditureCategoryTotals).map(([category, amount]) => [category, amount]),
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 32 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Yearly Summary');

  const monthRows = [
    ['Month', 'Fee Income', 'Expenses', 'Net Balance', 'Outstanding', 'Paid', 'Unpaid'],
    ...d.monthly.map(row => [
      row.label,
      row.feeIncome,
      row.totalExpenses,
      row.netBalance,
      row.outstandingTotal,
      row.paidStudents,
      row.unpaidStudents,
    ]),
  ];
  const wsMonthly = XLSX.utils.aoa_to_sheet(monthRows);
  wsMonthly['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'By Month');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `Yearly_Report_${year}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/reports/export/pdf?month=&year=
router.get('/export/pdf', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = parseMonthYear(req);
  const d = getMonthlyData(month, year);

  const branding = reportBranding();
  const currency = branding.currency;

  const filename = `Report_${year}_${String(month).padStart(2,'0')}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  const doc = new PDFDoc({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const green  = '#1a7a4a';
  const red    = '#c0392b';
  const dark   = '#1a1a2e';
  const mid    = '#666666';

  // ── Header ──
  doc.rect(0, 0, doc.page.width, 80).fill(green);
  const titleX = drawPdfLogo(doc, branding.logo_url, { x: 50, y: 18, size: 42 }) || 50;
  doc.fillColor('white').fontSize(18).font('Helvetica-Bold')
     .text(branding.school_name, titleX, 20);
  doc.fontSize(12).font('Helvetica')
     .text(`${branding.subtitle} — ${d.label}`, titleX, 45);
  if (branding.contact_block) {
    doc.fontSize(9).font('Helvetica').text(branding.contact_block, 50, 62, { width: doc.page.width - 100, align: 'right' });
  }
  doc.fillColor(dark);

  let y = 100;

  function sectionTitle(title, color = green) {
    doc.rect(50, y, doc.page.width - 100, 22).fill(color);
    doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
       .text(title, 58, y + 6);
    doc.fillColor(dark);
    y += 30;
  }

  function row(label, value, bold = false) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    doc.text(label, 58,  y);
    doc.text(value, 400, y, { width: 120, align: 'right' });
    y += 18;
  }

  function divider() {
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#cccccc').stroke();
    y += 10;
  }

  // ── Income ──
  sectionTitle('INCOME');
  row('Fee Payments Collected',  formatMoney(currency, d.feeIncome));
  row('No. of Students Paid',    String(d.paidStudents));
  row('Outstanding Balances',    formatMoney(currency, d.outstandingTotal), false);
  divider();

  // ── Expenses ──
  sectionTitle('EXPENSES', '#8b0000');
  row('Daily Duty (Cooking/Cleaning)', formatMoney(currency, d.dutyTotal));
  row('Utilities',  formatMoney(currency, d.byCategory.utilities || 0));
  row('Supplies',   formatMoney(currency, d.byCategory.supplies || 0));
  row('Transport',  formatMoney(currency, d.byCategory.transport || 0));
  row('Rent',       formatMoney(currency, d.byCategory.rent || 0));
  row('Food',       formatMoney(currency, d.byCategory.food || 0));
  row('Cleaning',   formatMoney(currency, d.byCategory.cleaning || 0));
  row('Other',      formatMoney(currency, d.byCategory.other || 0));
  divider();
  row('Total Expenses', formatMoney(currency, d.totalExpenses), true);
  y += 8;

  // ── Net Balance ──
  const balColor = d.netBalance >= 0 ? green : red;
  doc.rect(50, y, doc.page.width - 100, 30).fill(balColor);
  doc.fillColor('white').fontSize(12).font('Helvetica-Bold')
     .text('NET BALANCE (Income − Expenses)', 58, y + 9);
  doc.text(formatMoney(currency, d.netBalance), 400, y + 9, { width: 120, align: 'right' });
  doc.fillColor(dark);
  y += 45;

  // ── Appendix A: Duty Logs ──
  if (y > doc.page.height - 150) { doc.addPage(); y = 50; }
  sectionTitle('APPENDIX A — Duty Log Detail');
  if (d.dutyLogs.length === 0) {
    doc.fontSize(9).text('No approved duty logs for this period.', 58, y); y += 20;
  } else {
    doc.fontSize(9).font('Helvetica-Bold')
       .text('Duty No.',    58,  y).text('Date',       170, y)
       .text('Submitted By',250, y).text(`Total (${currency})`, 390, y, { width: 70, align: 'right' })
       .text('Att.', 470, y, { width: 50, align: 'right' });
    doc.font('Helvetica'); y += 14;
    for (const dl of d.dutyLogs) {
      if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
      doc.text(dl.duty_number,      58,  y)
         .text(dl.date,             170, y)
         .text(dl.submitted_by_name,250, y)
         .text(Number(dl.total || 0).toFixed(2), 390, y, { width: 70, align: 'right' })
         .text(String(dl.attachment_count || 0), 470, y, { width: 50, align: 'right' });
      y += 14;
    }
  }
  y += 10;

  // ── Appendix B: Fee Payments ──
  if (y > doc.page.height - 150) { doc.addPage(); y = 50; }
  sectionTitle('APPENDIX B — Fee Payment List');
  if (d.fees.length === 0) {
    doc.fontSize(9).text('No fee payments recorded for this period.', 58, y); y += 20;
  } else {
    doc.fontSize(9).font('Helvetica-Bold')
       .text('Student',    58,  y).text(`Amount (${currency})`, 210, y)
       .text('Paid Date',  310, y).text('Method',      400, y);
    doc.font('Helvetica'); y += 14;
    for (const f of d.fees) {
      if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
      doc.text(f.student_name,  58,  y)
         .text(f.amount.toFixed(2), 210, y)
         .text(f.paid_date,     310, y)
         .text(f.method,        400, y);
      y += 14;
    }
  }
  y += 10;

  // ── Appendix C: Expenditures ──
  if (y > doc.page.height - 150) { doc.addPage(); y = 50; }
  sectionTitle('APPENDIX C — Expenditure List');
  if (d.expenditures.length === 0) {
    doc.fontSize(9).text('No expenditures recorded for this period.', 58, y); y += 20;
  } else {
    doc.fontSize(9).font('Helvetica-Bold')
       .text('Date',     58,  y).text('Category', 130, y)
       .text('Description', 200, y).text(`Amount (${currency})`, 390, y, { width: 70, align: 'right' })
       .text('Att.', 470, y, { width: 50, align: 'right' });
    doc.font('Helvetica'); y += 14;
    for (const e of d.expenditures) {
      if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
      doc.text(e.expense_date,  58,  y)
         .text(e.category,      130, y)
         .text(e.description,   200, y, { width: 180 })
         .text(e.amount.toFixed(2), 390, y, { width: 70, align: 'right' })
         .text(String(e.attachment_count || 0), 470, y, { width: 50, align: 'right' });
      y += 14;
    }
  }

  // ── Footer ──
  doc.fontSize(8).fillColor(mid)
     .text(`${branding.report_footer_text} • Generated: ${new Date().toLocaleString('en-MY')}`, 50, doc.page.height - 40, {
       align: 'center', width: doc.page.width - 100,
     });

  doc.end();
});

// GET /api/reports/export/trends-excel?months=
router.get('/export/trends-excel', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const d = getTrendData(req.query.months);
  const branding = reportBranding();

  const wb = XLSX.utils.book_new();

  const summaryRows = [
    [`${branding.school_name} — Trends Report (Last ${d.months} Months)`],
    [branding.subtitle],
    [],
    ['Month', 'Fee Income', 'Expenses', 'Net Balance', 'Outstanding', 'Paid', 'Unpaid'],
    ...d.points.map(p => [p.label, p.feeIncome, p.expenses, p.netBalance, p.outstandingTotal, p.numberPaid, p.numberUnpaid]),
    [],
    ['TOTALS',
      d.points.reduce((s, p) => s + p.feeIncome, 0),
      d.points.reduce((s, p) => s + p.expenses, 0),
      d.points.reduce((s, p) => s + p.netBalance, 0),
      '',
      d.points.reduce((s, p) => s + p.numberPaid, 0),
      d.points.reduce((s, p) => s + p.numberUnpaid, 0),
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet(summaryRows);
  ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Trends');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `Trends_Report_${d.months}months.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/reports/export/stock-current-excel
router.get('/export/stock-current-excel', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.name, i.unit, i.current_stock, i.reorder_level, i.notes,
           c.name AS category_name,
           CASE WHEN i.current_stock <= i.reorder_level THEN 1 ELSE 0 END AS is_low_stock
    FROM inventory_items i
    LEFT JOIN stock_categories c ON c.id = i.category_id
    WHERE i.is_active = 1
    ORDER BY c.name, i.name
  `).all();

  const branding = reportBranding();
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().slice(0, 10);

  const sheetRows = [
    [`${branding.school_name} — Current Stock Report`],
    [`Generated: ${today}`],
    [],
    ['Item', 'Category', 'Current Stock', 'Unit', 'Reorder Level', 'Low Stock?', 'Notes'],
    ...rows.map(r => [
      r.name,
      r.category_name || '',
      r.current_stock,
      r.unit,
      r.reorder_level,
      r.is_low_stock ? 'YES' : 'No',
      r.notes || '',
    ]),
    [],
    ['Total Items', rows.length],
    ['Low Stock Items', rows.filter(r => r.is_low_stock).length],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Current');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `Stock_Current_${today}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/reports/export/stock-monthly-excel?month=&year=
router.get('/export/stock-monthly-excel', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = parseMonthYear(req);
  const mm = String(month).padStart(2, '0');
  const yy = String(year);
  const label = `${MONTHS[month - 1]} ${year}`;

  const byType = db.prepare(`
    SELECT movement_type, COUNT(*) AS movement_count,
           SUM(ABS(quantity)) AS total_quantity
    FROM stock_movements
    WHERE strftime('%m', movement_date) = ? AND strftime('%Y', movement_date) = ?
    GROUP BY movement_type
    ORDER BY movement_type
  `).all(mm, yy);

  const byItem = db.prepare(`
    SELECT i.name AS item_name, i.unit,
           SUM(CASE WHEN sm.movement_type = 'purchase' THEN ABS(sm.quantity) ELSE 0 END) AS purchased,
           SUM(CASE WHEN sm.movement_type = 'usage' THEN ABS(sm.quantity) ELSE 0 END) AS used,
           SUM(CASE WHEN sm.movement_type = 'waste' THEN ABS(sm.quantity) ELSE 0 END) AS wasted,
           SUM(CASE WHEN sm.movement_type = 'adjustment' THEN sm.quantity ELSE 0 END) AS adjusted_net
    FROM stock_movements sm
    JOIN inventory_items i ON i.id = sm.item_id
    WHERE strftime('%m', sm.movement_date) = ? AND strftime('%Y', sm.movement_date) = ?
    GROUP BY sm.item_id
    ORDER BY i.name
  `).all(mm, yy);

  const branding = reportBranding();
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    [`${branding.school_name} — Stock Monthly Summary: ${label}`],
    [],
    ['Movement Type', 'Count', 'Total Quantity'],
    ...byType.map(r => [r.movement_type, r.movement_count, r.total_quantity]),
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'By Type');

  const itemRows = [
    [`${branding.school_name} — Stock by Item: ${label}`],
    [],
    ['Item', 'Unit', 'Purchased', 'Used', 'Wasted', 'Adjustment Net'],
    ...byItem.map(r => [r.item_name, r.unit, r.purchased, r.used, r.wasted, r.adjusted_net]),
  ];
  const wsItems = XLSX.utils.aoa_to_sheet(itemRows);
  wsItems['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsItems, 'By Item');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `Stock_${year}_${mm}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/reports/export/yearly-pdf?year=
router.get('/export/yearly-pdf', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const year = parseYear(req);
  const d = getYearlyData(year);
  const branding = reportBranding();
  const currency = branding.currency;

  const filename = `Yearly_Report_${year}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  const doc = new PDFDoc({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const green = '#1a7a4a';
  const dark  = '#1a1a2e';
  const mid   = '#666666';

  doc.rect(0, 0, doc.page.width, 80).fill(green);
  const titleX = drawPdfLogo(doc, branding.logo_url, { x: 50, y: 18, size: 42 }) || 50;
  doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text(branding.school_name, titleX, 20);
  doc.fontSize(12).font('Helvetica').text(`${branding.subtitle} — Yearly Report ${year}`, titleX, 45);
  doc.fillColor(dark);

  let y = 100;

  function sectionTitle(title, color = green) {
    doc.rect(50, y, doc.page.width - 100, 22).fill(color);
    doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text(title, 58, y + 6);
    doc.fillColor(dark);
    y += 30;
  }

  // Totals summary
  sectionTitle('YEARLY TOTALS');
  doc.fontSize(10).font('Helvetica');
  const totalPairs = [
    ['Total Fee Income', formatMoney(currency, d.totals.feeIncome)],
    ['Total Expenses', formatMoney(currency, d.totals.totalExpenses)],
    ['Net Balance', formatMoney(currency, d.totals.netBalance)],
    ['Cumulative Outstanding', formatMoney(currency, d.totals.outstandingTotal)],
  ];
  for (const [label, value] of totalPairs) {
    doc.text(label, 58, y);
    doc.text(value, 400, y, { width: 120, align: 'right' });
    y += 18;
  }
  y += 10;

  // Monthly breakdown table
  if (y > doc.page.height - 200) { doc.addPage(); y = 50; }
  sectionTitle('MONTH-BY-MONTH BREAKDOWN');
  doc.fontSize(9).font('Helvetica-Bold')
     .text('Month', 58, y).text('Fee Income', 150, y).text('Expenses', 230, y)
     .text('Net Balance', 310, y).text('Outstanding', 390, y).text('Paid', 470, y, { width: 30, align: 'right' });
  doc.font('Helvetica');
  y += 14;
  for (const row of d.monthly) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
    doc.text(row.label, 58, y)
       .text(formatMoney(currency, row.feeIncome), 150, y)
       .text(formatMoney(currency, row.totalExpenses), 230, y)
       .text(formatMoney(currency, row.netBalance), 310, y)
       .text(formatMoney(currency, row.outstandingTotal), 390, y)
       .text(String(row.paidStudents), 470, y, { width: 30, align: 'right' });
    y += 14;
  }
  // Totals row
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#cccccc').stroke();
  y += 6;
  doc.font('Helvetica-Bold')
     .text('TOTAL', 58, y)
     .text(formatMoney(currency, d.totals.feeIncome), 150, y)
     .text(formatMoney(currency, d.totals.totalExpenses), 230, y)
     .text(formatMoney(currency, d.totals.netBalance), 310, y)
     .text(formatMoney(currency, d.totals.outstandingTotal), 390, y);
  y += 20;

  // Expenditure category totals
  if (Object.keys(d.expenditureCategoryTotals).length > 0) {
    if (y > doc.page.height - 150) { doc.addPage(); y = 50; }
    sectionTitle('EXPENDITURE CATEGORY TOTALS');
    doc.fontSize(9).font('Helvetica');
    for (const [cat, total] of Object.entries(d.expenditureCategoryTotals)) {
      if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
      doc.text(cat.charAt(0).toUpperCase() + cat.slice(1), 58, y);
      doc.text(formatMoney(currency, total), 400, y, { width: 120, align: 'right' });
      y += 16;
    }
  }

  doc.fontSize(8).fillColor(mid)
     .text(`${branding.report_footer_text} • Generated: ${new Date().toLocaleString('en-MY')}`, 50, doc.page.height - 40, {
       align: 'center', width: doc.page.width - 100,
     });

  doc.end();
});

// GET /api/reports/export/trends-pdf?months=
router.get('/export/trends-pdf', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const d = getTrendData(req.query.months);
  const branding = reportBranding();
  const currency = branding.currency;

  const filename = `Trends_Report_${d.months}months.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  const doc = new PDFDoc({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const green = '#1a7a4a';
  const dark  = '#1a1a2e';
  const mid   = '#666666';

  doc.rect(0, 0, doc.page.width, 80).fill('#2c3e50');
  const titleX = drawPdfLogo(doc, branding.logo_url, { x: 50, y: 18, size: 42 }) || 50;
  doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text(branding.school_name, titleX, 20);
  doc.fontSize(12).font('Helvetica').text(`${branding.subtitle} — Trends Report (Last ${d.months} Months)`, titleX, 45);
  doc.fillColor(dark);

  let y = 100;

  const totals = d.points.reduce((acc, p) => ({
    feeIncome: acc.feeIncome + p.feeIncome,
    expenses: acc.expenses + p.expenses,
    netBalance: acc.netBalance + p.netBalance,
    numberPaid: acc.numberPaid + p.numberPaid,
    numberUnpaid: acc.numberUnpaid + p.numberUnpaid,
  }), { feeIncome: 0, expenses: 0, netBalance: 0, numberPaid: 0, numberUnpaid: 0 });

  // Totals summary
  doc.rect(50, y, doc.page.width - 100, 22).fill(green);
  doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text('PERIOD TOTALS', 58, y + 6);
  doc.fillColor(dark);
  y += 30;
  doc.fontSize(10).font('Helvetica');
  doc.text('Total Fee Income', 58, y); doc.text(formatMoney(currency, totals.feeIncome), 400, y, { width: 120, align: 'right' }); y += 18;
  doc.text('Total Expenses', 58, y); doc.text(formatMoney(currency, totals.expenses), 400, y, { width: 120, align: 'right' }); y += 18;
  doc.text('Net Balance', 58, y); doc.text(formatMoney(currency, totals.netBalance), 400, y, { width: 120, align: 'right' }); y += 18;
  doc.text('Total Paid Count', 58, y); doc.text(String(totals.numberPaid), 400, y, { width: 120, align: 'right' }); y += 18;
  doc.text('Total Unpaid Count', 58, y); doc.text(String(totals.numberUnpaid), 400, y, { width: 120, align: 'right' }); y += 24;

  // Trend table
  if (y > doc.page.height - 200) { doc.addPage(); y = 50; }
  doc.rect(50, y, doc.page.width - 100, 22).fill(green);
  doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text('MONTHLY TREND DATA', 58, y + 6);
  doc.fillColor(dark);
  y += 30;

  doc.fontSize(9).font('Helvetica-Bold')
     .text('Month', 58, y).text('Fee Income', 150, y).text('Expenses', 235, y)
     .text('Net Balance', 320, y).text('Paid', 405, y, { width: 35, align: 'right' })
     .text('Unpaid', 450, y, { width: 40, align: 'right' });
  doc.font('Helvetica');
  y += 14;
  for (const p of d.points) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
    doc.text(p.label, 58, y)
       .text(formatMoney(currency, p.feeIncome), 150, y)
       .text(formatMoney(currency, p.expenses), 235, y)
       .text(formatMoney(currency, p.netBalance), 320, y)
       .text(String(p.numberPaid), 405, y, { width: 35, align: 'right' })
       .text(String(p.numberUnpaid), 450, y, { width: 40, align: 'right' });
    y += 14;
  }

  doc.fontSize(8).fillColor(mid)
     .text(`${branding.report_footer_text} • Generated: ${new Date().toLocaleString('en-MY')}`, 50, doc.page.height - 40, {
       align: 'center', width: doc.page.width - 100,
     });

  doc.end();
});

// GET /api/reports/export/stock-current-pdf
router.get('/export/stock-current-pdf', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.name, i.unit, i.current_stock, i.reorder_level, i.notes,
           c.name AS category_name,
           CASE WHEN i.current_stock <= i.reorder_level THEN 1 ELSE 0 END AS is_low_stock
    FROM inventory_items i
    LEFT JOIN stock_categories c ON c.id = i.category_id
    WHERE i.is_active = 1
    ORDER BY c.name, i.name
  `).all();

  const branding = reportBranding();
  const today = new Date().toISOString().slice(0, 10);

  const filename = `Stock_Current_${today}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  const doc = new PDFDoc({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const green = '#1a7a4a';
  const red   = '#c0392b';
  const dark  = '#1a1a2e';
  const mid   = '#666666';

  doc.rect(0, 0, doc.page.width, 80).fill('#16a085');
  const titleX = drawPdfLogo(doc, branding.logo_url, { x: 50, y: 18, size: 42 }) || 50;
  doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text(branding.school_name, titleX, 20);
  doc.fontSize(12).font('Helvetica').text(`${branding.subtitle} — Current Stock Report — ${today}`, titleX, 45);
  doc.fillColor(dark);

  let y = 100;

  doc.fontSize(10).font('Helvetica');
  doc.text(`Total Items: ${rows.length}`, 58, y);
  doc.fillColor(red).text(`Low Stock: ${rows.filter(r => r.is_low_stock).length}`, 200, y);
  doc.fillColor(dark);
  y += 24;

  doc.rect(50, y, doc.page.width - 100, 22).fill(green);
  doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text('INVENTORY ITEMS', 58, y + 6);
  doc.fillColor(dark);
  y += 30;

  doc.fontSize(9).font('Helvetica-Bold')
     .text('Item', 58, y).text('Category', 200, y).text('Stock', 310, y, { width: 50, align: 'right' })
     .text('Unit', 370, y).text('Reorder', 420, y, { width: 50, align: 'right' }).text('Status', 480, y);
  doc.font('Helvetica');
  y += 14;

  for (const r of rows) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
    if (r.is_low_stock) doc.fillColor(red); else doc.fillColor(dark);
    doc.text(r.name, 58, y)
       .text(r.category_name || '', 200, y)
       .text(String(r.current_stock), 310, y, { width: 50, align: 'right' })
       .text(r.unit, 370, y)
       .text(String(r.reorder_level), 420, y, { width: 50, align: 'right' })
       .text(r.is_low_stock ? 'LOW' : 'OK', 480, y);
    doc.fillColor(dark);
    y += 14;
  }

  doc.fontSize(8).fillColor(mid)
     .text(`${branding.report_footer_text} • Generated: ${new Date().toLocaleString('en-MY')}`, 50, doc.page.height - 40, {
       align: 'center', width: doc.page.width - 100,
     });

  doc.end();
});

// GET /api/reports/export/stock-monthly-pdf?month=&year=
router.get('/export/stock-monthly-pdf', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = parseMonthYear(req);
  const mm = String(month).padStart(2, '0');
  const yy = String(year);
  const label = `${MONTHS[month - 1]} ${year}`;

  const byType = db.prepare(`
    SELECT movement_type, COUNT(*) AS movement_count,
           SUM(ABS(quantity)) AS total_quantity
    FROM stock_movements
    WHERE strftime('%m', movement_date) = ? AND strftime('%Y', movement_date) = ?
    GROUP BY movement_type
    ORDER BY movement_type
  `).all(mm, yy);

  const byItem = db.prepare(`
    SELECT i.name AS item_name, i.unit,
           SUM(CASE WHEN sm.movement_type = 'purchase' THEN ABS(sm.quantity) ELSE 0 END) AS purchased,
           SUM(CASE WHEN sm.movement_type = 'usage' THEN ABS(sm.quantity) ELSE 0 END) AS used,
           SUM(CASE WHEN sm.movement_type = 'waste' THEN ABS(sm.quantity) ELSE 0 END) AS wasted,
           SUM(CASE WHEN sm.movement_type = 'adjustment' THEN sm.quantity ELSE 0 END) AS adjusted_net
    FROM stock_movements sm
    JOIN inventory_items i ON i.id = sm.item_id
    WHERE strftime('%m', sm.movement_date) = ? AND strftime('%Y', sm.movement_date) = ?
    GROUP BY sm.item_id
    ORDER BY i.name
  `).all(mm, yy);

  const branding = reportBranding();

  const filename = `Stock_${year}_${mm}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  const doc = new PDFDoc({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const green = '#1a7a4a';
  const dark  = '#1a1a2e';
  const mid   = '#666666';

  doc.rect(0, 0, doc.page.width, 80).fill('#16a085');
  const titleX = drawPdfLogo(doc, branding.logo_url, { x: 50, y: 18, size: 42 }) || 50;
  doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text(branding.school_name, titleX, 20);
  doc.fontSize(12).font('Helvetica').text(`${branding.subtitle} — Stock Monthly Summary — ${label}`, titleX, 45);
  doc.fillColor(dark);

  let y = 100;

  // Movement type summary
  doc.rect(50, y, doc.page.width - 100, 22).fill(green);
  doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text('MOVEMENT SUMMARY BY TYPE', 58, y + 6);
  doc.fillColor(dark);
  y += 30;

  if (byType.length === 0) {
    doc.fontSize(9).text('No stock movements recorded for this period.', 58, y); y += 20;
  } else {
    doc.fontSize(9).font('Helvetica-Bold')
       .text('Movement Type', 58, y).text('Count', 250, y, { width: 60, align: 'right' })
       .text('Total Quantity', 320, y, { width: 80, align: 'right' });
    doc.font('Helvetica'); y += 14;
    for (const r of byType) {
      if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
      doc.text(r.movement_type.charAt(0).toUpperCase() + r.movement_type.slice(1), 58, y)
         .text(String(r.movement_count), 250, y, { width: 60, align: 'right' })
         .text(String(r.total_quantity), 320, y, { width: 80, align: 'right' });
      y += 14;
    }
  }
  y += 14;

  // By item
  if (y > doc.page.height - 180) { doc.addPage(); y = 50; }
  doc.rect(50, y, doc.page.width - 100, 22).fill(green);
  doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text('MOVEMENT BY ITEM', 58, y + 6);
  doc.fillColor(dark);
  y += 30;

  if (byItem.length === 0) {
    doc.fontSize(9).text('No stock movements recorded for this period.', 58, y); y += 20;
  } else {
    doc.fontSize(9).font('Helvetica-Bold')
       .text('Item', 58, y).text('Unit', 200, y)
       .text('Purchased', 250, y, { width: 60, align: 'right' })
       .text('Used', 320, y, { width: 50, align: 'right' })
       .text('Wasted', 380, y, { width: 50, align: 'right' })
       .text('Adj. Net', 440, y, { width: 60, align: 'right' });
    doc.font('Helvetica'); y += 14;
    for (const r of byItem) {
      if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
      doc.text(r.item_name, 58, y).text(r.unit, 200, y)
         .text(String(r.purchased), 250, y, { width: 60, align: 'right' })
         .text(String(r.used), 320, y, { width: 50, align: 'right' })
         .text(String(r.wasted), 380, y, { width: 50, align: 'right' })
         .text(String(r.adjusted_net), 440, y, { width: 60, align: 'right' });
      y += 14;
    }
  }

  doc.fontSize(8).fillColor(mid)
     .text(`${branding.report_footer_text} • Generated: ${new Date().toLocaleString('en-MY')}`, 50, doc.page.height - 40, {
       align: 'center', width: doc.page.width - 100,
     });

  doc.end();
});

module.exports = router;
