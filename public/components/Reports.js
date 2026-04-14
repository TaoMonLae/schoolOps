window.Reports = function Reports() {
  const { showToast } = React.useContext(window.ToastContext);
  const now = new Date();

  const [mode, setMode] = React.useState('monthly');
  const [month, setMonth] = React.useState(now.getMonth() + 1);
  const [year, setYear] = React.useState(now.getFullYear());
  const [trendMonths, setTrendMonths] = React.useState(12);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [exporting, setExporting] = React.useState('');

  const years = [];
  for (let y = now.getFullYear(); y >= 2022; y--) years.push(y);

  const endpoint = React.useMemo(() => {
    if (mode === 'monthly') return `/api/reports/monthly?month=${month}&year=${year}`;
    if (mode === 'yearly') return `/api/reports/yearly?year=${year}`;
    if (mode === 'stock_current') return '/api/reports/stock/current';
    if (mode === 'stock_monthly') return `/api/reports/stock/monthly-summary?month=${month}&year=${year}`;
    return `/api/reports/trends?months=${trendMonths}`;
  }, [mode, month, year, trendMonths]);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api(endpoint);
      setData(d);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, [endpoint]);

  const handleExport = async (type) => {
    setExporting(type);
    try {
      let url = '';
      let filename = '';
      const mm = String(month).padStart(2, '0');
      const today = new Date().toISOString().slice(0, 10);

      if (type === 'contacts') {
        url = '/api/reports/export/student-contacts-excel';
        filename = 'Student_Guardian_Contacts.xlsx';
      } else if (type === 'pdf') {
        if (mode === 'yearly') {
          url = `/api/reports/export/yearly-pdf?year=${year}`;
          filename = `Yearly_Report_${year}.pdf`;
        } else if (mode === 'trends') {
          url = `/api/reports/export/trends-pdf?months=${trendMonths}`;
          filename = `Trends_Report_${trendMonths}months.pdf`;
        } else if (mode === 'stock_current') {
          url = '/api/reports/export/stock-current-pdf';
          filename = `Stock_Current_${today}.pdf`;
        } else if (mode === 'stock_monthly') {
          url = `/api/reports/export/stock-monthly-pdf?month=${month}&year=${year}`;
          filename = `Stock_${year}_${mm}.pdf`;
        } else {
          url = `/api/reports/export/pdf?month=${month}&year=${year}`;
          filename = `Report_${year}_${mm}.pdf`;
        }
      } else {
        // excel
        if (mode === 'yearly') {
          url = `/api/reports/export/yearly-excel?year=${year}`;
          filename = `Yearly_Report_${year}.xlsx`;
        } else if (mode === 'trends') {
          url = `/api/reports/export/trends-excel?months=${trendMonths}`;
          filename = `Trends_Report_${trendMonths}months.xlsx`;
        } else if (mode === 'stock_current') {
          url = '/api/reports/export/stock-current-excel';
          filename = `Stock_Current_${today}.xlsx`;
        } else if (mode === 'stock_monthly') {
          url = `/api/reports/export/stock-monthly-excel?month=${month}&year=${year}`;
          filename = `Stock_${year}_${mm}.xlsx`;
        } else {
          url = `/api/reports/export/excel?month=${month}&year=${year}`;
          filename = `Report_${year}_${mm}.xlsx`;
        }
      }
      await downloadFile(url, filename);
      showToast(`${type.toUpperCase()} downloaded`);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setExporting('');
    }
  };

  const renderBars = (rows, keys, currency) => {
    const max = Math.max(1, ...rows.flatMap(r => keys.map(k => Math.abs(r[k] || 0))));
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Chart View</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((row, idx) => (
            <div key={`${row.label}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.label}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {keys.map(k => (
                  <div
                    key={k}
                    title={`${k}: ${fmtCurrency(row[k] || 0, currency)}`}
                    style={{
                      width: `${Math.max(4, (Math.abs(row[k] || 0) / max) * 100)}%`,
                      height: 10,
                      borderRadius: 6,
                      background: k === 'feeIncome' ? 'var(--green)' : (k === 'expenses' || k === 'totalExpenses') ? 'var(--amber)' : 'var(--blue)',
                      opacity: k === 'netBalance' ? 0.85 : 1,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMonthly = () => {
    const netColor = data.netBalance >= 0 ? 'var(--green)' : 'var(--red)';
    const currency = data.branding?.currency;
    return (
      <>
        <div style={{ background: 'var(--dark)', color: 'white', borderRadius: 10, padding: '18px 24px', marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{data.branding?.school_name || 'Monthly Financial Report'}</div>
          <div style={{ fontSize: 14, opacity: .7 }}>{data.label} · {data.branding?.subtitle || ''}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 16 }}>
          <div className="card" style={{ borderTop: '3px solid var(--green)' }}>
            <div className="stat-label">Fee Payments Collected</div>
            <div className="stat-value stat-green">{fmtCurrency(data.feeIncome, currency)}</div>
            <div className="stat-sub">{data.paidStudents} students paid</div>
          </div>
          <div className="card" style={{ borderTop: '3px solid var(--amber)' }}>
            <div className="stat-label">Total Expenses</div>
            <div className="stat-value stat-amber">{fmtCurrency(data.totalExpenses, currency)}</div>
            <div className="stat-sub">Duty + General</div>
          </div>
          <div className="card" style={{ borderTop: `3px solid ${netColor}` }}>
            <div className="stat-label">Net Balance</div>
            <div className="stat-value" style={{ color: netColor }}>{fmtCurrency(data.netBalance, currency)}</div>
            <div className="stat-sub">Income − Expenses</div>
          </div>
        </div>

        {renderBars([{ label: data.label, feeIncome: data.feeIncome, totalExpenses: data.totalExpenses, netBalance: data.netBalance }], ['feeIncome', 'totalExpenses', 'netBalance'], currency)}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <div className="card">
            <div className="card-title" style={{ color: 'var(--green)' }}>INCOME</div>
            <table>
              <tbody>
                <tr><td>Fee Payments Collected</td><td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--green)' }}>{fmtCurrency(data.feeIncome, currency)}</td></tr>
                <tr><td>No. of Students Paid</td><td style={{ textAlign: 'right' }}>{data.paidStudents} / {data.totalActive}</td></tr>
                <tr><td style={{ color: 'var(--red)' }}>Outstanding Balances</td><td style={{ textAlign: 'right', color: 'var(--red)', fontWeight: 600 }}>{fmtCurrency(data.outstandingTotal, currency)}</td></tr>
              </tbody>
            </table>
            {data.outstanding.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>UNPAID STUDENTS</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {data.outstanding.map((s, i) => <span key={i} className="badge badge-red">{s.name}</span>)}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title" style={{ color: 'var(--amber)' }}>EXPENSES</div>
            <table>
              <tbody>
                <tr><td>Daily Duty (Cooking/Cleaning)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(data.dutyTotal, currency)}</td></tr>
                <tr><td>Utilities</td><td style={{ textAlign: 'right' }}>{fmtCurrency(data.byCategory.utilities || 0, currency)}</td></tr>
                <tr><td>Supplies</td><td style={{ textAlign: 'right' }}>{fmtCurrency(data.byCategory.supplies || 0, currency)}</td></tr>
                <tr><td>Transport</td><td style={{ textAlign: 'right' }}>{fmtCurrency(data.byCategory.transport || 0, currency)}</td></tr>
                <tr><td>Rent</td><td style={{ textAlign: 'right' }}>{fmtCurrency(data.byCategory.rent || 0, currency)}</td></tr>
                <tr><td>Food</td><td style={{ textAlign: 'right' }}>{fmtCurrency(data.byCategory.food || 0, currency)}</td></tr>
                <tr><td>Cleaning</td><td style={{ textAlign: 'right' }}>{fmtCurrency(data.byCategory.cleaning || 0, currency)}</td></tr>
                <tr><td>Other</td><td style={{ textAlign: 'right' }}>{fmtCurrency(data.byCategory.other || 0, currency)}</td></tr>
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td style={{ fontWeight: 700 }}>Total Expenses</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--amber)' }}>{fmtCurrency(data.totalExpenses, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ background: data.netBalance >= 0 ? 'var(--green)' : 'var(--red)', color: 'white', borderRadius: 10, padding: '16px 24px', marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>NET BALANCE — Income − Expenses</span>
          <span style={{ fontWeight: 800, fontSize: 22 }}>{fmtCurrency(data.netBalance, currency)}</span>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Appendix A — Duty Logs (Approved)</div>
          {data.dutyLogs.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}><div className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.45}}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></div>No approved duty logs</div>
          ) : (
            <table>
              <thead><tr><th>Duty No.</th><th>Date</th><th>Submitted By</th><th>Att.</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
              <tbody>
                {data.dutyLogs.map(dl => (
                  <tr key={dl.id}>
                    <td><strong>{dl.duty_number}</strong></td>
                    <td>{dl.date}</td>
                    <td>{dl.submitted_by_name}</td>
                    <td>{dl.attachment_count || 0}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(dl.total, currency)}</td>
                  </tr>
                ))}
                <tr><td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Total Duty</td><td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--amber)' }}>{fmtCurrency(data.dutyTotal, currency)}</td></tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Appendix B — Fee Payments</div>
          {data.fees.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}><div className="icon"></div>No payments recorded</div>
          ) : (
            <table>
              <thead><tr><th>Student</th><th>Amount</th><th>Paid Date</th><th>Method</th></tr></thead>
              <tbody>
                {data.fees.map(f => (
                  <tr key={f.id}>
                    <td>{f.student_name}</td>
                    <td style={{ fontWeight: 600, color: 'var(--green)' }}>{fmtCurrency(f.amount, currency)}</td>
                    <td>{f.paid_date}</td>
                    <td><window.StatusBadge status={f.method} /></td>
                  </tr>
                ))}
                <tr><td style={{ fontWeight: 700 }}>Total</td><td style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtCurrency(data.feeIncome, currency)}</td><td colSpan={2}></td></tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Appendix C — Expenditure List</div>
          {data.expenditures.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}><div className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.45}}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/></svg></div>No expenditures recorded</div>
          ) : (
            <table>
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Att.</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>
                {data.expenditures.map(e => (
                  <tr key={e.id}>
                    <td>{e.expense_date}</td>
                    <td><span className="badge badge-blue" style={{ textTransform: 'capitalize' }}>{e.category}</span></td>
                    <td>{e.description}</td>
                    <td>{e.attachment_count || 0}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(e.amount, currency)}</td>
                  </tr>
                ))}
                <tr><td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--amber)' }}>{fmtCurrency(data.expTotal, currency)}</td></tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Finance Controls — Voids & Period Events</div>
          <div style={{ display:'grid', gap:12 }}>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--muted)', marginBottom:6 }}>Voided Fee Payments</div>
              {data.financeControls.voidedFees.length === 0 ? <div style={{ fontSize:12, color:'var(--muted)' }}>None</div> : (
                <table><thead><tr><th>Date</th><th>Student</th><th>Actor</th><th>Reason</th></tr></thead><tbody>
                  {data.financeControls.voidedFees.map(v => <tr key={`vf-${v.id}`}><td>{v.voided_at || v.event_date}</td><td>{v.reference_name}</td><td>{v.actor_name || '—'}</td><td>{v.void_reason}</td></tr>)}
                </tbody></table>
              )}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--muted)', marginBottom:6 }}>Voided Cashbook Entries</div>
              {data.financeControls.voidedCashbook.length === 0 ? <div style={{ fontSize:12, color:'var(--muted)' }}>None</div> : (
                <table><thead><tr><th>Date</th><th>Reference</th><th>Actor</th><th>Reason</th></tr></thead><tbody>
                  {data.financeControls.voidedCashbook.map(v => <tr key={`vc-${v.id}`}><td>{v.voided_at || v.event_date}</td><td>{v.ref_number}</td><td>{v.actor_name || '—'}</td><td>{v.void_reason}</td></tr>)}
                </tbody></table>
              )}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--muted)', marginBottom:6 }}>Voided Expenditures</div>
              {data.financeControls.voidedExpenditures.length === 0 ? <div style={{ fontSize:12, color:'var(--muted)' }}>None</div> : (
                <table><thead><tr><th>Date</th><th>Description</th><th>Actor</th><th>Reason</th></tr></thead><tbody>
                  {data.financeControls.voidedExpenditures.map(v => <tr key={`ve-${v.id}`}><td>{v.voided_at || v.event_date}</td><td>{v.description}</td><td>{v.actor_name || '—'}</td><td>{v.void_reason}</td></tr>)}
                </tbody></table>
              )}
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderYearly = () => {
    const currency = data.branding?.currency;
    return (
      <>
        <div style={{ background: 'var(--dark)', color: 'white', borderRadius: 10, padding: '18px 24px', marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{data.branding?.school_name || 'Yearly Financial Report'}</div>
          <div style={{ fontSize: 14, opacity: .7 }}>{data.year} · {data.branding?.subtitle || ''}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 16 }}>
          <div className="card"><div className="stat-label">Year Fee Income</div><div className="stat-value stat-green">{fmtCurrency(data.totals.feeIncome, currency)}</div></div>
          <div className="card"><div className="stat-label">Year Expenses</div><div className="stat-value stat-amber">{fmtCurrency(data.totals.totalExpenses, currency)}</div></div>
          <div className="card"><div className="stat-label">Year Net Balance</div><div className="stat-value" style={{ color: data.totals.netBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtCurrency(data.totals.netBalance, currency)}</div></div>
          <div className="card"><div className="stat-label">Cumulative Outstanding</div><div className="stat-value" style={{ color: 'var(--red)' }}>{fmtCurrency(data.totals.outstandingTotal, currency)}</div></div>
        </div>

        {renderBars(data.monthly, ['feeIncome', 'totalExpenses', 'netBalance'], currency)}

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Month-by-Month Breakdown</div>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Fee Income</th>
                <th style={{ textAlign: 'right' }}>Expenses</th>
                <th style={{ textAlign: 'right' }}>Net Balance</th>
                <th style={{ textAlign: 'right' }}>Outstanding</th>
                <th style={{ textAlign: 'right' }}>Paid</th>
                <th style={{ textAlign: 'right' }}>Unpaid</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map(row => (
                <tr key={row.month}>
                  <td>{row.label}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCurrency(row.feeIncome, currency)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCurrency(row.totalExpenses, currency)}</td>
                  <td style={{ textAlign: 'right', color: row.netBalance >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{fmtCurrency(row.netBalance, currency)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--red)' }}>{fmtCurrency(row.outstandingTotal, currency)}</td>
                  <td style={{ textAlign: 'right' }}>{row.paidStudents}</td>
                  <td style={{ textAlign: 'right' }}>{row.unpaidStudents}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td>Total</td>
                <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmtCurrency(data.totals.feeIncome, currency)}</td>
                <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmtCurrency(data.totals.totalExpenses, currency)}</td>
                <td style={{ textAlign: 'right', color: data.totals.netBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtCurrency(data.totals.netBalance, currency)}</td>
                <td style={{ textAlign: 'right', color: 'var(--red)' }}>{fmtCurrency(data.totals.outstandingTotal, currency)}</td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Expenditure Category Totals</div>
          <table>
            <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>
              {Object.entries(data.expenditureCategoryTotals).map(([cat, total]) => (
                <tr key={cat}><td style={{ textTransform: 'capitalize' }}>{cat}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(total, currency)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderTrends = () => {
    const currency = data.branding?.currency;
    const totals = data.points.reduce((acc, p) => ({
      feeIncome: acc.feeIncome + p.feeIncome,
      expenses: acc.expenses + p.expenses,
      netBalance: acc.netBalance + p.netBalance,
      numberPaid: acc.numberPaid + p.numberPaid,
      numberUnpaid: acc.numberUnpaid + p.numberUnpaid,
    }), { feeIncome: 0, expenses: 0, netBalance: 0, numberPaid: 0, numberUnpaid: 0 });

    return (
      <>
        <div style={{ background: 'var(--dark)', color: 'white', borderRadius: 10, padding: '18px 24px', marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{data.branding?.school_name || 'Trends'}</div>
          <div style={{ fontSize: 14, opacity: .7 }}>Last {data.months} months</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14, marginBottom: 16 }}>
          <div className="card"><div className="stat-label">Fee Income</div><div className="stat-value stat-green">{fmtCurrency(totals.feeIncome, currency)}</div></div>
          <div className="card"><div className="stat-label">Expenses</div><div className="stat-value stat-amber">{fmtCurrency(totals.expenses, currency)}</div></div>
          <div className="card"><div className="stat-label">Net Balance</div><div className="stat-value" style={{ color: totals.netBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtCurrency(totals.netBalance, currency)}</div></div>
          <div className="card"><div className="stat-label">Paid Count</div><div className="stat-value">{totals.numberPaid}</div></div>
          <div className="card"><div className="stat-label">Unpaid Count</div><div className="stat-value" style={{ color: 'var(--red)' }}>{totals.numberUnpaid}</div></div>
        </div>

        {renderBars(data.points, ['feeIncome', 'expenses', 'netBalance'], currency)}

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Trend Table</div>
          <table>
            <thead><tr><th>Month</th><th style={{ textAlign: 'right' }}>Fee Income</th><th style={{ textAlign: 'right' }}>Expenses</th><th style={{ textAlign: 'right' }}>Net</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Unpaid</th></tr></thead>
            <tbody>
              {data.points.map(row => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCurrency(row.feeIncome, currency)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCurrency(row.expenses, currency)}</td>
                  <td style={{ textAlign: 'right', color: row.netBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtCurrency(row.netBalance, currency)}</td>
                  <td style={{ textAlign: 'right' }}>{row.numberPaid}</td>
                  <td style={{ textAlign: 'right' }}>{row.numberUnpaid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };


  const renderStockCurrent = () => (
    <div className="card"> 
      <div className="card-title">Current Stock Report ({data.total_items} items)</div>
      <div style={{ marginBottom: 10, color:'var(--red)', fontWeight:700 }}>Low stock items: {data.low_stock_items}</div>
      <table>
        <thead><tr><th>Item</th><th>Category</th><th style={{ textAlign:'right' }}>Current</th><th style={{ textAlign:'right' }}>Reorder</th><th>Notes</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.category_name || '—'}</td>
              <td style={{ textAlign:'right', color:r.is_low_stock ? 'var(--red)' : 'var(--green)', fontWeight:700 }}>{r.current_stock} {r.unit}</td>
              <td style={{ textAlign:'right' }}>{r.reorder_level} {r.unit}</td>
              <td>{r.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderStockMonthly = () => (
    <>
      <div className="card">
        <div className="card-title">Monthly Stock Movement Summary — {data.label}</div>
        <table>
          <thead><tr><th>Type</th><th style={{ textAlign:'right' }}>Movements</th><th style={{ textAlign:'right' }}>Quantity</th></tr></thead>
          <tbody>
            {data.byType.map((r) => <tr key={r.movement_type}><td style={{ textTransform:'capitalize' }}>{r.movement_type}</td><td style={{ textAlign:'right' }}>{r.movement_count}</td><td style={{ textAlign:'right' }}>{r.total_quantity}</td></tr>)}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">By Item</div>
        <table>
          <thead><tr><th>Item</th><th style={{ textAlign:'right' }}>Purchased</th><th style={{ textAlign:'right' }}>Used</th><th style={{ textAlign:'right' }}>Wasted</th><th style={{ textAlign:'right' }}>Adjustment Net</th></tr></thead>
          <tbody>
            {data.byItem.map((r, idx) => <tr key={idx}><td>{r.item_name}</td><td style={{ textAlign:'right' }}>{r.purchased} {r.unit}</td><td style={{ textAlign:'right' }}>{r.used} {r.unit}</td><td style={{ textAlign:'right' }}>{r.wasted} {r.unit}</td><td style={{ textAlign:'right' }}>{r.adjusted_net} {r.unit}</td></tr>)}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {['monthly', 'yearly', 'trends', 'stock_current', 'stock_monthly'].map(v => (
            <button
              key={v}
              className="btn btn-sm"
              onClick={() => { setData(null); setMode(v); }}
              style={{
                borderRadius: 0,
                border: 'none',
                background: mode === v ? 'var(--blue)' : 'transparent',
                color: mode === v ? 'white' : 'var(--dark)',
              }}
            >
              {v === 'stock_current' ? 'Stock Current' : v === 'stock_monthly' ? 'Stock Monthly' : v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {(mode === 'monthly' || mode === 'stock_monthly') && (
          <select value={month} onChange={e => setMonth(+e.target.value)} style={{ width: 140 }}>
            {window.MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        )}

        {(mode === 'monthly' || mode === 'yearly' || mode === 'stock_monthly') && (
          <select value={year} onChange={e => setYear(+e.target.value)} style={{ width: 100 }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}

        {mode === 'trends' && (
          <select value={trendMonths} onChange={e => setTrendMonths(+e.target.value)} style={{ width: 140 }}>
            {[6, 12, 18, 24].map(m => <option key={m} value={m}>Last {m} months</option>)}
          </select>
        )}

        <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
        <div style={{ flex: 1 }} />

        <button className="btn btn-primary" onClick={() => handleExport('excel')} disabled={!!exporting || !data}>
          {exporting === 'excel' ? 'Exporting…' : 'Export Excel'}
        </button>
        <button className="btn btn-secondary" onClick={() => handleExport('contacts')} disabled={!!exporting}>
          {exporting === 'contacts' ? 'Exporting…' : 'Export Student Contacts'}
        </button>

        <button
          className="btn btn-secondary"
          style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
          onClick={() => handleExport('pdf')}
          disabled={!!exporting || !data}
        >
          {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>

      {loading && <div className="empty"><div className="icon">⏳</div>Loading report…</div>}
      {!loading && !data && <div className="empty"><div className="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.45}}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>No data</div>}

      {data && !loading && mode === 'monthly' && renderMonthly()}
      {data && !loading && mode === 'yearly' && renderYearly()}
      {data && !loading && mode === 'trends' && renderTrends()}
      {data && !loading && mode === 'stock_current' && renderStockCurrent()}
      {data && !loading && mode === 'stock_monthly' && renderStockMonthly()}
    </div>
  );
};
