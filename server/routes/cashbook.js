const express = require('express');
const PDFDoc = require('pdfkit');
const { db, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getSettings } = require('../services/settings');
const { drawPdfLogo } = require('../services/pdfBranding');

const router = express.Router();

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// Generate audit-friendly reference number: CBK-YYYYMM-NNNNNN
function nextRefNumber(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  const ym = d.slice(0, 7).replace('-', '');
  const last = db.prepare(`
    SELECT ref_number FROM cashbook_entries
    WHERE ref_number LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`CBK-${ym}-%`);
  let seq = 1;
  if (last) {
    const parts = last.ref_number.split('-');
    seq = parseInt(parts[2] || '0', 10) + 1;
  }
  return `CBK-${ym}-${String(seq).padStart(6, '0')}`;
}

// GET /api/cashbook/summary — bank/cash balances + monthly totals
router.get('/summary', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year } = req.query;

  // Single query: all account balances via aggregation
  const balances = db.prepare(`
    SELECT
      coa.id,
      coa.type,
      coa.sub_type,
      COALESCE(ob.balance, 0) AS opening_balance,
      COALESCE(SUM(CASE WHEN ce.debit_account_id = coa.id AND ce.voided = 0 THEN ce.amount ELSE 0 END), 0) AS total_debits,
      COALESCE(SUM(CASE WHEN ce.credit_account_id = coa.id AND ce.voided = 0 THEN ce.amount ELSE 0 END), 0) AS total_credits
    FROM chart_of_accounts coa
    LEFT JOIN account_opening_balances ob ON ob.account_id = coa.id
    LEFT JOIN cashbook_entries ce ON (ce.debit_account_id = coa.id OR ce.credit_account_id = coa.id)
    WHERE coa.is_active = 1
    GROUP BY coa.id
  `).all();

  const calcBalance = (row) => {
    const isDebitNormal = row.type === 'asset' || row.type === 'expense';
    return isDebitNormal
      ? row.opening_balance + row.total_debits - row.total_credits
      : row.opening_balance + row.total_credits - row.total_debits;
  };

  const totalCash = balances.filter(r => r.sub_type === 'cash').reduce((s, r) => s + calcBalance(r), 0);
  const totalBank = balances.filter(r => r.sub_type === 'bank').reduce((s, r) => s + calcBalance(r), 0);

  let monthlyIncome = 0, monthlyExpense = 0;
  if (month && year) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;

    const monthlyTotals = db.prepare(`
      SELECT
        coa.type,
        COALESCE(SUM(CASE WHEN ce.credit_account_id = coa.id THEN ce.amount ELSE 0 END), 0) AS period_credits,
        COALESCE(SUM(CASE WHEN ce.debit_account_id  = coa.id THEN ce.amount ELSE 0 END), 0) AS period_debits
      FROM chart_of_accounts coa
      LEFT JOIN cashbook_entries ce
        ON (ce.debit_account_id = coa.id OR ce.credit_account_id = coa.id)
        AND ce.voided = 0
        AND strftime('%Y-%m', ce.entry_date) = ?
      WHERE coa.is_active = 1
        AND coa.type IN ('income','expense')
      GROUP BY coa.id, coa.type
    `).all(ym);

    for (const r of monthlyTotals) {
      if (r.type === 'income')  monthlyIncome  += r.period_credits - r.period_debits;
      if (r.type === 'expense') monthlyExpense += r.period_debits  - r.period_credits;
    }
  }

  res.json({
    total_cash: totalCash,
    total_bank: totalBank,
    total_balance: totalCash + totalBank,
    monthly_income: monthlyIncome,
    monthly_expense: monthlyExpense,
    net_for_month: monthlyIncome - monthlyExpense,
  });
});

// GET /api/cashbook — list entries with filters
router.get('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year, account_id, fund_id, method, search } = req.query;
  let sql = `
    SELECT ce.*,
           da.code AS debit_code, da.name AS debit_name,
           ca.code AS credit_code, ca.name AS credit_name,
           u.name AS created_by_name,
           df.name AS fund_name
    FROM cashbook_entries ce
    JOIN chart_of_accounts da ON da.id = ce.debit_account_id
    JOIN chart_of_accounts ca ON ca.id = ce.credit_account_id
    LEFT JOIN users u ON u.id = ce.created_by
    LEFT JOIN donor_funds df ON df.id = ce.fund_id
    WHERE ce.voided = 0
  `;
  const params = [];
  if (month && year) {
    sql += " AND strftime('%Y-%m', ce.entry_date) = ?";
    params.push(`${year}-${String(month).padStart(2,'0')}`);
  } else if (year) {
    sql += " AND strftime('%Y', ce.entry_date) = ?";
    params.push(String(year));
  }
  if (account_id) {
    sql += ' AND (ce.debit_account_id = ? OR ce.credit_account_id = ?)';
    params.push(account_id, account_id);
  }
  if (fund_id)  { sql += ' AND ce.fund_id = ?'; params.push(fund_id); }
  if (method)   { sql += ' AND ce.payment_method = ?'; params.push(method); }
  if (search)   { sql += ' AND (ce.description LIKE ? OR ce.ref_number LIKE ? OR ce.payment_ref LIKE ?)';
                  const q = `%${search}%`; params.push(q, q, q); }
  sql += ' ORDER BY ce.entry_date DESC, ce.id DESC';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/cashbook/:id — single entry
router.get('/:id(\\d+)', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const row = db.prepare(`
    SELECT ce.*,
           da.code AS debit_code, da.name AS debit_name,
           ca.code AS credit_code, ca.name AS credit_name,
           u.name AS created_by_name,
           df.name AS fund_name
    FROM cashbook_entries ce
    JOIN chart_of_accounts da ON da.id = ce.debit_account_id
    JOIN chart_of_accounts ca ON ca.id = ce.credit_account_id
    LEFT JOIN users u ON u.id = ce.created_by
    LEFT JOIN donor_funds df ON df.id = ce.fund_id
    WHERE ce.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  res.json(row);
});

// POST /api/cashbook — create entry
router.post('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const {
    entry_date, description, debit_account_id, credit_account_id,
    amount, payment_method, bank_account_name, payment_ref,
    fund_id, source_table, source_id, notes,
  } = req.body;

  if (!entry_date || !description || !debit_account_id || !credit_account_id || !amount)
    return res.status(400).json({ error: 'entry_date, description, debit_account_id, credit_account_id, amount required' });
  if (debit_account_id === credit_account_id)
    return res.status(400).json({ error: 'Debit and credit accounts must differ' });
  if (Number(amount) <= 0)
    return res.status(400).json({ error: 'Amount must be positive' });

  // Validate accounts exist
  const da = db.prepare('SELECT id FROM chart_of_accounts WHERE id = ? AND is_active = 1').get(debit_account_id);
  const ca = db.prepare('SELECT id FROM chart_of_accounts WHERE id = ? AND is_active = 1').get(credit_account_id);
  if (!da || !ca) return res.status(400).json({ error: 'Invalid account(s)' });

  // Check if month is closed
  const ym = entry_date.slice(0, 7);
  const [yr, mo] = ym.split('-').map(Number);
  const closed = db.prepare('SELECT id FROM monthly_closings WHERE year = ? AND month = ?').get(yr, mo);
  if (closed && req.user.role !== 'admin')
    return res.status(409).json({ error: `Period ${MONTHS[mo-1]} ${yr} is closed. Contact admin.` });

  const ref = nextRefNumber(entry_date);
  let result;
  try {
    result = db.prepare(`
      INSERT INTO cashbook_entries
        (entry_date, ref_number, description, debit_account_id, credit_account_id,
         amount, payment_method, bank_account_name, payment_ref, fund_id,
         source_table, source_id, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      entry_date, ref, description, debit_account_id, credit_account_id,
      amount, payment_method || 'cash', bank_account_name || null, payment_ref || null,
      fund_id || null, source_table || null, source_id || null, notes || null, req.user.id
    );
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Duplicate ref number, retry' });
    throw err;
  }

  audit(req.user.id, 'CREATE', 'cashbook_entries', result.lastInsertRowid,
    `${ref}: ${description} – amount ${amount}`);
  res.status(201).json({ id: result.lastInsertRowid, ref_number: ref });
});

// DELETE /api/cashbook/:id — void entry (admin only)
router.delete('/:id(\\d+)', requireAuth, requireRole('admin'), (req, res) => {
  const entry = db.prepare('SELECT * FROM cashbook_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (entry.voided) return res.status(400).json({ error: 'Already voided' });

  const { void_reason } = req.body;
  db.prepare('UPDATE cashbook_entries SET voided = 1, void_reason = ? WHERE id = ?')
    .run(void_reason || null, req.params.id);

  audit(req.user.id, 'VOID', 'cashbook_entries', req.params.id,
    `Voided ${entry.ref_number}: ${void_reason || 'no reason'}`);
  res.json({ ok: true });
});

// GET /api/cashbook/export/pdf — printable ledger book PDF
router.get('/export/pdf', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { month, year, account_id } = req.query;
  const settings = getSettings();
  const currency = settings.currency || 'RM';

  const now = new Date();
  const m = parseInt(month || now.getMonth() + 1);
  const y = parseInt(year || now.getFullYear());
  const ym = `${y}-${String(m).padStart(2,'0')}`;
  const periodLabel = `${MONTHS[m-1]} ${y}`;

  // Get all non-voided entries for the period (or specific account)
  let sql = `
    SELECT ce.*,
           da.code AS debit_code, da.name AS debit_name,
           ca.code AS credit_code, ca.name AS credit_name,
           df.name AS fund_name
    FROM cashbook_entries ce
    JOIN chart_of_accounts da ON da.id = ce.debit_account_id
    JOIN chart_of_accounts ca ON ca.id = ce.credit_account_id
    LEFT JOIN donor_funds df ON df.id = ce.fund_id
    WHERE ce.voided = 0 AND strftime('%Y-%m', ce.entry_date) = ?
  `;
  const params = [ym];
  if (account_id) {
    sql += ' AND (ce.debit_account_id = ? OR ce.credit_account_id = ?)';
    params.push(account_id, account_id);
  }
  sql += ' ORDER BY ce.entry_date, ce.id';
  const entries = db.prepare(sql).all(...params);

  const filename = `Cashbook_Ledger_${y}_${String(m).padStart(2,'0')}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  const doc = new PDFDoc({ margin: 40, size: 'A4', layout: 'landscape' });
  doc.pipe(res);

  const pageW = doc.page.width;
  const pageH = doc.page.height;

  // Header band
  doc.rect(0, 0, pageW, 72).fill('#1a7a4a');
  const titleX = drawPdfLogo(doc, settings.logo_url, { x: 40, y: 14, size: 42 }) || 40;
  doc.fillColor('white').font('Helvetica-Bold').fontSize(16)
    .text(settings.school_name || 'School Ledger', titleX, 16);
  doc.font('Helvetica').fontSize(10)
    .text(settings.subtitle || 'Finance & Operations', titleX, 38)
    .text(`CASHBOOK LEDGER — ${periodLabel}`, titleX, 54);
  doc.fillColor('white').fontSize(10)
    .text(`Printed: ${now.toLocaleDateString('en-MY')}`, pageW - 160, 38, { width: 120, align: 'right' })
    .text(`Currency: ${currency}`, pageW - 160, 54, { width: 120, align: 'right' });

  // Column layout (landscape)
  const cols = {
    date:    { x: 40,  w: 68 },
    ref:     { x: 112, w: 90 },
    desc:    { x: 206, w: 150 },
    debit:   { x: 360, w: 100 },
    credit:  { x: 464, w: 100 },
    method:  { x: 568, w: 58 },
    amount:  { x: 630, w: 72 },
    balance: { x: 706, w: 74 },
  };

  let y2 = 90;

  const drawTableHeader = () => {
    doc.rect(40, y2, pageW - 80, 20).fill('#f0f4f8');
    doc.fillColor('#555').font('Helvetica-Bold').fontSize(8);
    doc.text('DATE',    cols.date.x,   y2+6, { width: cols.date.w });
    doc.text('REF NO',  cols.ref.x,    y2+6, { width: cols.ref.w });
    doc.text('DESCRIPTION', cols.desc.x, y2+6, { width: cols.desc.w });
    doc.text('DEBIT A/C', cols.debit.x, y2+6, { width: cols.debit.w });
    doc.text('CREDIT A/C',cols.credit.x,y2+6, { width: cols.credit.w });
    doc.text('METHOD', cols.method.x,  y2+6, { width: cols.method.w });
    doc.text('AMOUNT',  cols.amount.x, y2+6, { width: cols.amount.w, align: 'right' });
    doc.text('BALANCE', cols.balance.x,y2+6, { width: cols.balance.w, align: 'right' });
    y2 += 22;
  };

  drawTableHeader();

  let runningBalance = 0;
  let totalIncome = 0;
  let totalExpense = 0;

  // Pre-load all account types into a Map to avoid N+1 queries inside the loop
  const allAccounts = db.prepare('SELECT id, type FROM chart_of_accounts').all();
  const accountTypeMap = new Map(allAccounts.map(a => [a.id, a.type]));

  entries.forEach((e, idx) => {
    // Track simple running total (income acct credited = income, expense acct debited = expense)
    const debitIsExpense  = accountTypeMap.get(e.debit_account_id)  === 'expense';
    const creditIsIncome  = accountTypeMap.get(e.credit_account_id) === 'income';
    if (creditIsIncome)  { totalIncome  += e.amount; runningBalance += e.amount; }
    if (debitIsExpense)  { totalExpense += e.amount; runningBalance -= e.amount; }

    if (y2 > pageH - 80) {
      doc.addPage({ layout: 'landscape' });
      y2 = 40;
      drawTableHeader();
    }

    const bg = idx % 2 === 0 ? '#ffffff' : '#f9fbfd';
    doc.rect(40, y2, pageW - 80, 18).fill(bg);
    doc.fillColor('#222').font('Helvetica').fontSize(7.5);
    doc.text(e.entry_date,              cols.date.x,   y2+5, { width: cols.date.w });
    doc.text(e.ref_number,              cols.ref.x,    y2+5, { width: cols.ref.w });
    doc.text(e.description,             cols.desc.x,   y2+5, { width: cols.desc.w, ellipsis: true });
    doc.text(`${e.debit_code} ${e.debit_name}`,  cols.debit.x,  y2+5, { width: cols.debit.w, ellipsis: true });
    doc.text(`${e.credit_code} ${e.credit_name}`,cols.credit.x, y2+5, { width: cols.credit.w, ellipsis: true });
    doc.text(e.payment_method,          cols.method.x, y2+5, { width: cols.method.w });
    doc.text(Number(e.amount).toFixed(2), cols.amount.x, y2+5, { width: cols.amount.w, align: 'right' });
    doc.text(runningBalance.toFixed(2), cols.balance.x,y2+5, { width: cols.balance.w, align: 'right' });
    y2 += 18;

    // Light separator
    doc.moveTo(40, y2).lineTo(pageW-40, y2).strokeColor('#e8ecf0').lineWidth(0.3).stroke();
  });

  if (entries.length === 0) {
    doc.fillColor('#888').font('Helvetica').fontSize(10)
      .text('No cashbook entries for this period.', 40, y2 + 10, { align: 'center', width: pageW - 80 });
    y2 += 30;
  }

  // Summary footer
  y2 += 14;
  if (y2 > pageH - 80) { doc.addPage({ layout: 'landscape' }); y2 = 40; }
  doc.save().fillOpacity(0.08).rect(40, y2, pageW - 80, 50).fill('#1a7a4a').restore();
  doc.rect(40, y2, pageW - 80, 50).stroke('#1a7a4a');
  doc.fillColor('#1a7a4a').font('Helvetica-Bold').fontSize(9);
  doc.text(`Total Income for Period:   ${currency} ${totalIncome.toFixed(2)}`, 55, y2 + 8);
  doc.text(`Total Expenses for Period: ${currency} ${totalExpense.toFixed(2)}`, 55, y2 + 22);
  doc.text(`Net Balance:               ${currency} ${(totalIncome - totalExpense).toFixed(2)}`, 55, y2 + 36);
  doc.text(`Entries: ${entries.length}`, pageW - 160, y2 + 22, { width: 120, align: 'right' });

  y2 += 64;
  doc.fillColor('#888').font('Helvetica').fontSize(8)
    .text(settings.report_footer_text || 'Generated by SchoolOps — Confidential', 40, y2,
      { width: pageW - 80, align: 'center' });

  doc.end();
});

module.exports = router;
