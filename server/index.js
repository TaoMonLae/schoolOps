require('dotenv').config();

const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');

const authRoutes        = require('./routes/auth');
const studentRoutes     = require('./routes/students');
const feeRoutes         = require('./routes/fees');
const dutyRoutes        = require('./routes/duty');
const expenditureRoutes = require('./routes/expenditures');
const reportRoutes      = require('./routes/reports');
const attachmentRoutes  = require('./routes/attachments');
const userRoutes        = require('./routes/users');
const settingsRoutes    = require('./routes/settings');
const systemRoutes      = require('./routes/system');
const inventoryRoutes   = require('./routes/inventory');
const notificationRoutes = require('./routes/notifications');
const attendanceRoutes = require('./routes/attendance');
const accountRoutes    = require('./routes/accounts');
const cashbookRoutes   = require('./routes/cashbook');
const fundsRoutes      = require('./routes/funds');
const closingRoutes    = require('./routes/closing');
const { initializeDefaultSettings } = require('./services/settings');
const { DB_PATH, UPLOAD_DIR, BACKUP_DIR, ensureRuntimeDirectories } = require('./config/paths');

initializeDefaultSettings();
ensureRuntimeDirectories();

if (process.env.NODE_ENV === 'production') {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json());
app.use(cookieParser());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter);
app.use('/api/auth',         authRoutes);
app.use('/api/students',     studentRoutes);
app.use('/api/fees',         feeRoutes);
app.use('/api/duty',         dutyRoutes);
app.use('/api/expenditures', expenditureRoutes);
app.use('/api/reports',      reportRoutes);
app.use('/api/attachments',  attachmentRoutes);
app.use('/api/users',        userRoutes);
app.use('/api/settings',     settingsRoutes);
app.use('/api/system',       systemRoutes);
app.use('/api/inventory',    inventoryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/accounts',  accountRoutes);
app.use('/api/cashbook',  cashbookRoutes);
app.use('/api/funds',     fundsRoutes);
app.use('/api/closing',   closingRoutes);

// ─── SPA fallback — serve index.html for any non-API route ───────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`\n📚  SchoolOps running at http://localhost:${PORT}`);
  console.log(`   DB path: ${DB_PATH}`);
  console.log(`   Upload path: ${UPLOAD_DIR}`);
  console.log(`   Backup path: ${BACKUP_DIR}`);
  console.log(`   Press Ctrl+C to stop.\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error('Stop the existing server process or change PORT before starting SchoolOps again.\n');
    process.exit(1);
  }

  throw err;
});
