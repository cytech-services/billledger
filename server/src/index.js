const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const Database = require('better-sqlite3');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'bills.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);

let db = null;

function connectDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupFileName(reason = 'manual') {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `bills-${reason}-${stamp}.db`;
}

function parseBackupReason(filename) {
  const m = /^bills-([a-z-]+)-\d{8}-\d{6}\.db$/i.exec(filename);
  return m ? m[1].toLowerCase() : 'unknown';
}

async function createBackup(reason = 'manual') {
  ensureBackupDir();
  const filename = backupFileName(reason);
  const fullPath = path.join(BACKUP_DIR, filename);
  await db.backup(fullPath);
  const stat = await fsp.stat(fullPath);
  return {
    filename,
    size: stat.size,
    created_at: stat.mtime.toISOString(),
    reason
  };
}

async function listBackups() {
  ensureBackupDir();
  const files = await fsp.readdir(BACKUP_DIR);
  const dbFiles = files.filter((f) => f.endsWith('.db')).sort().reverse();
  const result = [];
  for (const filename of dbFiles) {
    const stat = await fsp.stat(path.join(BACKUP_DIR, filename));
    result.push({
      filename,
      size: stat.size,
      created_at: stat.mtime.toISOString(),
      reason: parseBackupReason(filename)
    });
  }
  return result;
}

async function getBackupStatus() {
  const all = await listBackups();
  const lastAutomatic = all.find((b) => b.reason === 'scheduled') || null;
  return {
    retention_days: BACKUP_RETENTION_DAYS,
    backup_dir: BACKUP_DIR,
    total_backups: all.length,
    last_automatic_backup: lastAutomatic
  };
}

async function pruneOldBackups() {
  ensureBackupDir();
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = await fsp.readdir(BACKUP_DIR);
  for (const filename of files) {
    if (!filename.endsWith('.db')) continue;
    const fullPath = path.join(BACKUP_DIR, filename);
    const stat = await fsp.stat(fullPath);
    if (stat.mtimeMs < cutoff) {
      await fsp.unlink(fullPath);
    }
  }
}

function startDailyBackupScheduler() {
  const intervalMs = 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await createBackup('scheduled');
      await pruneOldBackups();
      console.log('Scheduled backup complete.');
    } catch (err) {
      console.error('Scheduled backup failed:', err.message);
    }
  }, intervalMs);
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      frequency TEXT NOT NULL,
      due_day INTEGER,
      next_date TEXT,
      amount REAL,
      autopay TEXT DEFAULT 'No',
      method TEXT,
      account TEXT,
      notes TEXT,
      created TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      paid_date TEXT NOT NULL,
      amount REAL,
      method TEXT,
      paid_by TEXT,
      confirm_num TEXT,
      notes TEXT,
      created TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bill_custom_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      due_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_name_nocase ON payment_methods(name COLLATE NOCASE)');

  const migrateColumns = [
    'ALTER TABLE payments ADD COLUMN paid_by TEXT',
    'ALTER TABLE payments ADD COLUMN confirm_num TEXT'
  ];
  for (const stmt of migrateColumns) {
    try {
      db.exec(stmt);
    } catch {
      // Column already exists in most cases.
    }
  }
}

app.use(cors());
app.use(express.json());

const BILL_FIELDS = 'id, name, company, frequency, due_day, next_date, amount, autopay, method, account, notes, created';

function normalizeMethodName(name) {
  return String(name || '').trim();
}

function savePaymentMethod(name) {
  const normalized = normalizeMethodName(name);
  if (!normalized) return;
  db.prepare('INSERT OR IGNORE INTO payment_methods (name) VALUES (?)').run(normalized);
}

function seedPaymentMethods() {
  const defaults = ['Credit Card', 'Debit Card', 'Bank Transfer', 'Check', 'Cash', 'Auto-Pay'];
  for (const name of defaults) {
    savePaymentMethod(name);
  }

  const billMethods = db.prepare("SELECT DISTINCT method FROM bills WHERE method IS NOT NULL AND TRIM(method) <> ''").all();
  const paymentMethods = db
    .prepare("SELECT DISTINCT method FROM payments WHERE method IS NOT NULL AND TRIM(method) <> ''")
    .all();

  for (const row of [...billMethods, ...paymentMethods]) {
    savePaymentMethod(row.method);
  }
}

function isoDate(input) {
  const d = new Date(`${input}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${input}`);
  }
  return d;
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addMonthsSafe(d, months) {
  const originalDay = d.getDate();
  const next = new Date(d);
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(originalDay, lastDay));
  return next;
}

function addYearsSafe(d, years) {
  return addMonthsSafe(d, years * 12);
}

function shiftDate(d, frequency, direction = 1) {
  const dir = direction >= 0 ? 1 : -1;
  switch (frequency) {
    case 'Bi-Monthly':
      return addMonthsSafe(d, 2 * dir);
    case 'Bi-Weekly': {
      const n = new Date(d);
      n.setDate(n.getDate() + 14 * dir);
      return n;
    }
    case 'Quarterly':
      return addMonthsSafe(d, 3 * dir);
    case 'Semi-Annual':
      return addMonthsSafe(d, 6 * dir);
    case 'Annual':
      return addYearsSafe(d, 1 * dir);
    default:
      return null;
  }
}

function calcOccurrences(bill, startDate, endDate) {
  const freq = bill.frequency;
  const result = [];

  if (freq === 'Custom') {
    return db
      .prepare('SELECT due_date FROM bill_custom_dates WHERE bill_id = ? AND due_date BETWEEN ? AND ? ORDER BY due_date')
      .all(bill.id, formatDate(startDate), formatDate(endDate))
      .map((row) => row.due_date);
  }

  if (freq === 'Monthly') {
    const day = Number(bill.due_day);
    if (!day) return [];

    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (cursor <= endDate) {
      const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const occ = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(day, last));
      if (occ >= startDate && occ <= endDate) {
        result.push(formatDate(occ));
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return result;
  }

  if (freq === 'Weekly') {
    const day = bill.due_day;
    if (day == null) return [];

    const pyDay = ((Number(day) - 1) % 7 + 7) % 7;
    const targetWeekday = pyDay;
    const cursor = new Date(startDate);
    while (cursor.getDay() !== ((targetWeekday + 1) % 7)) {
      cursor.setDate(cursor.getDate() + 1);
    }
    while (cursor <= endDate) {
      result.push(formatDate(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return result;
  }

  if (!bill.next_date) return [];

  let anchor = isoDate(bill.next_date);
  if (anchor > startDate) {
    while (anchor > startDate) {
      const shifted = shiftDate(anchor, freq, -1);
      if (!shifted) break;
      anchor = shifted;
    }
  }

  while (anchor < startDate) {
    const shifted = shiftDate(anchor, freq, 1);
    if (!shifted) break;
    anchor = shifted;
  }

  while (anchor <= endDate) {
    result.push(formatDate(anchor));
    const shifted = shiftDate(anchor, freq, 1);
    if (!shifted) break;
    anchor = shifted;
  }

  return result;
}

function getBillById(id) {
  return db.prepare(`SELECT ${BILL_FIELDS} FROM bills WHERE id = ?`).get(id);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/backups', async (_req, res) => {
  const backups = await listBackups();
  res.json(backups);
});

app.get('/api/backups/status', async (_req, res) => {
  const status = await getBackupStatus();
  res.json(status);
});

app.post('/api/backups', async (_req, res) => {
  const backup = await createBackup('manual');
  await pruneOldBackups();
  res.status(201).json({ ok: true, backup });
});

app.post('/api/backups/restore', async (req, res) => {
  const filename = path.basename(String(req.body?.filename || '').trim());
  if (!filename || !filename.endsWith('.db')) {
    res.status(400).json({ error: 'Valid backup filename is required' });
    return;
  }

  const backupPath = path.join(BACKUP_DIR, filename);
  try {
    await fsp.access(backupPath);
  } catch {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }

  // Always create a restore-point backup before replacing the live DB file.
  await createBackup('pre-restore');

  db.close();
  for (const suffix of ['-wal', '-shm']) {
    try {
      await fsp.unlink(`${DB_PATH}${suffix}`);
    } catch {
      // ignore missing sidecar files
    }
  }

  await fsp.copyFile(backupPath, DB_PATH);
  connectDb();
  initDb();
  seedPaymentMethods();

  res.json({ ok: true, restored_from: filename });
});

app.get('/api/backups/:filename/download', async (req, res) => {
  const filename = path.basename(String(req.params.filename || '').trim());
  if (!filename || !filename.endsWith('.db')) {
    res.status(400).json({ error: 'Valid backup filename is required' });
    return;
  }

  const backupPath = path.join(BACKUP_DIR, filename);
  try {
    await fsp.access(backupPath);
  } catch {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }

  res.download(backupPath, filename);
});

app.get('/api/bills', (_req, res) => {
  const bills = db.prepare(`SELECT ${BILL_FIELDS} FROM bills ORDER BY name`).all();
  res.json(bills);
});

app.post('/api/bills', (req, res) => {
  const d = req.body;
  const insert = db.prepare(
    `INSERT INTO bills (name, company, frequency, due_day, next_date, amount, autopay, method, account, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const info = insert.run(
      d.name,
      d.company || '',
      d.frequency,
      d.due_day || null,
      d.next_date || null,
      d.amount || null,
      d.autopay || 'No',
      d.method || '',
      d.account || '',
      d.notes || ''
    );

    const billId = info.lastInsertRowid;
    const insertCustomDate = db.prepare(
      'INSERT INTO bill_custom_dates (bill_id, due_date) VALUES (?, ?)'
    );

    for (const dt of d.custom_dates || []) {
      if (dt) insertCustomDate.run(billId, dt);
    }

    savePaymentMethod(d.method);
    return billId;
  });

  const billId = tx();
  res.status(201).json(getBillById(billId));
});

app.put('/api/bills/:id', (req, res) => {
  const billId = Number(req.params.id);
  const d = req.body;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE bills
       SET name = ?, company = ?, frequency = ?, due_day = ?, next_date = ?, amount = ?, autopay = ?, method = ?, account = ?, notes = ?
       WHERE id = ?`
    ).run(
      d.name,
      d.company || '',
      d.frequency,
      d.due_day || null,
      d.next_date || null,
      d.amount || null,
      d.autopay || 'No',
      d.method || '',
      d.account || '',
      d.notes || '',
      billId
    );

    db.prepare('DELETE FROM bill_custom_dates WHERE bill_id = ?').run(billId);
    const insertCustomDate = db.prepare(
      'INSERT INTO bill_custom_dates (bill_id, due_date) VALUES (?, ?)'
    );
    for (const dt of d.custom_dates || []) {
      if (dt) insertCustomDate.run(billId, dt);
    }

    savePaymentMethod(d.method);
  });

  tx();
  res.json(getBillById(billId));
});

app.delete('/api/bills/:id', (req, res) => {
  const billId = Number(req.params.id);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM payments WHERE bill_id = ?').run(billId);
    db.prepare('DELETE FROM bill_custom_dates WHERE bill_id = ?').run(billId);
    db.prepare('DELETE FROM bills WHERE id = ?').run(billId);
  });

  tx();
  res.json({ ok: true });
});

app.get('/api/bills/:id/details', (req, res) => {
  const billId = Number(req.params.id);
  const bill = getBillById(billId);
  if (!bill) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const payments = db
    .prepare('SELECT * FROM payments WHERE bill_id = ? ORDER BY paid_date DESC LIMIT 50')
    .all(billId);

  const today = startOfDay();
  const end = new Date(today);
  end.setDate(end.getDate() + 730);
  const upcoming = calcOccurrences(bill, today, end).slice(0, 12);

  const customDates = db
    .prepare('SELECT due_date FROM bill_custom_dates WHERE bill_id = ? ORDER BY due_date')
    .all(billId)
    .map((row) => row.due_date);

  res.json({ bill, payments, upcoming, custom_dates: customDates });
});

app.get('/api/payments', (req, res) => {
  const { bill_id: billId, month } = req.query;
  let sql =
    'SELECT p.*, b.name AS bill_name FROM payments p JOIN bills b ON p.bill_id = b.id WHERE 1 = 1';
  const args = [];

  if (billId) {
    sql += ' AND p.bill_id = ?';
    args.push(billId);
  }

  if (month) {
    sql += " AND strftime('%Y-%m', p.paid_date) = ?";
    args.push(month);
  }

  sql += ' ORDER BY p.paid_date DESC';
  res.json(db.prepare(sql).all(...args));
});

app.get('/api/payment-methods', (_req, res) => {
  const methods = db
    .prepare('SELECT name FROM payment_methods ORDER BY name COLLATE NOCASE')
    .all()
    .map((row) => row.name);
  res.json(methods);
});

app.get('/api/payment-methods/stats', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
        pm.name,
        (
          SELECT COUNT(DISTINCT p.bill_id)
          FROM payments p
          WHERE lower(trim(p.method)) = lower(trim(pm.name))
        ) AS bill_count,
        (
          SELECT COUNT(*)
          FROM payments p
          WHERE lower(trim(p.method)) = lower(trim(pm.name))
        ) AS payment_count,
        (
          SELECT COALESCE(SUM(COALESCE(p.amount, 0)), 0)
          FROM payments p
          WHERE lower(trim(p.method)) = lower(trim(pm.name))
        ) AS total_paid
      FROM payment_methods pm
      ORDER BY pm.name COLLATE NOCASE`
    )
    .all();

  res.json(rows);
});

app.post('/api/payment-methods', (req, res) => {
  const name = normalizeMethodName(req.body?.name);
  if (!name) {
    res.status(400).json({ error: 'Method name is required' });
    return;
  }

  savePaymentMethod(name);
  res.status(201).json({ ok: true, name });
});

app.post('/api/payment-methods/replace', (req, res) => {
  const from = normalizeMethodName(req.body?.from);
  const to = normalizeMethodName(req.body?.to);
  const replaceBillDefaults = req.body?.replace_bill_defaults !== false;

  if (!from || !to) {
    res.status(400).json({ error: 'Both from and to method names are required' });
    return;
  }

  if (from.toLowerCase() === to.toLowerCase()) {
    res.status(400).json({ error: 'Replacement method must be different' });
    return;
  }

  const tx = db.transaction(() => {
    savePaymentMethod(to);
    const paymentsUpdated = db
      .prepare('UPDATE payments SET method = ? WHERE lower(trim(method)) = lower(?)')
      .run(to, from).changes;

    let billsUpdated = 0;
    if (replaceBillDefaults) {
      billsUpdated = db
        .prepare('UPDATE bills SET method = ? WHERE lower(trim(method)) = lower(?)')
        .run(to, from).changes;
    }

    return { paymentsUpdated, billsUpdated };
  });

  const result = tx();
  res.json({ ok: true, ...result });
});

app.delete('/api/payment-methods/:name', (req, res) => {
  const name = normalizeMethodName(decodeURIComponent(req.params.name || ''));
  if (!name) {
    res.status(400).json({ error: 'Method name is required' });
    return;
  }

  const inBills = db.prepare('SELECT COUNT(*) AS count FROM bills WHERE lower(trim(method)) = lower(?)').get(name).count;
  const inPayments = db
    .prepare('SELECT COUNT(*) AS count FROM payments WHERE lower(trim(method)) = lower(?)')
    .get(name).count;

  if (inPayments > 0) {
    res.status(409).json({
      error: 'This method is used by existing payments and must be replaced before deleting.',
      requires_replacement: true,
      payment_count: inPayments,
      bill_count: inBills
    });
    return;
  }

  db.prepare('DELETE FROM payment_methods WHERE lower(trim(name)) = lower(?)').run(name);
  res.json({ ok: true });
});

app.post('/api/payments', (req, res) => {
  const d = req.body;
  const bill = getBillById(d.bill_id);
  if (!bill) {
    res.status(404).json({ error: 'Bill not found' });
    return;
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO payments (bill_id, paid_date, amount, method, paid_by, confirm_num, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      d.bill_id,
      d.paid_date,
      d.amount || bill.amount,
      d.method || bill.method || '',
      d.paid_by || '',
      d.confirm_num || '',
      d.notes || ''
    );

    savePaymentMethod(d.method || bill.method || '');

    if (bill.next_date) {
      let dt = isoDate(bill.next_date);
      const today = startOfDay();
      let next = shiftDate(dt, bill.frequency, 1);
      while (next && next <= today) {
        dt = next;
        next = shiftDate(dt, bill.frequency, 1);
      }
      if (next) {
        db.prepare('UPDATE bills SET next_date = ? WHERE id = ?').run(formatDate(next), bill.id);
      }
    }
  });

  tx();
  res.status(201).json({ ok: true });
});

app.delete('/api/payments/:id', (req, res) => {
  db.prepare('DELETE FROM payments WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/year-view', (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const today = startOfDay();

  const yearStart = new Date(year, 0, 1);
  const start = today > yearStart ? today : yearStart;
  const end = new Date(year, 11, 31);

  const bills = db.prepare(`SELECT ${BILL_FIELDS} FROM bills ORDER BY name`).all();
  const buffer = new Date(year, 0, 1);
  buffer.setDate(buffer.getDate() - 45);

  const allPayments = db
    .prepare('SELECT * FROM payments WHERE paid_date BETWEEN ? AND ?')
    .all(formatDate(buffer), formatDate(end));

  const payMap = new Map();
  for (const p of allPayments) {
    const arr = payMap.get(p.bill_id) || [];
    arr.push(p);
    payMap.set(p.bill_id, arr);
  }

  const allOccurrences = [];
  for (const bill of bills) {
    const billPays = payMap.get(bill.id) || [];

    for (const occStr of calcOccurrences(bill, start, end)) {
      const occDate = isoDate(occStr);

      const paymentEntry = billPays.find((p) => {
        const pd = isoDate(p.paid_date);
        return Math.abs((pd.getTime() - occDate.getTime()) / 86400000) <= 14;
      });

      let status = 'upcoming';
      if (paymentEntry) {
        status = 'paid';
      } else if (occDate < today) {
        status = 'overdue';
      } else if ((occDate.getTime() - today.getTime()) / 86400000 <= 15) {
        status = 'due-soon';
      }

      allOccurrences.push({
        bill_id: bill.id,
        bill_name: bill.name,
        company: bill.company || '',
        amount: bill.amount,
        due_date: occStr,
        frequency: bill.frequency,
        autopay: bill.autopay,
        status,
        paid_date: paymentEntry ? paymentEntry.paid_date : null,
        paid_by: paymentEntry ? paymentEntry.paid_by : null
      });
    }
  }

  allOccurrences.sort((a, b) => a.due_date.localeCompare(b.due_date));

  const months = {};
  for (const occ of allOccurrences) {
    const monthKey = occ.due_date.slice(0, 7);
    if (!months[monthKey]) {
      months[monthKey] = { occurrences: [], total: 0, total_unpaid: 0 };
    }
    months[monthKey].occurrences.push(occ);
    months[monthKey].total += occ.amount || 0;
    if (occ.status !== 'paid') {
      months[monthKey].total_unpaid += occ.amount || 0;
    }
  }

  res.json({
    year,
    year_total: allOccurrences.reduce((sum, occ) => sum + (occ.amount || 0), 0),
    year_unpaid: allOccurrences
      .filter((occ) => occ.status !== 'paid')
      .reduce((sum, occ) => sum + (occ.amount || 0), 0),
    count: allOccurrences.length,
    months: Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }))
  });
});

app.get('/api/summary', (_req, res) => {
  const month = formatDate(new Date()).slice(0, 7);
  const totalBills = db.prepare('SELECT COUNT(*) AS count FROM bills').get().count;
  const paidThisMonth = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE strftime('%Y-%m', paid_date) = ?")
    .get(month).total;

  res.json({
    total_bills: totalBills,
    paid_this_month: paidThisMonth,
    today: formatDate(new Date())
  });
});

connectDb();
initDb();
seedPaymentMethods();
ensureBackupDir();
startDailyBackupScheduler();

app.listen(PORT, () => {
  console.log(`Bill Ledger API running on http://127.0.0.1:${PORT}`);
  console.log(`Using database at: ${DB_PATH}`);
  console.log(`Backups directory: ${BACKUP_DIR}`);
});
