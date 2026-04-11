/**
 * Seed script — run once to populate demo data.
 * Usage:  node server/db/seed.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const { db } = require('./database');

const isProduction = process.env.NODE_ENV === 'production';
const allowDemoSeedInProd = process.env.ALLOW_DEMO_SEED === 'true';

if (isProduction && !allowDemoSeedInProd) {
  console.error('❌ Refusing to run demo seed in production.');
  console.error('   Set ALLOW_DEMO_SEED=true only if you intentionally need demo data.');
  process.exit(1);
}

console.log('🌱  Seeding MRLC Ledger database...\n');

// ─── Users ────────────────────────────────────────────────────────────────────
const users = [
  { name: 'Admin MRLC',    username: 'admin',    password: 'admin123',   role: 'admin'   },
  { name: 'Ustaz Farid',   username: 'teacher1', password: 'teacher123', role: 'teacher' },
  { name: 'Ahmad Zulkifli',username: 'student1', password: 'student123', role: 'student' },
  { name: 'Nur Aisyah',    username: 'student2', password: 'student123', role: 'student' },
  { name: 'Muhammad Hafiz',username: 'student3', password: 'student123', role: 'student' },
];

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (name, username, password_hash, role)
  VALUES (@name, @username, @password_hash, @role)
`);

const userIds = {};
for (const u of users) {
  const hash = bcrypt.hashSync(u.password, 10);
  insertUser.run({ name: u.name, username: u.username, password_hash: hash, role: u.role });
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
  userIds[u.username] = row.id;
  console.log(`  ✓ User: ${u.username} (${u.role})`);
}

// ─── Students ─────────────────────────────────────────────────────────────────
const students = [
  { name: 'Ahmad Zulkifli',   gender: 'male',   level: 'Tahfiz 1', enroll_date: '2023-01-10', fee_amount: 200, fee_frequency: 'monthly', status: 'active'   },
  { name: 'Nur Aisyah',       gender: 'female', level: 'Tahfiz 1', enroll_date: '2023-01-10', fee_amount: 200, fee_frequency: 'monthly', status: 'active'   },
  { name: 'Muhammad Hafiz',   gender: 'male',   level: 'Tahfiz 2', enroll_date: '2023-03-15', fee_amount: 250, fee_frequency: 'monthly', status: 'active'   },
  { name: 'Siti Fatimah',     gender: 'female', level: 'Tahfiz 2', enroll_date: '2023-03-15', fee_amount: 250, fee_frequency: 'monthly', status: 'active'   },
  { name: 'Abdullah Haris',   gender: 'male',   level: 'Tahfiz 3', enroll_date: '2022-09-01', fee_amount: 300, fee_frequency: 'monthly', status: 'active'   },
  { name: 'Khadijah Mohd',    gender: 'female', level: 'Tahfiz 3', enroll_date: '2022-09-01', fee_amount: 300, fee_frequency: 'monthly', status: 'active'   },
  { name: 'Ismail Rashid',    gender: 'male',   level: 'Tahfiz 1', enroll_date: '2024-01-08', fee_amount: 200, fee_frequency: 'monthly', status: 'active'   },
  { name: 'Maryam Zainab',    gender: 'female', level: 'Tahfiz 2', enroll_date: '2024-02-01', fee_amount: 250, fee_frequency: 'monthly', status: 'active'   },
  { name: 'Umar Farouq',      gender: 'male',   level: 'Tahfiz 1', enroll_date: '2023-06-20', fee_amount: 200, fee_frequency: 'monthly', status: 'inactive', notes: 'Withdrew — family relocation' },
  { name: 'Ruqayyah Idris',   gender: 'female', level: 'Tahfiz 3', enroll_date: '2022-09-01', fee_amount: 300, fee_frequency: 'monthly', status: 'active'   },
];

const insertStudent = db.prepare(`
  INSERT OR IGNORE INTO students
    (name, gender, level, enroll_date, fee_amount, fee_frequency, status, notes)
  VALUES
    (@name, @gender, @level, @enroll_date, @fee_amount, @fee_frequency, @status, @notes)
`);

const studentIds = {};
const studentAccountMap = {
  'Ahmad Zulkifli': userIds['student1'],
  'Nur Aisyah': userIds['student2'],
  'Muhammad Hafiz': userIds['student3'],
};
for (const s of students) {
  insertStudent.run({ ...s, notes: s.notes || null });
  const row = db.prepare('SELECT id FROM students WHERE name = ?').get(s.name);
  studentIds[s.name] = row.id;
  const linkedUserId = studentAccountMap[s.name];
  if (linkedUserId) {
    db.prepare('UPDATE students SET user_id = ? WHERE id = ?').run(linkedUserId, row.id);
  }
  console.log(`  ✓ Student: ${s.name}`);
}

// ─── Fee Payments (last 3 months) ─────────────────────────────────────────────
const adminId = userIds['admin'];
const teacherId = userIds['teacher1'];

const insertFee = db.prepare(`
  INSERT INTO fee_payments
    (student_id, amount, paid_date, method, period_month, period_year, received_by, notes)
  VALUES
    (@student_id, @amount, @paid_date, @method, @period_month, @period_year, @received_by, @notes)
`);

// Helper to add payments for a given month/year
function seedFeesForMonth(month, year, paidStudents) {
  for (const [name, method] of paidStudents) {
    const sid = studentIds[name];
    if (!sid) continue;
    const s = students.find(x => x.name === name);
    if (!s) continue;
    // random day 1–10
    const day = String(Math.floor(Math.random() * 10) + 1).padStart(2, '0');
    insertFee.run({
      student_id: sid,
      amount: s.fee_amount,
      paid_date: `${year}-${String(month).padStart(2, '0')}-${day}`,
      method,
      period_month: month,
      period_year: year,
      received_by: Math.random() > 0.5 ? adminId : teacherId,
      notes: null,
    });
  }
}

// January 2026 — everyone active paid
seedFeesForMonth(1, 2026, [
  ['Ahmad Zulkifli','cash'], ['Nur Aisyah','bank_transfer'],
  ['Muhammad Hafiz','cash'], ['Siti Fatimah','cash'],
  ['Abdullah Haris','bank_transfer'], ['Khadijah Mohd','cash'],
  ['Ismail Rashid','cash'], ['Maryam Zainab','online'],
  ['Ruqayyah Idris','cash'],
]);

// February 2026 — most paid
seedFeesForMonth(2, 2026, [
  ['Ahmad Zulkifli','cash'], ['Nur Aisyah','cash'],
  ['Muhammad Hafiz','bank_transfer'], ['Siti Fatimah','cash'],
  ['Abdullah Haris','cash'], ['Ismail Rashid','online'],
  ['Ruqayyah Idris','cash'],
]);

// March 2026 — partial payment (some outstanding)
seedFeesForMonth(3, 2026, [
  ['Ahmad Zulkifli','cash'], ['Muhammad Hafiz','cash'],
  ['Abdullah Haris','bank_transfer'], ['Khadijah Mohd','cash'],
]);

console.log('  ✓ Fee payments seeded (Jan–Mar 2026)\n');

// ─── Duty Logs ────────────────────────────────────────────────────────────────
const insertDutyLog = db.prepare(`
  INSERT INTO duty_logs (duty_number, submitted_by, date, status, reviewed_by, reviewed_at, notes)
  VALUES (@duty_number, @submitted_by, @date, @status, @reviewed_by, @reviewed_at, @notes)
`);
const insertDutyItem = db.prepare(`
  INSERT INTO duty_items (duty_log_id, item_name, quantity, unit_price, total_price)
  VALUES (@duty_log_id, @item_name, @quantity, @unit_price, @total_price)
`);

const dutySeeds = [
  {
    duty_number: 'DUTY-2026-001', submitted_by: userIds['student1'],
    date: '2026-03-01', status: 'approved',
    reviewed_by: adminId, reviewed_at: '2026-03-02 09:00:00',
    notes: null,
    items: [
      { item_name: 'Beras 5kg',   quantity: 2, unit_price: 18.00, total_price: 36.00 },
      { item_name: 'Cooking oil',  quantity: 3, unit_price: 9.50,  total_price: 28.50 },
      { item_name: 'Salt',         quantity: 1, unit_price: 2.00,  total_price: 2.00  },
    ],
  },
  {
    duty_number: 'DUTY-2026-002', submitted_by: userIds['student2'],
    date: '2026-03-08', status: 'approved',
    reviewed_by: teacherId, reviewed_at: '2026-03-09 10:30:00',
    notes: null,
    items: [
      { item_name: 'Chicken 1kg',    quantity: 3, unit_price: 14.00, total_price: 42.00 },
      { item_name: 'Mixed vegetables', quantity: 2, unit_price: 5.00,  total_price: 10.00 },
      { item_name: 'Coconut milk',   quantity: 4, unit_price: 3.50,  total_price: 14.00 },
    ],
  },
  {
    duty_number: 'DUTY-2026-003', submitted_by: userIds['student3'],
    date: '2026-03-15', status: 'flagged',
    reviewed_by: adminId, reviewed_at: '2026-03-16 08:00:00',
    notes: 'Oil price does not match the receipt',
    items: [
      { item_name: 'Cooking oil 5L', quantity: 2, unit_price: 28.00, total_price: 56.00 },
      { item_name: 'Wheat flour',    quantity: 1, unit_price: 7.00,  total_price: 7.00  },
    ],
  },
  {
    duty_number: 'DUTY-2026-004', submitted_by: userIds['student1'],
    date: '2026-03-22', status: 'pending',
    reviewed_by: null, reviewed_at: null, notes: null,
    items: [
      { item_name: 'Red onions',     quantity: 2, unit_price: 6.00,  total_price: 12.00 },
      { item_name: 'Garlic',         quantity: 2, unit_price: 5.50,  total_price: 11.00 },
      { item_name: 'Dried chili',    quantity: 1, unit_price: 12.00, total_price: 12.00 },
      { item_name: 'Anchovies 500g', quantity: 1, unit_price: 15.00, total_price: 15.00 },
    ],
  },
  {
    duty_number: 'DUTY-2026-005', submitted_by: userIds['student2'],
    date: '2026-03-29', status: 'pending',
    reviewed_by: null, reviewed_at: null, notes: null,
    items: [
      { item_name: 'Eggs (30)',      quantity: 1, unit_price: 16.00, total_price: 16.00 },
      { item_name: 'Evaporated milk', quantity: 2, unit_price: 4.50,  total_price: 9.00  },
    ],
  },
];

for (const log of dutySeeds) {
  const { items, ...logData } = log;
  const result = insertDutyLog.run(logData);
  const logId = result.lastInsertRowid;
  for (const item of items) {
    insertDutyItem.run({ ...item, duty_log_id: logId });
  }
  console.log(`  ✓ Duty log: ${log.duty_number} (${log.status})`);
}

// ─── General Expenditures ─────────────────────────────────────────────────────
const insertExp = db.prepare(`
  INSERT INTO expenditures (category, description, amount, expense_date, added_by, receipt_ref, notes)
  VALUES (@category, @description, @amount, @expense_date, @added_by, @receipt_ref, @notes)
`);

const expenditures = [
  // January
  { category: 'utilities',  description: 'January electricity bill',  amount: 185.40, expense_date: '2026-01-05', receipt_ref: 'TNB-JAN26', notes: null },
  { category: 'utilities',  description: 'January water bill',        amount: 42.00,  expense_date: '2026-01-05', receipt_ref: 'SAJ-JAN26', notes: null },
  { category: 'supplies',   description: 'Stationery and supplies',   amount: 75.00,  expense_date: '2026-01-12', receipt_ref: null,         notes: null },
  { category: 'transport',  description: 'Van rental for program',    amount: 120.00, expense_date: '2026-01-20', receipt_ref: null,         notes: 'Field trip to JAKIM' },
  { category: 'cleaning',   description: 'Soap and cleaning supplies',amount: 55.00,  expense_date: '2026-01-25', receipt_ref: null,         notes: null },
  // February
  { category: 'utilities',  description: 'February electricity bill', amount: 192.80, expense_date: '2026-02-05', receipt_ref: 'TNB-FEB26', notes: null },
  { category: 'utilities',  description: 'February water bill',       amount: 38.50,  expense_date: '2026-02-05', receipt_ref: 'SAJ-FEB26', notes: null },
  { category: 'rent',       description: 'February building rent',    amount: 800.00, expense_date: '2026-02-01', receipt_ref: 'SEWA-FEB26',notes: null },
  { category: 'food',       description: 'Additional food supplies',  amount: 68.00,  expense_date: '2026-02-14', receipt_ref: null,         notes: 'Maulidur Rasul program' },
  { category: 'other',      description: 'Certificate printing and materials', amount: 45.00,  expense_date: '2026-02-20', receipt_ref: null,         notes: null },
  // March
  { category: 'utilities',  description: 'March electricity bill',    amount: 178.60, expense_date: '2026-03-05', receipt_ref: 'TNB-MAR26', notes: null },
  { category: 'utilities',  description: 'March water bill',          amount: 41.20,  expense_date: '2026-03-05', receipt_ref: 'SAJ-MAR26', notes: null },
  { category: 'rent',       description: 'March building rent',       amount: 800.00, expense_date: '2026-03-01', receipt_ref: 'SEWA-MAR26',notes: null },
  { category: 'supplies',   description: 'Books and learning materials', amount: 130.00, expense_date: '2026-03-10', receipt_ref: null,         notes: 'New semester' },
  { category: 'transport',  description: 'Exam bus fare',             amount: 80.00,  expense_date: '2026-03-18', receipt_ref: null,         notes: null },
  { category: 'cleaning',   description: 'Soap and cleaning supplies', amount: 50.00,  expense_date: '2026-03-22', receipt_ref: null,         notes: null },
];

for (const e of expenditures) {
  insertExp.run({ ...e, added_by: adminId });
}
console.log(`  ✓ ${expenditures.length} expenditure entries seeded (Jan–Mar 2026)\n`);

console.log('✅  Demo seed complete!\n');
console.log('Demo login credentials:');
console.log('  Admin   →  username: admin    | password: admin123');
console.log('  Teacher →  username: teacher1 | password: teacher123');
console.log('  Student →  username: student1 | password: student123');
