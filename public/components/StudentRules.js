(function () {
  const { useState, useEffect, useMemo, useCallback, useContext } = React;

  const CATEGORY_ORDER = [
    'General Conduct',
    'Academic Responsibilities',
    'Dress Code',
    'Use of School Facilities',
    'Mobile Phones and Electronics',
    'Visitors and External Contacts',
    'Health and Hygiene',
    'Disciplinary Framework',
    'Hostel Rules / Curfew',
    'Dormitory Conduct',
    'Gender Separation Policy',
    'Kitchen and Dining Hall',
    'Shared Responsibilities and Cleaning Duties',
    'Security and Safety',
    'Study Hours',
    'Prohibited Items',
  ];

  function normalizeCategory(value) {
    const key = String(value || '').toLowerCase();
    if (key.includes('general')) return 'General Conduct';
    if (key.includes('academic')) return 'Academic Responsibilities';
    if (key.includes('dress')) return 'Dress Code';
    if (key.includes('facilities') || key.includes('facility')) return 'Use of School Facilities';
    if (key.includes('mobile') || key.includes('electronic') || key.includes('phone')) return 'Mobile Phones and Electronics';
    if (key.includes('visitor') || key.includes('external')) return 'Visitors and External Contacts';
    if (key.includes('health') || key.includes('hygiene')) return 'Health and Hygiene';
    if (key.includes('disciplinary')) return 'Disciplinary Framework';
    if (key.includes('hostel') || key.includes('curfew')) return 'Hostel Rules / Curfew';
    if (key.includes('dormitory') || key.includes('dorm')) return 'Dormitory Conduct';
    if (key.includes('gender')) return 'Gender Separation Policy';
    if (key.includes('kitchen') || key.includes('dining')) return 'Kitchen and Dining Hall';
    if (key.includes('shared') || key.includes('clean')) return 'Shared Responsibilities and Cleaning Duties';
    if (key.includes('safety') || key.includes('security')) return 'Security and Safety';
    if (key.includes('study')) return 'Study Hours';
    if (key.includes('prohibited') || key.includes('contraband')) return 'Prohibited Items';
    return value || 'General Conduct';
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function severityBadge(severity) {
    const map = { minor: 'badge-blue', moderate: 'badge-amber', serious: 'badge-red' };
    if (!severity) return null;
    return <span className={`badge ${map[severity] || 'badge-gray'}`}>{severity}</span>;
  }

  window.StudentRules = function StudentRules() {
    const { showToast } = useContext(window.ToastContext);
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
      setLoading(true);
      try {
        const data = await api('/api/discipline/me/rules');
        setRules(Array.isArray(data.rules) ? data.rules : []);
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => { load(); }, [load]);

    const grouped = useMemo(() => {
      const map = {};
      CATEGORY_ORDER.forEach((section) => { map[section] = []; });

      rules.forEach((rule) => {
        const normalized = normalizeCategory(rule.category);
        if (!map[normalized]) map[normalized] = [];
        map[normalized].push({ ...rule, normalized_category: normalized });
      });

      return map;
    }, [rules]);

    useEffect(() => {
      const handler = (event) => {
        const detail = event.detail || {};
        const targetId = detail.ruleCode
          ? `rule-${slugify(detail.ruleCode)}`
          : detail.category
            ? `section-${slugify(normalizeCategory(detail.category))}`
            : '';
        if (!targetId) return;
        setTimeout(() => {
          const target = document.getElementById(targetId);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            target.classList.add('rule-spotlight');
            window.setTimeout(() => target.classList.remove('rule-spotlight'), 1700);
          }
        }, 50);
      };
      window.addEventListener('student-rules:focus', handler);
      return () => window.removeEventListener('student-rules:focus', handler);
    }, []);

    if (loading) return <window.StatePanel type="loading" message="Loading school rules…" />;

    return (
      <div className="student-rules-page">
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head"><h3>School Rules</h3></div>
          <p style={{ color: 'var(--mid)', fontSize: 13, marginBottom: 8 }}>
            These rules apply to every student in the program, including classroom behavior, hostel life, safety, and discipline.
            Read them regularly so you understand expectations and how violations are handled.
          </p>
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--brand-light)', border: '1px solid var(--border)', fontSize: 12 }}>
            By staying in the program, students are expected to follow these rules.
          </div>
        </div>

        <div className="student-rules-layout">
          <aside className="student-rules-toc card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Sections</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {CATEGORY_ORDER.map((section) => (
                <a key={section} href={`#section-${slugify(section)}`} className="student-rules-link">
                  {section}
                </a>
              ))}
            </div>
          </aside>

          <div style={{ display: 'grid', gap: 12 }}>
            {CATEGORY_ORDER.map((section) => {
              const sectionRules = grouped[section] || [];
              return (
                <section key={section} id={`section-${slugify(section)}`} className="card student-rules-section">
                  <div className="card-head">
                    <h3 style={{ fontSize: 16 }}>{section}</h3>
                    <span className="badge badge-gray">{sectionRules.length}</span>
                  </div>

                  {sectionRules.length === 0 ? (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>No specific rules published in this section yet.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {sectionRules.map((rule) => (
                        <article
                          key={rule.id}
                          id={`rule-${slugify(rule.rule_code)}`}
                          className="student-rule-card"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <code style={{ fontSize: 11, fontWeight: 700 }}>{rule.rule_code}</code>
                            {rule.article_reference ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>{rule.article_reference}</span> : null}
                            {severityBadge(rule.severity)}
                          </div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{rule.title}</div>
                          {rule.description ? <div style={{ color: 'var(--mid)', marginTop: 4, fontSize: 13 }}>{rule.description}</div> : null}
                          {rule.default_action ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--mid)' }}>
                              <strong>Disciplinary action:</strong> {rule.default_action}
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    );
  };
})();
