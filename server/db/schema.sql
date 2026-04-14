PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────
-- Users & Roles
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  username     TEXT    NOT NULL UNIQUE,
  password_hash TEXT   NOT NULL,
  role         TEXT    NOT NULL CHECK(role IN ('admin','teacher','student')),
  is_active    INTEGER NOT NULL DEFAULT 1,
  login_disabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- Students
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name           TEXT    NOT NULL,
  gender         TEXT    NOT NULL CHECK(gender IN ('male','female')),
  level          TEXT    NOT NULL,
  enroll_date    TEXT    NOT NULL,
  fee_amount     REAL    NOT NULL DEFAULT 0,
  fee_frequency  TEXT    NOT NULL DEFAULT 'monthly'
                         CHECK(fee_frequency IN ('monthly','yearly','one-time')),
  status         TEXT    NOT NULL DEFAULT 'active'
                         CHECK(status IN ('active','inactive')),
  dorm_house     TEXT,
  room           TEXT,
  bed_number     TEXT,
  hostel_status  TEXT    NOT NULL DEFAULT 'non_boarder'
                         CHECK(hostel_status IN ('boarder','non_boarder','inactive')),
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS student_contacts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  contact_name      TEXT    NOT NULL,
  relationship      TEXT,
  contact_type      TEXT    NOT NULL DEFAULT 'parent'
                           CHECK(contact_type IN ('parent','guardian','emergency_contact','sponsor_other')),
  phone             TEXT,
  whatsapp          TEXT,
  address           TEXT,
  emergency_contact INTEGER NOT NULL DEFAULT 0,
  preferred_contact INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  notes             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_contacts_student ON student_contacts (student_id);
CREATE INDEX IF NOT EXISTS idx_student_contacts_phone ON student_contacts (phone);
CREATE INDEX IF NOT EXISTS idx_student_contacts_name ON student_contacts (contact_name);


-- ─────────────────────────────────────────
-- Attendance
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_records (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attendance_date  TEXT    NOT NULL,
  status           TEXT    NOT NULL CHECK(status IN ('present','absent','late','excused')),
  notes            TEXT,
  marked_by        INTEGER REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records (attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records (student_id, attendance_date DESC);
-- ─────────────────────────────────────────
-- Student Movement / Curfew
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_movement_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  leave_time        TEXT    NOT NULL,
  return_time       TEXT,
  destination       TEXT,
  reason            TEXT,
  day_type          TEXT    NOT NULL CHECK(day_type IN ('weekday','weekend')),
  approval_status   TEXT    NOT NULL DEFAULT 'not_required'
                             CHECK(approval_status IN ('not_required','approved')),
  expected_return_time TEXT,
  compliance_status TEXT    NOT NULL DEFAULT 'out'
                             CHECK(compliance_status IN ('out','returned_on_time','returned_late')),
  approved_by       INTEGER REFERENCES users(id),
  approved_at       TEXT,
  recorded_out_by   INTEGER REFERENCES users(id),
  recorded_in_by    INTEGER REFERENCES users(id),
  clock_out_lat     REAL,
  clock_out_lng     REAL,
  clock_out_accuracy REAL,
  clock_out_distance_m REAL,
  clock_out_verified INTEGER NOT NULL DEFAULT 0,
  clock_out_verified_at TEXT,
  clock_in_lat      REAL,
  clock_in_lng      REAL,
  clock_in_accuracy REAL,
  clock_in_distance_m REAL,
  clock_in_verified INTEGER NOT NULL DEFAULT 0,
  clock_in_verified_at TEXT,
  tracking_status   TEXT NOT NULL DEFAULT 'active'
                     CHECK(tracking_status IN ('active','interrupted','completed')),
  tracking_last_ping_at TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_movement_student_leave
ON student_movement_logs (student_id, leave_time DESC);

CREATE INDEX IF NOT EXISTS idx_student_movement_open
ON student_movement_logs (return_time, leave_time DESC);

CREATE TABLE IF NOT EXISTS student_movement_tracking_pings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id  INTEGER NOT NULL REFERENCES student_movement_logs(id) ON DELETE CASCADE,
  ping_time    TEXT    NOT NULL,
  lat          REAL    NOT NULL,
  lng          REAL    NOT NULL,
  accuracy     REAL    NOT NULL,
  distance_m   REAL,
  source       TEXT    NOT NULL DEFAULT 'gps_ping' CHECK(source IN ('gps_ping')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_movement_tracking_pings_movement_time
ON student_movement_tracking_pings (movement_id, ping_time DESC);

-- ─────────────────────────────────────────
-- Fee Payments
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id),
  amount        REAL    NOT NULL,
  paid_date     TEXT    NOT NULL,
  method        TEXT    NOT NULL DEFAULT 'cash'
                        CHECK(method IN ('cash','bank_transfer','online')),
  period_month  INTEGER NOT NULL CHECK(period_month BETWEEN 1 AND 12),
  period_year   INTEGER NOT NULL,
  received_by   INTEGER REFERENCES users(id),
  notes         TEXT,
  voided        INTEGER NOT NULL DEFAULT 0,
  void_reason   TEXT,
  voided_by     INTEGER REFERENCES users(id),
  voided_at     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_payments_unique_active_period
ON fee_payments (student_id, period_month, period_year)
WHERE voided = 0;

-- ─────────────────────────────────────────
-- Duty Logs (student-submitted)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duty_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_number  TEXT    NOT NULL,
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  date         TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','approved','flagged')),
  reviewed_by  INTEGER REFERENCES users(id),
  reviewed_at  TEXT,
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS duty_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_log_id  INTEGER NOT NULL REFERENCES duty_logs(id) ON DELETE CASCADE,
  item_name    TEXT    NOT NULL,
  quantity     REAL    NOT NULL DEFAULT 1,
  unit_price   REAL    NOT NULL DEFAULT 0,
  total_price  REAL    NOT NULL DEFAULT 0,
  inventory_item_id INTEGER REFERENCES inventory_items(id),
  stock_quantity_used REAL,
  stock_recorded INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────
-- General Expenditure
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenditures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category     TEXT    NOT NULL
                       CHECK(category IN (
                         'utilities','supplies','transport',
                         'rent','food','cleaning','other'
                       )),
  description  TEXT    NOT NULL,
  amount       REAL    NOT NULL,
  expense_date TEXT    NOT NULL,
  added_by     INTEGER REFERENCES users(id),
  receipt_ref  TEXT,
  notes        TEXT,
  stock_item_id INTEGER REFERENCES inventory_items(id),
  stock_quantity REAL,
  stock_movement_id INTEGER REFERENCES stock_movements(id),
  stock_reversal_movement_id INTEGER REFERENCES stock_movements(id),
  voided       INTEGER NOT NULL DEFAULT 0,
  void_reason  TEXT,
  voided_by    INTEGER REFERENCES users(id),
  voided_at    TEXT
);

-- ─────────────────────────────────────────
-- Inventory
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_custom INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_items (
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
);

CREATE TABLE IF NOT EXISTS stock_movements (
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
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_active ON inventory_items (is_active);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items (category_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_date ON stock_movements (item_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type_date ON stock_movements (movement_type, movement_date DESC);

-- ─────────────────────────────────────────
-- Attachments (local file storage metadata)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT    NOT NULL CHECK(entity_type IN ('expenditure','duty_log')),
  entity_id     INTEGER NOT NULL,
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL UNIQUE,
  mime_type     TEXT    NOT NULL,
  file_size     INTEGER NOT NULL CHECK(file_size >= 0),
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_entity
ON attachments (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by
ON attachments (uploaded_by);


-- ─────────────────────────────────────────
-- Notifications (in-app/local-first)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  message      TEXT    NOT NULL,
  entity_type  TEXT,
  entity_id    INTEGER,
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
ON notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_entity
ON notifications (entity_type, entity_id);

-- ─────────────────────────────────────────
-- Audit Log
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id),
  action       TEXT    NOT NULL,
  target_table TEXT,
  target_id    INTEGER,
  detail       TEXT,
  timestamp    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- System Settings
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
