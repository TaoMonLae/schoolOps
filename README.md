#Finance & Operations Ledger

Created by Tao Mon Lae / App Version 1.0

A full-stack web app for managing student fees, attendance, hostel/boarding assignments, daily duty logs, general expenses, inventory/stock control, and monthly financial reports.

---

## Development Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) **22 LTS** (required)

> `better-sqlite3` in this project is pinned for the Node 22 LTS runtime and may fail to build/run on Node 23+.
>
> Recommended:
> ```bash
> nvm use
> ```
> (This repo includes `.nvmrc` with `22`.)

### 2. Install dependencies
```bash
npm install
```

### 3. (Optional) Seed demo data
```bash
npm run seed:demo
```
This creates the SQLite database and populates it with sample students, fee payments, duty logs, and expenditures for January–March 2026.

### 4. Start the server
```bash
npm start
```
Open **http://localhost:3000** in your browser.

---

## Demo Login Credentials (development only)

| Role    | Username   | Password     |
|---------|------------|--------------|
| Admin   | `admin`    | `admin123`   |
| Teacher | `teacher1` | `teacher123` |
| Student | `student1` | `student123` |

> **Important:** These credentials come from demo seed data and are **not for production use**.

---

## Production Setup (Ubuntu/Linux)

### 1. Install and configure
```bash
git clone https://github.com/TaoMonLae/school_ledger.git
cd school_ledger
nvm use
npm install --omit=dev
```

### 2. Prepare production environment file
```bash
cp .env.example .env
```

Edit `.env` with production values:
- `NODE_ENV=production`
- `JWT_SECRET` as a long random value (32+ characters)
- **absolute paths** for `DB_PATH`, `UPLOAD_DIR`, and `BACKUP_DIR`
- `BOOTSTRAP_ADMIN_*` values for first admin creation

### 3. Bootstrap the first real admin user
```bash
npm run bootstrap:admin
```

This script is safe to rerun:
- If the configured admin already exists, it will not create duplicates.
- It does **not** create demo students, demo fee payments, or demo expenditures.

### 4. First production start
```bash
npm start
```

On startup the app creates missing runtime directories for DB parent folder, uploads, and backups.

### 5. Backup procedure (DB + uploads)
Always preserve both:
1. SQLite DB file (`DB_PATH`)
2. Upload files (`UPLOAD_DIR`)

Example:
```bash
TS=$(date +%F-%H%M%S)
cp /var/lib/school-ledger/ledger.sqlite /var/backups/school-ledger/ledger-$TS.sqlite
tar -C /var/lib/school-ledger -czf /var/backups/school-ledger/uploads-$TS.tar.gz uploads
```

### 6. Restore procedure (manual safe restore)
1. Stop the app/service.
2. Restore the SQLite DB file to `DB_PATH`.
3. Restore uploads folder contents to `UPLOAD_DIR`.
4. Ensure ownership/permissions are correct for the app user.
5. Start app and verify login + attachment downloads.

### 7. Upgrade / redeploy procedure
```bash
git fetch --all --tags
git checkout <release-tag-or-commit>
npm ci --omit=dev
npm start
```

Do **not** run `npm run seed:demo` in production. The seed script refuses to run in production unless `ALLOW_DEMO_SEED=true` is explicitly set.

---

## Features by Role

### Admin
- **Dashboard** — Monthly snapshot: paid/unpaid counts, arrears spotlight, income vs expenses
- **Attendance & Hostel** — Take daily attendance (present/absent/late/excused + notes), review attendance history, export monthly attendance CSV, and manage dorm/house/room/bed assignments
- **Student Roster** — Enroll, edit, deactivate students; view per-student fee history; manage parent/guardian/emergency/sponsor contacts with preferred + active flags
- **Fee Payments** — Record/open payments, generate printable receipt PDFs (with verification code + duplicate watermark option), arrears-aware status badges, and unpaid slip PDF notices
- **Duty Logs** — View, approve, or flag all student-submitted duty logs
- **General Expenditures** — Add/edit/delete expenses by category (utilities, rent, supplies, etc.), with receipt attachments and optional stock purchase linkage
- **Inventory & Stock** — Track rice/oil/eggs/cleaning/stationery/toiletries/medicine/custom items, set reorder levels, and post quick stock adjustments
- **Settings & Branding** — Configure school name, subtitle, report footer, currency, and contact block from admin UI
- **Reports (Monthly / Yearly / Trends)** — Monthly financial summary with appendices, yearly rollup, trend analytics, Excel export for monthly/yearly, student-guardian contact Excel export, and PDF for monthly using dynamic branding/currency
- **User Management** — Create users, edit profile/role/username, deactivate accounts, disable login, and reset user passwords
- **In-app Notifications & Reminders** — Bell panel with unread count, mark read/all read, filter by type/status, and admin reminder batches (unpaid fees + low stock)
- **Account Security** — Change own password and enforce first-login password change for temporary/reset passwords
- **Backup & Health** — Download SQLite backup, create manual backup snapshot, and view system status (DB path/app version/environment/last backup)

### Teacher
- **Dashboard** — Read-only monthly overview with arrears metrics
- **Attendance & Hostel** — Manage daily attendance records, review history, see attendance percentages, and maintain basic hostel assignments
- **Student Roster (Read-only)** — View students and contact details (including primary parent/guardian contact)
- **Fee Status** — View paid/unpaid/overdue tabs, open payment records, print receipt PDFs, and print unpaid fee slips
- **Duty Review** — Approve or flag submitted duty logs, view supporting attachments, and optionally record stock consumption on duty items
- **Inventory & Stock** — View item balances, low-stock warnings, and stock movement history
- **Reports (Monthly / Yearly / Trends)** — View analytics and export (monthly PDF + monthly/yearly Excel)

### Student
- **Submit Duty Log** — Enter duty number, date, itemised shopping list, and optional attachment
- **My History** — View own past submissions, review status, and manage own duty-log attachments

---

## Configuration

Copy `.env.example` to `.env` and edit as needed:

```
PORT=3000
NODE_ENV=production
JWT_SECRET=replace_with_a_long_random_secret
DB_PATH=/var/lib/school-ledger/ledger.sqlite
UPLOAD_DIR=/var/lib/school-ledger/uploads
BACKUP_DIR=/var/backups/school-ledger
SCHOOL_LAT=3.135142303974718
SCHOOL_LNG=101.7173772766529
SCHOOL_GEOFENCE_RADIUS_M=100
MAX_LOCATION_ACCURACY_M=80
```

---

## Project Structure

```
MRLC_Ledger/
├── server/
│   ├── db/
│   │   ├── schema.sql       ← Database schema
│   │   ├── database.js      ← SQLite connection + audit helper
│   │   ├── seed.js          ← Demo data seeder (development)
│   │   └── bootstrap-admin.js ← Production-safe first admin bootstrap
│   ├── config/
│   │   └── paths.js         ← Resolved storage paths + runtime directory setup
│   ├── routes/
│   │   ├── auth.js          ← Login / logout / me / change-password
│   │   ├── users.js         ← Admin user management endpoints
│   │   ├── students.js      ← Student CRUD
│   │   ├── fees.js          ← Fee payment CRUD
│   │   ├── duty.js          ← Duty log submit + review
│   │   ├── expenditures.js  ← General expenditure CRUD (+ optional stock purchase link)
│   │   ├── inventory.js     ← Inventory items, categories, and stock movement APIs
│   │   ├── notifications.js ← In-app notifications + reminder batch APIs
│   │   └── reports.js       ← Financial + stock reporting + Excel/PDF export
│   ├── middleware/
│   │   └── auth.js          ← JWT verify + role guard
│   └── index.js             ← Express entry point
├── public/
│   ├── index.html           ← SPA shell
│   ├── app.js               ← React app + routing
│   └── components/
│       ├── utils.js         ← Shared helpers, Toast, Modal
│       ├── Dashboard.js
│       ├── Students.js
│       ├── Fees.js
│       ├── DutyLog.js
│       ├── Expenditures.js
│       ├── Notifications.js
│       └── Reports.js
├── .env                     ← Environment config (do not commit)
├── .env.example
├── package.json
└── README.md
```

---

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Backend  | Node.js + Express                   |
| Database | SQLite via better-sqlite3           |
| Frontend | React 18 (CDN) + Babel standalone   |
| Auth     | JWT (httpOnly cookies, 8h expiry)   |
| Export   | SheetJS (Excel) + PDFKit (PDF)      |

---

## API Reference

| Method | Path                            | Auth Required   | Description                 |
|--------|---------------------------------|-----------------|-----------------------------|
| POST   | `/api/auth/login`               | —               | Login, set cookie           |
| POST   | `/api/auth/logout`              | —               | Clear cookie                |
| GET    | `/api/auth/me`                  | Any             | Get current user            |
| POST   | `/api/auth/change-password`     | Any             | Change own password         |
| GET    | `/api/students`                 | admin/teacher   | List with fee/arrears status|
| GET    | `/api/users`                    | admin           | List users                  |
| POST   | `/api/users`                    | admin           | Create user                 |
| PUT    | `/api/users/:id`                | admin           | Edit user/name/role/status  |
| POST   | `/api/users/:id/reset-password` | admin           | Reset user password         |
| GET    | `/api/students/arrears`         | admin/teacher   | Active-student arrears view |
| GET    | `/api/students/:id/contacts`    | admin/teacher   | List a student's contact records |
| POST   | `/api/students/:id/contacts`    | admin           | Add contact for a student |
| PUT    | `/api/students/:id/contacts/:contactId` | admin | Update contact record |
| DELETE | `/api/students/:id/contacts/:contactId` | admin | Soft-deactivate contact record |
| GET    | `/api/students/contacts/search?search=` | admin/teacher | Search contacts by student/contact/phone |
| POST   | `/api/students`                 | admin           | Enroll student              |
| PUT    | `/api/students/:id`             | admin           | Update student              |
| DELETE | `/api/students/:id`             | admin           | Deactivate student          |
| GET    | `/api/attendance`               | admin/teacher   | Daily attendance sheet by date (`date`, `boarder`) |
| POST   | `/api/attendance/bulk`          | admin/teacher   | Bulk upsert attendance rows for a date |
| GET    | `/api/attendance/history`       | admin/teacher   | Attendance history + per-student attendance % (`from`, `to`, `status`, `boarder`) |
| GET    | `/api/attendance/today-summary` | admin/teacher   | Today attendance widget summary + absent list + repeated-absence alerts |
| PUT    | `/api/attendance/hostel/:studentId` | admin/teacher | Update student hostel assignment (status/dorm/room/bed) |
| GET    | `/api/attendance/export/monthly`| admin/teacher   | Export monthly attendance CSV (`month`, `year`) |
| GET    | `/api/fees`                     | admin/teacher   | All payments (filterable)   |
| GET    | `/api/fees/:id`                | admin/teacher   | Payment details (receipt metadata) |
| GET    | `/api/fees/student/:id`         | admin/teacher   | Per-student history         |
| GET    | `/api/fees/:id/receipt/pdf`    | admin/teacher   | Download printable payment receipt PDF |
| POST   | `/api/fees`                     | admin/teacher   | Record payment              |
| DELETE | `/api/fees/:id`                 | admin           | Void payment                |
| GET    | `/api/students/:id/fee-slip/pdf?month=&year=` | admin/teacher | Download printable unpaid fee slip PDF |
| GET    | `/api/duty`                     | any             | Logs (role-filtered)        |
| POST   | `/api/duty`                     | any             | Submit duty log             |
| PUT    | `/api/duty/:id/status`          | admin/teacher   | Approve / flag              |
| POST   | `/api/attachments/:entityType/:entityId` | admin or owner student (duty only) | Upload attachment |
| GET    | `/api/attachments/:entityType/:entityId` | role-based      | List attachments            |
| GET    | `/api/attachments/:entityType/:entityId/:attachmentId/download` | role-based | View/download attachment |
| DELETE | `/api/attachments/:entityType/:entityId/:attachmentId` | admin or owner student (duty only) | Delete attachment |
| GET    | `/api/expenditures`             | admin/teacher   | All (filterable)            |
| POST   | `/api/expenditures`             | admin           | Add expenditure             |
| PUT    | `/api/expenditures/:id`         | admin           | Edit expenditure            |
| DELETE | `/api/expenditures/:id`         | admin           | Delete expenditure          |
| GET    | `/api/inventory/items`          | any auth        | List inventory items (students see active only) |
| POST   | `/api/inventory/items`          | admin           | Create inventory item      |
| PUT    | `/api/inventory/items/:id`      | admin           | Update inventory item      |
| GET    | `/api/inventory/categories`     | admin/teacher   | List stock categories      |
| POST   | `/api/inventory/categories`     | admin           | Create custom category     |
| GET    | `/api/inventory/movements`      | admin/teacher   | List stock movements       |
| POST   | `/api/inventory/movements`      | admin/teacher   | Record stock movement      |
| GET    | `/api/inventory/dashboard`      | admin/teacher   | Dashboard inventory widgets|
| GET    | `/api/notifications`             | any auth        | List own notifications (`status`, `type`, `limit`) |
| GET    | `/api/notifications/summary`     | any auth        | Get unread notification count |
| POST   | `/api/notifications/:id/read`    | any auth        | Mark one notification as read |
| POST   | `/api/notifications/read-all`    | any auth        | Mark all own notifications as read |
| POST   | `/api/notifications/reminders/unpaid-fees` | admin | Generate arrears reminder batch |
| POST   | `/api/notifications/reminders/low-stock`   | admin | Generate low-stock reminder batch |
| GET    | `/api/reports/monthly`          | admin/teacher   | Monthly summary JSON        |
| GET    | `/api/reports/yearly`           | admin/teacher   | Yearly summary by month + category totals |
| GET    | `/api/reports/trends`           | admin/teacher   | Rolling trend points for charting |
| GET    | `/api/reports/stock/current`    | admin/teacher   | Current stock report JSON  |
| GET    | `/api/reports/stock/monthly-summary` | admin/teacher | Monthly stock movement summary |
| GET    | `/api/reports/export/excel`     | admin/teacher   | Download .xlsx              |
| GET    | `/api/reports/export/yearly-excel` | admin/teacher| Download yearly summary .xlsx |
| GET    | `/api/reports/export/unpaid-excel` | admin/teacher   | Unpaid/arrears .xlsx export |
| GET    | `/api/reports/export/student-contacts-excel` | admin/teacher | Student + guardian contact list .xlsx export |
| GET    | `/api/reports/export/pdf`       | admin/teacher   | Download .pdf               |
| GET    | `/api/settings/public`           | —               | Public branding settings for login/app |
| GET    | `/api/settings`                  | admin           | Get system settings |
| PUT    | `/api/settings`                  | admin           | Update system settings |
| GET    | `/api/system/status`             | admin           | Health/status info (DB path, env, version, last backup) |
| GET    | `/api/system/backup/download`    | admin           | Download SQLite DB backup |
| POST   | `/api/system/backup/create`      | admin           | Create backup file in backup dir |
| GET    | `/api/system/backup/instructions`| admin           | Backup path + local Ubuntu instructions |

---

## Arrears Tracking

The arrears engine works on **active students** and supports filtering by month/year:

- `current` = 0 overdue months
- `overdue` = 1 overdue month
- `serious` = 2+ overdue months

API example:

```http
GET /api/students/arrears?month=4&year=2026&status=serious&search=tahfiz
```

Each row includes:

- `current_month_status` (`paid` / `unpaid`)
- `overdue_months`
- `outstanding_amount`
- `last_paid_month`, `last_paid_year`
- `arrears_status`

Notes on fee frequency:

- `monthly`: full arrears computation
- `yearly` / `one-time`: handled gracefully without monthly overdue inflation

---

## Attendance & Hostel Tracking

The attendance module is designed for boarding-school workflows:

- **Daily statuses:** `present`, `absent`, `late`, `excused`, with optional notes per student/date.
- **Hostel profile fields on student records:** `dorm_house`, `room`, optional `bed_number`, `hostel_status` (`boarder` / `non_boarder` / `inactive`).
- **Role restrictions:** only **admin/teacher** can create/update attendance and hostel assignment data.
- **Dashboard widgets:** Today’s attendance summary and absent student list.
- **Export:** Monthly attendance CSV (`/api/attendance/export/monthly?month=4&year=2026`).
- **Nice-to-have included:** boarder/non-boarder filter, attendance percentage in history, repeated absence alert (3+ absences in last 14 days).

---

## Operational Notes

- `npm start` is production-safe and does not require nodemon.
- `npm run dev` remains available for local development only.
- `npm run seed:demo` is for development/demo only and injects sample records.
- `npm run bootstrap:admin` is the safe production bootstrap path.

### Attachment Storage (Local Filesystem)

Attachments are stored on local disk (no cloud storage) and metadata is stored in SQLite.

- Allowed file types: **pdf, jpg/jpeg, png, webp**
- Max file size: **5MB per file**
- Storage directories are auto-created under `UPLOAD_DIR`:
  - `expenditures/`
  - `duty_logs/`

### Built-in backup endpoints

System backup tools are available from **Admin → Settings / System Status**.

- Download DB directly from UI (`/api/system/backup/download`)
- Create server-side snapshot (`/api/system/backup/create`) into `BACKUP_DIR`
- Check DB path and instructions from `/api/system/backup/instructions`

These endpoints cover database backup only. You must separately preserve `UPLOAD_DIR`.

---

## Local Account Management

- New accounts can be created by admins with an initial password and an optional **force password change on first login** flag.
- Admin password resets can be marked as temporary to force the user to change it on next login.
- The system blocks changes that would lock out the **only remaining active admin** account (deactivate, disable login, or role downgrade).
- User-management actions are recorded in `audit_log`.



## Inventory Migration / Setup

Inventory support is auto-migrated on server startup (SQLite-friendly, no external migration tool needed):

- Creates `stock_categories`, `inventory_items`, `stock_movements` if missing.
- Adds inventory-link columns to `expenditures` and `duty_items` if missing.
- Creates `student_contacts` for guardian/emergency contact management if missing.
- Seeds default categories and starter items (rice, oil, eggs, cleaning supplies, stationery, toiletries, medicine, other).

### Local run commands

```bash
# 1) Install deps
npm install

# 2) (Optional first-time demo data)
npm run seed:demo

# 3) Start app (runs schema + migration automatically)
npm start
```

Then open `http://localhost:3000` and go to **Inventory** in the sidebar.


## Notifications & Reminder Batches

This release adds a local-first in-app notifications module (no email/SMS required yet).

### Notification events currently generated
- Duty log flagged
- Duty log approved
- Password reset
- First-login password change required
- Arrears threshold crossed (2+ months overdue)
- Low-stock alert

### Admin reminder utilities
- `POST /api/notifications/reminders/unpaid-fees` to generate arrears reminder batch
- `POST /api/notifications/reminders/low-stock` to generate low-stock reminder batch

### Future channel extension path
Current delivery channel is `in_app`. The notification service is structured so SMS/email channels can be added later without changing event trigger points.
