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
    'notifications','chart_of_accounts','donor_funds','cashbook_entries',
    'account_opening_balances','monthly_closings',
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
  // Only seed if table is empty
  const count = db.prepare('SELECT COUNT(*) AS n FROM chart_of_accounts').get().n;
  if (count > 0) return;

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


  if (!columnExists('students', 'dorm_house')) {
    db.exec('ALTER TABLE students ADD COLUMN dorm_house TEXT');
  }
  if (!columnExists('students', 'user_id')) {
    db.exec('ALTER TABLE students ADD COLUMN user_id INTEGER REFERENCES users(id)');
  }
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
        UNIQUE(year, month)
      )
    `);
  }

  ensureInventorySeedData();
  ensureAccountingSeedData();
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
