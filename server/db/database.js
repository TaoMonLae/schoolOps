const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { DB_PATH } = require('../config/paths');

const dbPath = DB_PATH;

// Ensure parent directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema on first run
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

function tableExists(table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return !!row;
}

function columnExists(table, column) {
  if (!tableExists(table)) return false;
  // Whitelist: only allow known table names to prevent injection
  const KNOWN_TABLES = [
    'users','students','student_contacts','fee_payments','duty_logs','duty_items',
    'expenditures','attachments','audit_log','settings','inventory_items',
    'stock_categories','stock_movements','attendance_records','student_movement_logs',
    'student_movement_tracking_pings','notifications','chart_of_accounts','donor_funds','cashbook_entries',
    'account_opening_balances','monthly_closings','disciplinary_rules','disciplinary_records',
    'council_assignments','council_issues','council_meetings','council_meeting_attendance',
    'council_action_items','council_duty_rosters','council_resource_logs','council_funds',
  ];
  if (!KNOWN_TABLES.includes(table)) throw new Error(`Unknown table: ${table}`);
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name === column);
}

function ensureInventorySeedData() {
  const categories = [
    { name: 'Kitchen' },
    { name: 'Cleaning Supplies' },
    { name: 'Stationery' },
    { name: 'Toiletries' },
    { name: 'Medicine & Health' },
    { name: 'Other' },
  ];

  const insertCategory = db.prepare(`
    INSERT INTO stock_categories (name, is_custom)
    VALUES (?, 0)
    ON CONFLICT(name) DO NOTHING
  `);

  for (const cat of categories) insertCategory.run(cat.name);

  const categoryMap = db.prepare('SELECT id, name FROM stock_categories').all().reduce((acc, row) => {
    acc[row.name] = row.id;
    return acc;
  }, {});

  const defaults = [
    { name: 'Rice', category: 'Kitchen', unit: 'kg', reorder: 25 },
    { name: 'Oil', category: 'Kitchen', unit: 'litre', reorder: 10 },
    { name: 'Eggs', category: 'Kitchen', unit: 'pcs', reorder: 60 },
    { name: 'Cleaning Detergent', category: 'Cleaning Supplies', unit: 'bottle', reorder: 4 },
    { name: 'Stationery Pack', category: 'Stationery', unit: 'box', reorder: 3 },
    { name: 'Toiletries Kit', category: 'Toiletries', unit: 'box', reorder: 2 },
    { name: 'Basic First Aid Supplies', category: 'Medicine & Health', unit: 'box', reorder: 2 },
    { name: 'Other Item', category: 'Other', unit: 'pcs', reorder: 1 },
  ];

  const insertItem = db.prepare(`
    INSERT INTO inventory_items (name, category_id, unit, current_stock, reorder_level, notes, is_active)
    VALUES (?, ?, ?, 0, ?, 'Default seeded item', 1)
    ON CONFLICT(name, category_id) DO NOTHING
  `);

  for (const item of defaults) {
    insertItem.run(item.name, categoryMap[item.category] || null, item.unit, item.reorder);
  }
}

function ensureAccountingSeedData() {
  // Always run — ON CONFLICT makes this idempotent. Ensures deleted system
  // accounts are restored on next boot without wiping user-created accounts.
  const accts = [
    // ASSETS
    { code: '1000', name: 'Cash on Hand',            type: 'asset',   sub_type: 'cash',       description: 'Physical cash held at school' },
    { code: '1010', name: 'Bank Account – Main',     type: 'asset',   sub_type: 'bank',       description: 'Primary school bank account' },
    { code: '1020', name: 'Bank Account – Petty Cash',type:'asset',   sub_type: 'bank',       description: 'Petty cash bank float' },
    { code: '1100', name: 'Fee Receivables (Arrears)',type: 'asset',   sub_type: 'receivable', description: 'Outstanding student fee arrears' },
    { code: '1200', name: 'Inventory / Supplies',    type: 'asset',   sub_type: 'inventory',  description: 'Goods held in stock' },
    // LIABILITIES
    { code: '2000', name: 'Accounts Payable',         type: 'liability', sub_type: 'payable', description: 'Amounts owed to suppliers' },
    { code: '2100', name: 'Donor Restricted Funds',   type: 'liability', sub_type: 'donor',   description: 'Donor grants held for specific purposes' },
    // EQUITY
    { code: '3000', name: 'Retained Surplus',         type: 'equity',  sub_type: 'retained',  description: 'Accumulated surplus of the school' },
    // INCOME
    { code: '4000', name: 'School Fees Income',       type: 'income',  sub_type: 'fees',      description: 'Tuition and boarding fees received' },
    { code: '4100', name: 'Donor Grants Received',    type: 'income',  sub_type: 'donor',     description: 'Grants and donations received' },
    { code: '4200', name: 'Other Income',             type: 'income',  sub_type: 'other',     description: 'Miscellaneous income' },
    // EXPENSES
    { code: '5100', name: 'Utilities',                type: 'expense', sub_type: 'utilities', description: 'Electricity, water, internet' },
    { code: '5200', name: 'Supplies',                 type: 'expense', sub_type: 'supplies',  description: 'Office and classroom supplies' },
    { code: '5300', name: 'Transport',                type: 'expense', sub_type: 'transport', description: 'Transport and travel costs' },
    { code: '5400', name: 'Rent',                     type: 'expense', sub_type: 'rent',      description: 'Premises rental' },
    { code: '5500', name: 'Food & Provisions',        type: 'expense', sub_type: 'food',      description: 'Kitchen and boarding food costs' },
    { code: '5600', name: 'Cleaning Supplies',        type: 'expense', sub_type: 'cleaning',  description: 'Cleaning materials and services' },
    { code: '5700', name: 'Student Duties / Shopping',type: 'expense', sub_type: 'duties',    description: 'Student-run shopping duty costs' },
    { code: '5800', name: 'Other Expenses',           type: 'expense', sub_type: 'other',     description: 'Miscellaneous operating expenses' },
  ];

  const ins = db.prepare(`
    INSERT INTO chart_of_accounts (code, name, type, sub_type, description, is_system, is_active)
    VALUES (?, ?, ?, ?, ?, 1, 1)
    ON CONFLICT(code) DO NOTHING
  `);
  for (const a of accts) ins.run(a.code, a.name, a.type, a.sub_type, a.description);
}

function ensureDisciplinarySeedData() {
  const rules = [
    // General Conduct
    { code: 'GC-01', title: 'Disrespectful Behaviour', cat: 'General Conduct', art: 'Art. 1.1', desc: 'Student shows disrespect to staff, peers or visitors.', sev: 'moderate', act: 'Verbal warning, parental notification' },
    { code: 'GC-02', title: 'Dishonesty or Deception', cat: 'General Conduct', art: 'Art. 1.2', desc: 'Lying, cheating or any form of deception.', sev: 'moderate', act: 'Written warning' },
    { code: 'GC-03', title: 'Physical Altercation', cat: 'General Conduct', art: 'Art. 1.3', desc: 'Fighting or threatening physical violence against others.', sev: 'serious', act: 'Suspension, parental meeting' },
    // Academic Responsibilities
    { code: 'AR-01', title: 'Academic Dishonesty / Plagiarism', cat: 'Academic Responsibilities', art: 'Art. 2.1', desc: 'Copying, plagiarism or unauthorised assistance in assessments.', sev: 'serious', act: 'Zero mark, written warning' },
    { code: 'AR-02', title: 'Failure to Submit Assignments', cat: 'Academic Responsibilities', art: 'Art. 2.2', desc: 'Repeated failure to submit required schoolwork on time.', sev: 'minor', act: 'Verbal warning, catch-up session' },
    { code: 'AR-03', title: 'Class Disruption', cat: 'Academic Responsibilities', art: 'Art. 2.3', desc: 'Disrupting teaching sessions or other students\' learning.', sev: 'minor', act: 'Verbal warning' },
    // Dress Code
    { code: 'DC-01', title: 'Non-compliant Uniform', cat: 'Dress Code', art: 'Art. 3.1', desc: 'Wearing incorrect or incomplete school uniform.', sev: 'minor', act: 'Verbal warning, corrective action required' },
    { code: 'DC-02', title: 'Inappropriate Appearance', cat: 'Dress Code', art: 'Art. 3.2', desc: 'Hair, accessories or appearance not in line with school standards.', sev: 'minor', act: 'Verbal warning' },
    // Facilities Use
    { code: 'FU-01', title: 'Misuse or Damage to School Property', cat: 'Facilities Use', art: 'Art. 4.1', desc: 'Deliberate or negligent damage to school facilities or property.', sev: 'serious', act: 'Repair/replacement cost, written warning' },
    { code: 'FU-02', title: 'Unauthorised Area Access', cat: 'Facilities Use', art: 'Art. 4.2', desc: 'Entering restricted or off-limit areas without permission.', sev: 'moderate', act: 'Written warning' },
    // Mobile Phones & Electronics
    { code: 'MP-01', title: 'Unauthorised Device Use', cat: 'Mobile Phones & Electronics', art: 'Art. 5.1', desc: 'Using mobile phones or electronics during study/class hours without permission.', sev: 'minor', act: 'Device confiscated, verbal warning' },
    { code: 'MP-02', title: 'Prohibited Content on Device', cat: 'Mobile Phones & Electronics', art: 'Art. 5.2', desc: 'Storing or sharing prohibited content on personal devices.', sev: 'serious', act: 'Device confiscated, parental notification, suspension review' },
    // Visitors
    { code: 'VI-01', title: 'Unauthorised Visitor', cat: 'Visitors', art: 'Art. 6.1', desc: 'Bringing or meeting an unauthorised visitor on school premises.', sev: 'moderate', act: 'Written warning, parental notification' },
    // Health & Hygiene
    { code: 'HH-01', title: 'Hygiene Non-compliance', cat: 'Health & Hygiene', art: 'Art. 7.1', desc: 'Failure to maintain personal hygiene to acceptable school standards.', sev: 'minor', act: 'Verbal warning, counselling' },
    { code: 'HH-02', title: 'Smoking or Prohibited Substance Use', cat: 'Health & Hygiene', art: 'Art. 7.2', desc: 'Possession or use of tobacco, vape or any prohibited substance.', sev: 'serious', act: 'Suspension, parental meeting, potential expulsion review' },
    // Hostel / Curfew
    { code: 'HC-01', title: 'Curfew Violation', cat: 'Hostel / Curfew', art: 'Art. 8.1', desc: 'Returning to hostel after stipulated curfew time without valid reason.', sev: 'moderate', act: 'Written warning, restricted outing' },
    { code: 'HC-02', title: 'Unauthorised Absence from Hostel', cat: 'Hostel / Curfew', art: 'Art. 8.2', desc: 'Leaving hostel or campus without proper sign-out or approval.', sev: 'serious', act: 'Suspension, parental notification' },
    // Dormitory Conduct
    { code: 'DO-01', title: 'Dormitory Disturbance', cat: 'Dormitory Conduct', art: 'Art. 9.1', desc: 'Causing noise or disturbance in dormitory during quiet hours.', sev: 'minor', act: 'Verbal warning' },
    { code: 'DO-02', title: 'Dormitory Property Damage', cat: 'Dormitory Conduct', art: 'Art. 9.2', desc: 'Damaging dormitory furniture, fittings or shared property.', sev: 'moderate', act: 'Repair/replacement cost, written warning' },
    // Gender Separation
    { code: 'GS-01', title: 'Gender Boundary Violation', cat: 'Gender Separation', art: 'Art. 10.1', desc: 'Entering designated areas of the opposite gender without permission.', sev: 'serious', act: 'Written warning, parental notification, suspension review' },
    // Kitchen / Dining
    { code: 'KD-01', title: 'Dining Hall Misconduct', cat: 'Kitchen / Dining', art: 'Art. 11.1', desc: 'Misbehaviour, food waste or disruption in the dining hall or kitchen area.', sev: 'minor', act: 'Verbal warning, duty assignment' },
    { code: 'KD-02', title: 'Unauthorised Kitchen Access', cat: 'Kitchen / Dining', art: 'Art. 11.2', desc: 'Entering kitchen or food storage without authorisation.', sev: 'moderate', act: 'Written warning' },
    // Shared Responsibilities
    { code: 'SR-01', title: 'Failure to Complete Assigned Duty', cat: 'Shared Responsibilities', art: 'Art. 12.1', desc: 'Neglecting or refusing to carry out assigned duty roster tasks.', sev: 'minor', act: 'Make-up duty assigned, verbal warning' },
    // Safety
    { code: 'SF-01', title: 'Safety Rule Violation', cat: 'Safety', art: 'Art. 13.1', desc: 'Behaviour that endangers self or others, or violates safety procedures.', sev: 'serious', act: 'Immediate correction, written warning, parental notification' },
    // Study Hours
    { code: 'SH-01', title: 'Study Hour Disruption', cat: 'Study Hours', art: 'Art. 14.1', desc: 'Causing disruption during designated study hour periods.', sev: 'minor', act: 'Verbal warning' },
    { code: 'SH-02', title: 'Sleeping During Study Hours', cat: 'Study Hours', art: 'Art. 14.2', desc: 'Sleeping or engaging in non-study activity during mandatory study periods.', sev: 'minor', act: 'Verbal warning, counselling' },
    // Prohibited Items
    { code: 'PI-01', title: 'Possession of Prohibited Item', cat: 'Prohibited Items', art: 'Art. 15.1', desc: 'Having weapons, gambling items, pornographic material or other prohibited items on premises.', sev: 'serious', act: 'Item confiscated, suspension, parental meeting' },
  ];

  const insert = db.prepare(`
    INSERT INTO disciplinary_rules (rule_code, title, category, article_reference, description, severity, default_action, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(rule_code) DO NOTHING
  `);
  for (const r of rules) {
    insert.run(r.code, r.title, r.cat, r.art, r.desc, r.sev, r.act);
  }
}

function runMigrations() {
  if (!columnExists('users', 'is_active')) {
    db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  }
  if (!columnExists('users', 'login_disabled')) {
    db.exec('ALTER TABLE users ADD COLUMN login_disabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnExists('users', 'must_change_password')) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnExists('users', 'is_retired')) {
    db.exec('ALTER TABLE users ADD COLUMN is_retired INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnExists('users', 'retired_at')) {
    db.exec('ALTER TABLE users ADD COLUMN retired_at TEXT');
  }
  if (!columnExists('users', 'retired_by')) {
    db.exec('ALTER TABLE users ADD COLUMN retired_by INTEGER REFERENCES users(id)');
  }
  if (!columnExists('users', 'retired_reason')) {
    db.exec('ALTER TABLE users ADD COLUMN retired_reason TEXT');
  }

  if (!tableExists('stock_categories')) {
    db.exec(`
      CREATE TABLE stock_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        is_custom INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!tableExists('inventory_items')) {
    db.exec(`
      CREATE TABLE inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category_id INTEGER REFERENCES stock_categories(id),
        unit TEXT NOT NULL,
        current_stock REAL NOT NULL DEFAULT 0,
        reorder_level REAL NOT NULL DEFAULT 0,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, category_id)
      )
    `);
  }

  if (!tableExists('stock_movements')) {
    db.exec(`
      CREATE TABLE stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        movement_type TEXT NOT NULL CHECK(movement_type IN ('purchase','usage','adjustment','waste')),
        quantity REAL NOT NULL,
        unit_cost REAL,
        movement_date TEXT NOT NULL,
        notes TEXT,
        ref_table TEXT,
        ref_id INTEGER,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!columnExists('duty_items', 'inventory_item_id')) {
    db.exec('ALTER TABLE duty_items ADD COLUMN inventory_item_id INTEGER REFERENCES inventory_items(id)');
  }
  if (!columnExists('duty_items', 'stock_quantity_used')) {
    db.exec('ALTER TABLE duty_items ADD COLUMN stock_quantity_used REAL');
  }
  if (!columnExists('duty_items', 'stock_recorded')) {
    db.exec('ALTER TABLE duty_items ADD COLUMN stock_recorded INTEGER NOT NULL DEFAULT 0');
  }

  if (!columnExists('expenditures', 'stock_item_id')) {
    db.exec('ALTER TABLE expenditures ADD COLUMN stock_item_id INTEGER REFERENCES inventory_items(id)');
  }
  if (!columnExists('expenditures', 'stock_quantity')) {
    db.exec('ALTER TABLE expenditures ADD COLUMN stock_quantity REAL');
  }
  if (!columnExists('expenditures', 'stock_movement_id')) {
    db.exec('ALTER TABLE expenditures ADD COLUMN stock_movement_id INTEGER REFERENCES stock_movements(id)');
  }
  if (!columnExists('expenditures', 'stock_reversal_movement_id')) {
    db.exec('ALTER TABLE expenditures ADD COLUMN stock_reversal_movement_id INTEGER REFERENCES stock_movements(id)');
  }
  if (!columnExists('expenditures', 'voided')) {
    db.exec('ALTER TABLE expenditures ADD COLUMN voided INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnExists('expenditures', 'void_reason')) {
    db.exec('ALTER TABLE expenditures ADD COLUMN void_reason TEXT');
  }
  if (!columnExists('expenditures', 'voided_by')) {
    db.exec('ALTER TABLE expenditures ADD COLUMN voided_by INTEGER REFERENCES users(id)');
  }
  if (!columnExists('expenditures', 'voided_at')) {
    db.exec('ALTER TABLE expenditures ADD COLUMN voided_at TEXT');
  }
  if (!columnExists('fee_payments', 'void_reason')) {
    db.exec('ALTER TABLE fee_payments ADD COLUMN void_reason TEXT');
  }
  if (!columnExists('fee_payments', 'voided_by')) {
    db.exec('ALTER TABLE fee_payments ADD COLUMN voided_by INTEGER REFERENCES users(id)');
  }
  if (!columnExists('fee_payments', 'voided_at')) {
    db.exec('ALTER TABLE fee_payments ADD COLUMN voided_at TEXT');
  }


  if (!columnExists('students', 'dorm_house')) {
    db.exec('ALTER TABLE students ADD COLUMN dorm_house TEXT');
  }
  if (!columnExists('students', 'user_id')) {
    db.exec('ALTER TABLE students ADD COLUMN user_id INTEGER REFERENCES users(id)');
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_user_id_unique
    ON students(user_id)
    WHERE user_id IS NOT NULL
  `);

  if (!columnExists('students', 'room')) {
    db.exec('ALTER TABLE students ADD COLUMN room TEXT');
  }
  if (!columnExists('students', 'bed_number')) {
    db.exec('ALTER TABLE students ADD COLUMN bed_number TEXT');
  }
  if (!columnExists('students', 'hostel_status')) {
    db.exec("ALTER TABLE students ADD COLUMN hostel_status TEXT NOT NULL DEFAULT 'non_boarder'");
  }

  if (!tableExists('attendance_records')) {
    db.exec(`
      CREATE TABLE attendance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        attendance_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
        notes TEXT,
        marked_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(student_id, attendance_date)
      )
    `);
  }

  if (!tableExists('student_movement_logs')) {
    db.exec(`
      CREATE TABLE student_movement_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        leave_time TEXT NOT NULL,
        return_time TEXT,
        destination TEXT,
        reason TEXT,
        day_type TEXT NOT NULL CHECK(day_type IN ('weekday','weekend')),
        approval_status TEXT NOT NULL DEFAULT 'not_required'
          CHECK(approval_status IN ('not_required','approved')),
        expected_return_time TEXT,
        compliance_status TEXT NOT NULL DEFAULT 'out'
          CHECK(compliance_status IN ('out','returned_on_time','returned_late')),
        approved_by INTEGER REFERENCES users(id),
        approved_at TEXT,
        recorded_out_by INTEGER REFERENCES users(id),
        recorded_in_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!columnExists('student_movement_logs', 'clock_out_lat')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_out_lat REAL');
  }
  if (!columnExists('student_movement_logs', 'clock_out_lng')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_out_lng REAL');
  }
  if (!columnExists('student_movement_logs', 'clock_out_accuracy')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_out_accuracy REAL');
  }
  if (!columnExists('student_movement_logs', 'clock_out_distance_m')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_out_distance_m REAL');
  }
  if (!columnExists('student_movement_logs', 'clock_out_verified')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_out_verified INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnExists('student_movement_logs', 'clock_out_verified_at')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_out_verified_at TEXT');
  }
  if (!columnExists('student_movement_logs', 'clock_in_lat')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_in_lat REAL');
  }
  if (!columnExists('student_movement_logs', 'clock_in_lng')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_in_lng REAL');
  }
  if (!columnExists('student_movement_logs', 'clock_in_accuracy')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_in_accuracy REAL');
  }
  if (!columnExists('student_movement_logs', 'clock_in_distance_m')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_in_distance_m REAL');
  }
  if (!columnExists('student_movement_logs', 'clock_in_verified')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_in_verified INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnExists('student_movement_logs', 'clock_in_verified_at')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN clock_in_verified_at TEXT');
  }
  if (!columnExists('student_movement_logs', 'tracking_status')) {
    db.exec("ALTER TABLE student_movement_logs ADD COLUMN tracking_status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!columnExists('student_movement_logs', 'tracking_last_ping_at')) {
    db.exec('ALTER TABLE student_movement_logs ADD COLUMN tracking_last_ping_at TEXT');
  }

  if (!tableExists('student_movement_tracking_pings')) {
    db.exec(`
      CREATE TABLE student_movement_tracking_pings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movement_id INTEGER NOT NULL REFERENCES student_movement_logs(id) ON DELETE CASCADE,
        ping_time TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        accuracy REAL NOT NULL,
        distance_m REAL,
        source TEXT NOT NULL DEFAULT 'gps_ping' CHECK(source IN ('gps_ping')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_movement_tracking_pings_movement_time
    ON student_movement_tracking_pings (movement_id, ping_time DESC)
  `);

  if (!tableExists('student_contacts')) {
    db.exec(`
      CREATE TABLE student_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        contact_name TEXT NOT NULL,
        relationship TEXT,
        contact_type TEXT NOT NULL DEFAULT 'parent'
          CHECK(contact_type IN ('parent','guardian','emergency_contact','sponsor_other')),
        phone TEXT,
        whatsapp TEXT,
        address TEXT,
        emergency_contact INTEGER NOT NULL DEFAULT 0,
        preferred_contact INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!columnExists('student_contacts', 'contact_type')) {
    db.exec("ALTER TABLE student_contacts ADD COLUMN contact_type TEXT NOT NULL DEFAULT 'parent'");
  }
  if (!columnExists('student_contacts', 'preferred_contact')) {
    db.exec('ALTER TABLE student_contacts ADD COLUMN preferred_contact INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnExists('student_contacts', 'is_active')) {
    db.exec('ALTER TABLE student_contacts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  }
  if (!columnExists('student_contacts', 'created_at')) {
    db.exec("ALTER TABLE student_contacts ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  }
  if (!columnExists('student_contacts', 'updated_at')) {
    db.exec("ALTER TABLE student_contacts ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_items_active ON inventory_items (is_active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items (category_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stock_movements_item_date ON stock_movements (item_id, movement_date DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stock_movements_type_date ON stock_movements (movement_type, movement_date DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_student_contacts_student ON student_contacts (student_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_student_contacts_phone ON student_contacts (phone)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_student_contacts_name ON student_contacts (contact_name)');

  if (!tableExists('notifications')) {
    db.exec(`
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications (user_id, is_read, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications (entity_type, entity_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records (attendance_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records (student_id, attendance_date DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_students_user_id ON students (user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_student_movement_student_leave ON student_movement_logs (student_id, leave_time DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_student_movement_open ON student_movement_logs (return_time, leave_time DESC)');

  if (!tableExists('council_assignments')) {
    db.exec(`
      CREATE TABLE council_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        council_role TEXT NOT NULL CHECK(council_role IN (
          'president','vice_president','secretary','treasurer',
          'boys_hostel_monitor','girls_hostel_monitor','resource_monitor',
          'cooking_duty_leader','cleaning_duty_leader'
        )),
        start_date TEXT NOT NULL,
        end_date TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        assigned_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!tableExists('council_issues')) {
    db.exec(`
      CREATE TABLE council_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN (
          'hostel_concern','curfew_issue','quiet_hours_issue',
          'kitchen_dining_issue','cleaning_duty_issue','maintenance_issue',
          'resource_issue','student_concern','council_action_item'
        )),
        title TEXT NOT NULL,
        description TEXT,
        reported_by INTEGER REFERENCES users(id),
        assigned_role TEXT,
        assigned_student_id INTEGER REFERENCES students(id),
        target_student_id INTEGER REFERENCES students(id),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','escalated')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
        linked_rule_category TEXT,
        due_date TEXT,
        resolution_notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!tableExists('council_meetings')) {
    db.exec(`
      CREATE TABLE council_meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_number TEXT NOT NULL,
        meeting_date TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        location TEXT,
        chairperson_role TEXT,
        chairperson_student_id INTEGER REFERENCES students(id),
        minutes_taken_by_student_id INTEGER REFERENCES students(id),
        attendance TEXT,
        agenda_items TEXT,
        discussion_notes TEXT,
        action_items TEXT,
        next_meeting_date TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!tableExists('council_meeting_attendance')) {
    db.exec(`
      CREATE TABLE council_meeting_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id INTEGER NOT NULL REFERENCES council_meetings(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        attendance_status TEXT NOT NULL DEFAULT 'present' CHECK(attendance_status IN ('present','absent','excused')),
        notes TEXT,
        UNIQUE(meeting_id, student_id)
      )
    `);
  }

  if (!tableExists('council_action_items')) {
    db.exec(`
      CREATE TABLE council_action_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id INTEGER REFERENCES council_meetings(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        assigned_role TEXT,
        assigned_student_id INTEGER REFERENCES students(id),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','cancelled')),
        due_date TEXT,
        completed_at TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!tableExists('council_duty_rosters')) {
    db.exec(`
      CREATE TABLE council_duty_rosters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roster_type TEXT NOT NULL CHECK(roster_type IN ('cooking','cleaning')),
        week_start TEXT NOT NULL,
        week_end TEXT NOT NULL,
        duty_group TEXT,
        assignments TEXT,
        status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','missed')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!tableExists('council_resource_logs')) {
    db.exec(`
      CREATE TABLE council_resource_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL,
        log_type TEXT NOT NULL,
        student_id INTEGER REFERENCES students(id),
        quantity REAL,
        condition_status TEXT,
        notes TEXT,
        log_date TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!tableExists('council_funds')) {
    db.exec(`
      CREATE TABLE council_funds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_type TEXT NOT NULL CHECK(entry_type IN ('collection','expense','adjustment')),
        amount REAL NOT NULL CHECK(amount > 0),
        description TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        supporting_ref TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_council_assignments_student ON council_assignments (student_id, active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_council_assignments_role ON council_assignments (council_role, active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_council_issues_status ON council_issues (status, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_council_issues_role ON council_issues (assigned_role, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_council_issues_target_student ON council_issues (target_student_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_council_meetings_date ON council_meetings (meeting_date DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_council_duty_rosters_week ON council_duty_rosters (week_start DESC, roster_type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_council_resource_logs_date ON council_resource_logs (log_date DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_council_funds_date ON council_funds (entry_date DESC)');

  // ── Accounting / Finance Layer ─────────────────────────────────────────────

  if (!tableExists('chart_of_accounts')) {
    db.exec(`
      CREATE TABLE chart_of_accounts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        code        TEXT    NOT NULL UNIQUE,
        name        TEXT    NOT NULL,
        type        TEXT    NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')),
        sub_type    TEXT,
        parent_id   INTEGER REFERENCES chart_of_accounts(id),
        description TEXT,
        is_system   INTEGER NOT NULL DEFAULT 0,
        is_active   INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_coa_type ON chart_of_accounts (type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_coa_active ON chart_of_accounts (is_active)');
  }

  if (!tableExists('donor_funds')) {
    db.exec(`
      CREATE TABLE donor_funds (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        funder_name     TEXT,
        description     TEXT,
        is_restricted   INTEGER NOT NULL DEFAULT 1,
        is_active       INTEGER NOT NULL DEFAULT 1,
        created_by      INTEGER REFERENCES users(id),
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  if (!tableExists('cashbook_entries')) {
    db.exec(`
      CREATE TABLE cashbook_entries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date      TEXT    NOT NULL,
        ref_number      TEXT    NOT NULL UNIQUE,
        description     TEXT    NOT NULL,
        debit_account_id  INTEGER NOT NULL REFERENCES chart_of_accounts(id),
        credit_account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id),
        amount          REAL    NOT NULL CHECK(amount > 0),
        payment_method  TEXT    NOT NULL DEFAULT 'cash'
                                CHECK(payment_method IN ('cash','bank','transfer')),
        bank_account_name TEXT,
        payment_ref     TEXT,
        fund_id         INTEGER REFERENCES donor_funds(id),
        source_table    TEXT,
        source_id       INTEGER,
        notes           TEXT,
        voided          INTEGER NOT NULL DEFAULT 0,
        void_reason     TEXT,
        voided_by       INTEGER REFERENCES users(id),
        voided_at       TEXT,
        created_by      INTEGER REFERENCES users(id),
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_cashbook_date ON cashbook_entries (entry_date DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cashbook_debit ON cashbook_entries (debit_account_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cashbook_credit ON cashbook_entries (credit_account_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cashbook_fund ON cashbook_entries (fund_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cashbook_source ON cashbook_entries (source_table, source_id)');
  }

  if (!tableExists('account_opening_balances')) {
    db.exec(`
      CREATE TABLE account_opening_balances (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id  INTEGER NOT NULL REFERENCES chart_of_accounts(id),
        balance_date TEXT   NOT NULL,
        balance     REAL    NOT NULL DEFAULT 0,
        set_by      INTEGER REFERENCES users(id),
        set_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_id)
      )
    `);
  }

  if (!tableExists('monthly_closings')) {
    db.exec(`
      CREATE TABLE monthly_closings (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        year            INTEGER NOT NULL,
        month           INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
        closed_at       TEXT    NOT NULL DEFAULT (datetime('now')),
        closed_by       INTEGER REFERENCES users(id),
        opening_cash    REAL    NOT NULL DEFAULT 0,
        opening_bank    REAL    NOT NULL DEFAULT 0,
        total_income    REAL    NOT NULL DEFAULT 0,
        total_expense   REAL    NOT NULL DEFAULT 0,
        closing_cash    REAL    NOT NULL DEFAULT 0,
        closing_bank    REAL    NOT NULL DEFAULT 0,
        notes           TEXT,
        is_reopened     INTEGER NOT NULL DEFAULT 0,
        reopened_at     TEXT,
        reopened_by     INTEGER REFERENCES users(id),
        reopen_reason   TEXT,
        UNIQUE(year, month)
      )
    `);
  }
  if (!columnExists('cashbook_entries', 'voided_by')) {
    db.exec('ALTER TABLE cashbook_entries ADD COLUMN voided_by INTEGER REFERENCES users(id)');
  }
  if (!columnExists('cashbook_entries', 'voided_at')) {
    db.exec('ALTER TABLE cashbook_entries ADD COLUMN voided_at TEXT');
  }
  if (!columnExists('monthly_closings', 'is_reopened')) {
    db.exec('ALTER TABLE monthly_closings ADD COLUMN is_reopened INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnExists('monthly_closings', 'reopened_at')) {
    db.exec('ALTER TABLE monthly_closings ADD COLUMN reopened_at TEXT');
  }
  if (!columnExists('monthly_closings', 'reopened_by')) {
    db.exec('ALTER TABLE monthly_closings ADD COLUMN reopened_by INTEGER REFERENCES users(id)');
  }
  if (!columnExists('monthly_closings', 'reopen_reason')) {
    db.exec('ALTER TABLE monthly_closings ADD COLUMN reopen_reason TEXT');
  }

  if (!tableExists('disciplinary_rules')) {
    db.exec(`
      CREATE TABLE disciplinary_rules (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_code         TEXT    NOT NULL UNIQUE,
        title             TEXT    NOT NULL,
        category          TEXT    NOT NULL,
        article_reference TEXT,
        description       TEXT,
        severity          TEXT    NOT NULL CHECK(severity IN ('minor','moderate','serious')),
        default_action    TEXT,
        active            INTEGER NOT NULL DEFAULT 1,
        created_by        INTEGER REFERENCES users(id),
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_disc_rules_active ON disciplinary_rules (active)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_disc_rules_category ON disciplinary_rules (category)');
  }

  if (!tableExists('disciplinary_records')) {
    db.exec(`
      CREATE TABLE disciplinary_records (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id               INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        rule_id                  INTEGER NOT NULL REFERENCES disciplinary_rules(id),
        incident_date            TEXT    NOT NULL,
        reported_by              INTEGER REFERENCES users(id),
        location                 TEXT,
        details                  TEXT,
        severity_at_time         TEXT    NOT NULL CHECK(severity_at_time IN ('minor','moderate','serious')),
        status                   TEXT    NOT NULL DEFAULT 'pending'
                                         CHECK(status IN ('pending','reviewed','confirmed','resolved','appealed')),
        action_taken             TEXT,
        warning_level            INTEGER,
        parent_guardian_notified INTEGER NOT NULL DEFAULT 0,
        attachment               TEXT,
        student_acknowledged_at  TEXT,
        created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_disc_records_student ON disciplinary_records (student_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_disc_records_rule    ON disciplinary_records (rule_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_disc_records_status  ON disciplinary_records (status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_disc_records_date    ON disciplinary_records (incident_date DESC)');
  }

  ensureInventorySeedData();
  ensureAccountingSeedData();
  ensureDisciplinarySeedData();
}

runMigrations();

// Helper: write an audit entry
function audit(userId, action, targetTable, targetId, detail) {
  db.prepare(`
    INSERT INTO audit_log (user_id, action, target_table, target_id, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId || null, action || null, targetTable || null, targetId || null, detail || null);
}

module.exports = { db, audit, dbPath };
