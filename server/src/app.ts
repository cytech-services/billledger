import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import Database from 'better-sqlite3';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';

export const app = express();

export const PORT = Number(process.env.PORT || 3001);
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'bills.db');
export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
export const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);
export const OCCURRENCE_FUTURE_YEARS = Number(process.env.OCCURRENCE_FUTURE_YEARS || 2);

let db: Database.Database | null = null;

export function connectDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

function ensureDb() {
  if (!db) throw new Error('Database not connected');
  return db;
}

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupFileName(reason = 'manual') {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `bills-${reason}-${stamp}.db`;
}

function parseBackupReason(filename: string) {
  const m = /^bills-([a-z-]+)-\\d{8}-\\d{6}\\.db$/i.exec(filename);
  return m ? m[1].toLowerCase() : 'unknown';
}

export async function createBackup(reason = 'manual') {
  ensureBackupDir();
  const filename = backupFileName(reason);
  const fullPath = path.join(BACKUP_DIR, filename);
  await ensureDb().backup(fullPath);
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
  const result: Array<{ filename: string; size: number; created_at: string; reason: string }> = [];
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

export async function pruneOldBackups() {
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
      const e = err as Error;
      console.error('Scheduled backup failed:', e.message);
    }
  }, intervalMs);
}

export function initDb() {
  ensureDb().exec(`
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
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );

    CREATE TABLE IF NOT EXISTS bill_custom_dates (
      bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      due_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bill_month_day_combinations (
      bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      month_day TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payments_bill_id ON payments(bill_id);
    CREATE INDEX IF NOT EXISTS idx_payments_paid_date ON payments(paid_date);
    CREATE INDEX IF NOT EXISTS idx_bill_custom_dates_bill_id ON bill_custom_dates(bill_id);
    CREATE INDEX IF NOT EXISTS idx_bill_custom_dates_due_date ON bill_custom_dates(due_date);
    CREATE INDEX IF NOT EXISTS idx_bill_month_day_bill_id ON bill_month_day_combinations(bill_id);
  `);
  ensureDb().exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_month_day_combo ON bill_month_day_combinations(bill_id, month_day)`);

  ensureDb().exec(`
    CREATE TABLE IF NOT EXISTS bill_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      due_date TEXT NOT NULL,
      expected_amount REAL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_occurrences_bill_due ON bill_occurrences(bill_id, due_date);
    CREATE INDEX IF NOT EXISTS idx_bill_occurrences_due_date ON bill_occurrences(due_date);
    CREATE INDEX IF NOT EXISTS idx_bill_occurrences_status ON bill_occurrences(status);
  `);

  const paymentCols = ensureDb().prepare(`PRAGMA table_info(payments)`).all() as Array<{ name: string }>;
  if (!paymentCols.some((c) => c.name === 'occurrence_id')) {
    ensureDb().exec(`ALTER TABLE payments ADD COLUMN occurrence_id INTEGER REFERENCES bill_occurrences(id) ON DELETE SET NULL`);
  }
  ensureDb().exec(`CREATE INDEX IF NOT EXISTS idx_payments_occurrence_id ON payments(occurrence_id)`);
}

function upsertOccurrencesForBill(bill: any, startDate: Date, endDate: Date) {
  const occDates = calcOccurrences(bill, startDate, endDate);
  const insert = ensureDb().prepare(
    `INSERT OR IGNORE INTO bill_occurrences (bill_id, due_date, expected_amount, status)
     VALUES (?, ?, ?, 'scheduled')`
  );
  const update = ensureDb().prepare(
    `UPDATE bill_occurrences
     SET expected_amount = COALESCE(?, expected_amount)
     WHERE bill_id = ? AND due_date = ?`
  );
  const tx = ensureDb().transaction(() => {
    for (const dueDate of occDates) {
      insert.run(bill.id, dueDate, bill.amount ?? null);
      update.run(bill.amount ?? null, bill.id, dueDate);
    }
  });
  tx();
}

function regenerateFutureUnpaidOccurrencesForBill(bill: any, fromDate: Date, endDate: Date) {
  const from = formatDate(fromDate);
  const to = formatDate(endDate);
  // Keep any occurrence that already has at least one payment linked to it.
  ensureDb()
    .prepare(
      `
      DELETE FROM bill_occurrences
      WHERE bill_id = ?
        AND due_date >= ?
        AND due_date <= ?
        AND id NOT IN (
          SELECT DISTINCT occurrence_id
          FROM payments
          WHERE occurrence_id IS NOT NULL
        )
    `
    )
    .run(bill.id, from, to);

  upsertOccurrencesForBill(bill, fromDate, endDate);
}

function nearestOccurrenceIdForPayment(billId: number, paidDate: string) {
  const rows = ensureDb()
    .prepare(
      `SELECT id, due_date
       FROM bill_occurrences
       WHERE bill_id = ?
       ORDER BY ABS(julianday(due_date) - julianday(?)) ASC, due_date ASC
       LIMIT 1`
    )
    .all(billId, paidDate) as Array<{ id: number }>;
  return rows[0]?.id ?? null;
}

function ensureOccurrencesForBillAroundDate(bill: any, paidDate: string) {
  const center = isoDate(paidDate);
  const start = new Date(center);
  const end = new Date(center);
  start.setFullYear(start.getFullYear() - 2);
  end.setFullYear(end.getFullYear() + 2);
  upsertOccurrencesForBill(bill, start, end);
}

function backfillOccurrencesAndPaymentLinks() {
  const bills = ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills`).all() as any[];
  const now = startOfDay();
  const defaultStart = backfillWindowStart(now);
  const defaultEnd = backfillWindowEnd(now);

  for (const bill of bills) {
    const paidRange = ensureDb()
      .prepare('SELECT MIN(paid_date) AS min_paid, MAX(paid_date) AS max_paid FROM payments WHERE bill_id = ?')
      .get(bill.id) as any;

    const start = new Date(defaultStart);
    const end = new Date(defaultEnd);
    if (paidRange?.min_paid) {
      const minPaid = isoDate(String(paidRange.min_paid));
      minPaid.setFullYear(minPaid.getFullYear() - 1);
      if (minPaid < start) start.setTime(minPaid.getTime());
    }
    if (paidRange?.max_paid) {
      const maxPaid = isoDate(String(paidRange.max_paid));
      maxPaid.setFullYear(maxPaid.getFullYear() + 1);
      if (maxPaid > end) end.setTime(maxPaid.getTime());
    }
    upsertOccurrencesForBill(bill, start, end);
  }

  const paymentsToLink = ensureDb()
    .prepare('SELECT id, bill_id, paid_date FROM payments WHERE occurrence_id IS NULL')
    .all() as Array<{ id: number; bill_id: number; paid_date: string }>;
  const update = ensureDb().prepare('UPDATE payments SET occurrence_id = ? WHERE id = ?');
  const billById = new Map(bills.map((b) => [Number(b.id), b]));
  const tx = ensureDb().transaction(() => {
    for (const p of paymentsToLink) {
      let occId = nearestOccurrenceIdForPayment(p.bill_id, p.paid_date);
      if (!occId) {
        const bill = billById.get(Number(p.bill_id));
        if (bill) {
          ensureOccurrencesForBillAroundDate(bill, p.paid_date);
          occId = nearestOccurrenceIdForPayment(p.bill_id, p.paid_date);
        }
      }
      if (occId) update.run(occId, p.id);
    }
  });
  tx();
}

export function generateFutureOccurrencesForAllBills() {
  const bills = ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills`).all() as any[];
  const start = startOfDay();
  const end = futureHorizonEnd(start);
  for (const bill of bills) {
    upsertOccurrencesForBill(bill, start, end);
  }
}

function startDailyOccurrenceScheduler() {
  const intervalMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    try {
      generateFutureOccurrencesForAllBills();
      console.log('Daily occurrence generation complete.');
    } catch (err) {
      const e = err as Error;
      console.error('Daily occurrence generation failed:', e.message);
    }
  }, intervalMs);
}

export async function runDailyMaintenance() {
  await createBackup('scheduled');
  await pruneOldBackups();
  generateFutureOccurrencesForAllBills();
}

function normalizeMethodName(name: unknown) {
  return String(name || '').trim();
}

function savePaymentMethod(name: unknown) {
  const n = normalizeMethodName(name);
  if (!n) return;
  try {
    ensureDb().prepare('INSERT OR IGNORE INTO payment_methods (name) VALUES (?)').run(n);
  } catch {
    // ignore
  }
}

function seedPaymentMethods() {
  const defaults = ['Credit Card', 'Debit Card', 'Bank Transfer', 'Check', 'Cash', 'Auto-Pay'];
  const stmt = ensureDb().prepare('INSERT OR IGNORE INTO payment_methods (name) VALUES (?)');
  const tx = ensureDb().transaction(() => {
    for (const m of defaults) stmt.run(m);
  });
  tx();
}

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function futureHorizonEnd(base = startOfDay()) {
  return new Date(base.getFullYear() + OCCURRENCE_FUTURE_YEARS, 11, 31);
}

function backfillWindowStart(base = startOfDay()) {
  return new Date(base.getFullYear() - 2, 0, 1);
}

function backfillWindowEnd(base = startOfDay()) {
  return new Date(base.getFullYear() + 2, 11, 31);
}

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthDateRange(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mon = Number(m[2]);
  if (!Number.isInteger(y) || !Number.isInteger(mon) || mon < 1 || mon > 12) return null;
  const start = new Date(y, mon - 1, 1);
  const end = new Date(y, mon, 0);
  return { start: formatDate(start), end: formatDate(end) };
}

function isoDate(s: string) {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(s || '').trim());
  if (!m) return new Date(s);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d);
}

function paymentMatchScore(paidDateObj: Date, dueDateObj: Date) {
  const dayDiff = Math.abs((paidDateObj.getTime() - dueDateObj.getTime()) / 86400000);
  const sameMonth =
    paidDateObj.getFullYear() === dueDateObj.getFullYear() &&
    paidDateObj.getMonth() === dueDateObj.getMonth();
  return (sameMonth ? 0 : 1000) + dayDiff;
}

function addMonthsSafe(d: Date, months: number) {
  const originalDay = d.getDate();
  const next = new Date(d);
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(originalDay, lastDay));
  return next;
}

function addYearsSafe(d: Date, years: number) {
  return addMonthsSafe(d, years * 12);
}

function shiftDate(d: Date, frequency: string, direction = 1) {
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
    case 'Estimated Tax (US/NY)': {
      const month = d.getMonth() + 1;
      const year = d.getFullYear();
      if (dir > 0) {
        if (month === 1) return new Date(year, 3, 15);
        if (month === 4) return new Date(year, 5, 15);
        if (month === 6) return new Date(year, 8, 15);
        if (month === 9) return new Date(year + 1, 0, 15);
      } else {
        if (month === 1) return new Date(year - 1, 8, 15);
        if (month === 4) return new Date(year, 0, 15);
        if (month === 6) return new Date(year, 3, 15);
        if (month === 9) return new Date(year, 5, 15);
      }
      return null;
    }
    default:
      return null;
  }
}

function estimatedTaxDatesForYear(year: number) {
  return [new Date(year, 0, 15), new Date(year, 3, 15), new Date(year, 5, 15), new Date(year, 8, 15)];
}

function calcOccurrences(bill: any, startDate: Date, endDate: Date) {
  const freq = bill.frequency;
  const result: string[] = [];

  if (freq === 'Custom') {
    return ensureDb()
      .prepare('SELECT due_date FROM bill_custom_dates WHERE bill_id = ? AND due_date BETWEEN ? AND ? ORDER BY due_date')
      .all(bill.id, formatDate(startDate), formatDate(endDate))
      .map((row: any) => row.due_date);
  }

  if (freq === 'Yearly (Month/Day)') {
    const rows = ensureDb()
      .prepare('SELECT month_day FROM bill_month_day_combinations WHERE bill_id = ? ORDER BY month_day')
      .all(bill.id) as Array<{ month_day: string }>;
    const parsed = rows
      .map((r) => parseMonthDay(String(r.month_day || '')))
      .filter((v): v is { month: number; day: number } => Boolean(v));
    if (!parsed.length) return [];
    for (let y = startDate.getFullYear() - 1; y <= endDate.getFullYear() + 1; y += 1) {
      for (const md of parsed) {
        const last = new Date(y, md.month, 0).getDate();
        const dt = new Date(y, md.month - 1, Math.min(md.day, last));
        if (dt >= startDate && dt <= endDate) result.push(formatDate(dt));
      }
    }
    result.sort();
    return Array.from(new Set(result));
  }

  if (freq === 'Monthly') {
    const day = Number(bill.due_day);
    if (!day) return [];
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (cursor <= endDate) {
      const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const occ = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(day, last));
      if (occ >= startDate && occ <= endDate) result.push(formatDate(occ));
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
    while (cursor.getDay() !== ((targetWeekday + 1) % 7)) cursor.setDate(cursor.getDate() + 1);
    while (cursor <= endDate) {
      result.push(formatDate(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return result;
  }

  if (freq === 'Estimated Tax (US/NY)') {
    for (let y = startDate.getFullYear() - 1; y <= endDate.getFullYear() + 1; y += 1) {
      for (const dueDate of estimatedTaxDatesForYear(y)) {
        if (dueDate >= startDate && dueDate <= endDate) result.push(formatDate(dueDate));
      }
    }
    result.sort();
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

const FrequencySchema = z.enum([
  'Monthly',
  'Bi-Monthly',
  'Quarterly',
  'Semi-Annual',
  'Annual',
  'Weekly',
  'Bi-Weekly',
  'Estimated Tax (US/NY)',
  'Yearly (Month/Day)',
  'Custom'
]);

const AutopaySchema = z.enum(['Yes', 'No']).default('No');

const IsoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format');

function parseBody<T extends z.ZodTypeAny>(req: express.Request, res: express.Response, schema: T): z.infer<T> | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: result.error.flatten()
    });
    return null;
  }
  return result.data;
}

function parseParamNumber(name: string, raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function parseMonthDay(value: string) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const maxDay = new Date(2000, month, 0).getDate();
  if (day > maxDay) return null;
  return { month, day };
}

function normalizeMonthDay(value: string) {
  const parsed = parseMonthDay(value);
  if (!parsed) return null;
  return `${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
}

function getBillMonthDayCombinations(billId: number) {
  return ensureDb()
    .prepare('SELECT month_day FROM bill_month_day_combinations WHERE bill_id = ? ORDER BY month_day')
    .all(billId)
    .map((r: any) => String(r.month_day));
}

function attachBillSchedule(bill: any) {
  if (!bill) return bill;
  return {
    ...bill,
    month_day_combinations: getBillMonthDayCombinations(Number(bill.id))
  };
}

// Middleware
app.use(cors());
app.use(express.json());

const BILL_FIELDS = 'id, name, company, frequency, due_day, next_date, amount, autopay, method, account, notes, created';

function getBillById(id: number) {
  return ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills WHERE id = ?`).get(id);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// --- Backups ---
app.get('/api/backups', async (_req, res) => {
  res.json(await listBackups());
});

app.get('/api/backups/status', async (_req, res) => {
  res.json(await getBackupStatus());
});

app.post('/api/backups', async (_req, res) => {
  const backup = await createBackup('manual');
  await pruneOldBackups();
  res.status(201).json({ ok: true, backup });
});

app.post('/api/backups/restore', async (req, res) => {
  const body = parseBody(
    req,
    res,
    z.object({
      filename: z.string().trim().min(1)
    })
  );
  if (!body) return;
  const filename = path.basename(body.filename);
  if (!filename) {
    res.status(400).json({ error: 'filename is required' });
    return;
  }
  const backupPath = path.join(BACKUP_DIR, filename);
  try {
    await fsp.access(backupPath);
  } catch {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }

  await fsp.copyFile(backupPath, DB_PATH);
  connectDb();
  initDb();
  seedPaymentMethods();

  res.json({ ok: true, restored_from: filename });
});

app.get('/api/backups/:filename/download', async (req, res) => {
  const filename = path.basename(String(req.params.filename || '').trim());
  const backupPath = path.join(BACKUP_DIR, filename);
  try {
    await fsp.access(backupPath);
  } catch {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }
  res.download(backupPath, filename);
});

// --- Payment methods ---
app.get('/api/payment-methods', (_req, res) => {
  const rows = ensureDb().prepare('SELECT name FROM payment_methods ORDER BY name').all();
  res.json(rows.map((r: any) => r.name));
});

app.post('/api/payment-methods', (req, res) => {
  const body = parseBody(req, res, z.object({ name: z.string().trim().min(1) }));
  if (!body) return;
  const name = normalizeMethodName(body.name);
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  savePaymentMethod(name);
  res.status(201).json({ ok: true });
});

app.get('/api/payment-methods/stats', (_req, res) => {
  const rows = ensureDb()
    .prepare(
      `
    SELECT
      pm.name AS name,
      COALESCE(pc.bill_count, 0) AS bill_count,
      COALESCE(pc.payment_count, 0) AS payment_count,
      COALESCE(pc.total_paid, 0) AS total_paid
    FROM payment_methods pm
    LEFT JOIN (
      SELECT method, COUNT(*) AS payment_count, COUNT(DISTINCT bill_id) AS bill_count, COALESCE(SUM(amount), 0) AS total_paid
      FROM payments
      WHERE TRIM(COALESCE(method, '')) != ''
      GROUP BY method
    ) pc ON LOWER(TRIM(pc.method)) = LOWER(TRIM(pm.name))
    ORDER BY pm.name
  `
    )
    .all();
  res.json(rows);
});

app.post('/api/payment-methods/replace', (req, res) => {
  const body = parseBody(
    req,
    res,
    z.object({
      from: z.string().trim().min(1),
      to: z.string().trim().min(1),
      replace_bill_defaults: z.boolean().optional().default(false)
    })
  );
  if (!body) return;
  const from = normalizeMethodName(body.from);
  const to = normalizeMethodName(body.to);
  const replaceBillDefaults = Boolean(body.replace_bill_defaults);
  if (!from || !to) {
    res.status(400).json({ error: 'from and to are required' });
    return;
  }

  const tx = ensureDb().transaction(() => {
    const paymentsUpdated = ensureDb()
      .prepare('UPDATE payments SET method = ? WHERE LOWER(method) = LOWER(?)')
      .run(to, from).changes;
    let billsUpdated = 0;
    if (replaceBillDefaults) {
      billsUpdated = ensureDb()
        .prepare('UPDATE bills SET method = ? WHERE LOWER(method) = LOWER(?)')
        .run(to, from).changes;
    }
    return { paymentsUpdated, billsUpdated };
  });

  const result = tx();
  res.json(result);
});

app.delete('/api/payment-methods/:name', (req, res) => {
  const name = normalizeMethodName(req.params.name);
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const usedRow = ensureDb()
    .prepare('SELECT COUNT(*) AS c FROM payments WHERE LOWER(method) = LOWER(?)')
    .get(name) as any;
  const used = Number(usedRow?.c || 0);
  if (used > 0) {
    res.status(409).json({ error: 'Method is used by payments', requires_replacement: true, payment_count: used });
    return;
  }

  ensureDb().prepare('DELETE FROM payment_methods WHERE LOWER(name) = LOWER(?)').run(name);
  res.json({ ok: true });
});

// --- Bills ---
app.get('/api/bills', (_req, res) => {
  const bills = ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills ORDER BY name`).all() as any[];
  res.json(bills.map((b) => attachBillSchedule(b)));
});

app.get('/api/bills/:id', (req, res) => {
  const bill = getBillById(Number(req.params.id));
  if (!bill) {
    res.status(404).json({ error: 'Bill not found' });
    return;
  }
  res.json(attachBillSchedule(bill));
});

app.get('/api/bills/:id/details', (req, res) => {
  const billId = Number(req.params.id);
  const bill = getBillById(billId);
  if (!bill) {
    res.status(404).json({ error: 'Bill not found' });
    return;
  }

  const payments = ensureDb()
    .prepare('SELECT * FROM payments WHERE bill_id = ? ORDER BY paid_date DESC LIMIT 50')
    .all(billId);

  const today = startOfDay();
  const end = futureHorizonEnd(today);

  upsertOccurrencesForBill(bill, today, end);
  const upcoming = ensureDb()
    .prepare(
      `SELECT due_date
       FROM bill_occurrences
       WHERE bill_id = ? AND due_date >= ? AND due_date <= ?
       ORDER BY due_date
       LIMIT 20`
    )
    .all(billId, formatDate(today), formatDate(end))
    .map((r: any) => r.due_date);

  res.json({
    bill: attachBillSchedule(bill),
    upcoming,
    payments
  });
});

app.post('/api/bills', (req, res) => {
  const d = parseBody(
    req,
    res,
    z.object({
      name: z.string().trim().min(1),
      company: z.string().optional().default(''),
      frequency: FrequencySchema,
      due_day: z.number().int().nullable().optional(),
      next_date: IsoDateSchema.nullable().optional(),
      amount: z.number().nonnegative().nullable().optional(),
      autopay: AutopaySchema.optional(),
      method: z.string().optional().default(''),
      account: z.string().optional().default(''),
      notes: z.string().optional().default(''),
      custom_dates: z.array(IsoDateSchema).optional().default([]),
      month_day_combinations: z.array(z.string().trim().regex(/^\d{2}-\d{2}$/)).optional().default([])
    })
  );
  if (!d) return;
  const parsedMonthDays = (d.month_day_combinations || []).map((v) => normalizeMonthDay(v));
  const normalizedMonthDays = Array.from(new Set(parsedMonthDays.filter(Boolean))) as string[];
  if (d.frequency === 'Yearly (Month/Day)' && !normalizedMonthDays.length) {
    res.status(400).json({ error: 'At least one month/day combination is required' });
    return;
  }
  if (parsedMonthDays.some((v) => !v)) {
    res.status(400).json({ error: 'month_day_combinations must be valid MM-DD values' });
    return;
  }
  const insert = ensureDb().prepare(
    `INSERT INTO bills (name, company, frequency, due_day, next_date, amount, autopay, method, account, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = ensureDb().transaction(() => {
    const info = insert.run(
      d.name,
      d.company || '',
      d.frequency,
      d.due_day ?? null,
      d.next_date ?? null,
      d.amount ?? null,
      d.autopay || 'No',
      d.method || '',
      d.account || '',
      d.notes || ''
    );

    const billId = Number(info.lastInsertRowid);
    const insertCustomDate = ensureDb().prepare('INSERT INTO bill_custom_dates (bill_id, due_date) VALUES (?, ?)');
    for (const dt of d.custom_dates || []) {
      if (dt) insertCustomDate.run(billId, dt);
    }
    const insertMonthDay = ensureDb().prepare('INSERT INTO bill_month_day_combinations (bill_id, month_day) VALUES (?, ?)');
    for (const md of normalizedMonthDays) insertMonthDay.run(billId, md);

    savePaymentMethod(d.method);
    const insertedBill = getBillById(billId) as any;
    if (insertedBill) {
      const start = backfillWindowStart(startOfDay());
      const end = backfillWindowEnd(startOfDay());
      upsertOccurrencesForBill(insertedBill, start, end);
    }
    return billId;
  });

  const billId = tx();
  res.status(201).json(attachBillSchedule(getBillById(billId)));
});

app.put('/api/bills/:id', (req, res) => {
  const billId = Number(req.params.id);
  const existing = getBillById(billId);
  if (!existing) {
    res.status(404).json({ error: 'Bill not found' });
    return;
  }
  const d = parseBody(
    req,
    res,
    z.object({
      name: z.string().trim().min(1),
      company: z.string().optional().default(''),
      frequency: FrequencySchema,
      due_day: z.number().int().nullable().optional(),
      next_date: IsoDateSchema.nullable().optional(),
      amount: z.number().nonnegative().nullable().optional(),
      autopay: AutopaySchema.optional(),
      method: z.string().optional().default(''),
      account: z.string().optional().default(''),
      notes: z.string().optional().default(''),
      custom_dates: z.array(IsoDateSchema).optional().default([]),
      month_day_combinations: z.array(z.string().trim().regex(/^\d{2}-\d{2}$/)).optional().default([])
    })
  );
  if (!d) return;
  const parsedMonthDays = (d.month_day_combinations || []).map((v) => normalizeMonthDay(v));
  const normalizedMonthDays = Array.from(new Set(parsedMonthDays.filter(Boolean))) as string[];
  if (d.frequency === 'Yearly (Month/Day)' && !normalizedMonthDays.length) {
    res.status(400).json({ error: 'At least one month/day combination is required' });
    return;
  }
  if (parsedMonthDays.some((v) => !v)) {
    res.status(400).json({ error: 'month_day_combinations must be valid MM-DD values' });
    return;
  }

  const tx = ensureDb().transaction(() => {
    ensureDb()
      .prepare(
        `UPDATE bills
         SET name = ?, company = ?, frequency = ?, due_day = ?, next_date = ?, amount = ?, autopay = ?, method = ?, account = ?, notes = ?
         WHERE id = ?`
      )
      .run(
        d.name,
        d.company || '',
        d.frequency,
        d.due_day ?? null,
        d.next_date ?? null,
        d.amount ?? null,
        d.autopay || 'No',
        d.method || '',
        d.account || '',
        d.notes || '',
        billId
      );

    ensureDb().prepare('DELETE FROM bill_custom_dates WHERE bill_id = ?').run(billId);
    const insertCustomDate = ensureDb().prepare('INSERT INTO bill_custom_dates (bill_id, due_date) VALUES (?, ?)');
    for (const dt of d.custom_dates || []) {
      if (dt) insertCustomDate.run(billId, dt);
    }
    ensureDb().prepare('DELETE FROM bill_month_day_combinations WHERE bill_id = ?').run(billId);
    const insertMonthDay = ensureDb().prepare('INSERT INTO bill_month_day_combinations (bill_id, month_day) VALUES (?, ?)');
    for (const md of normalizedMonthDays) insertMonthDay.run(billId, md);

    savePaymentMethod(d.method);
    const updatedBill = getBillById(billId) as any;
    if (updatedBill) {
      const start = backfillWindowStart(startOfDay());
      const end = backfillWindowEnd(startOfDay());
      regenerateFutureUnpaidOccurrencesForBill(updatedBill, start, end);
    }
  });

  tx();
  res.json(attachBillSchedule(getBillById(billId)));
});

app.delete('/api/bills/:id', (req, res) => {
  const billId = Number(req.params.id);
  ensureDb().prepare('DELETE FROM bills WHERE id = ?').run(billId);
  res.json({ ok: true });
});

// --- Payments ---
app.get('/api/payments/:id', (req, res) => {
  const id = Number(req.params.id);
  const payment = ensureDb()
    .prepare('SELECT p.*, b.name AS bill_name FROM payments p LEFT JOIN bills b ON b.id = p.bill_id WHERE p.id = ?')
    .get(id);
  if (!payment) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }
  res.json(payment);
});

app.get('/api/payments', (req, res) => {
  const billIdRaw = req.query.bill_id;
  const month = req.query.month ? String(req.query.month) : null;
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : formatDate(startOfDay(new Date()));
  let sql =
    'SELECT p.*, b.name AS bill_name, o.due_date AS occurrence_due_date FROM payments p LEFT JOIN bills b ON b.id = p.bill_id LEFT JOIN bill_occurrences o ON o.id = p.occurrence_id WHERE 1=1';
  const args: any[] = [];

  if (billIdRaw != null && String(billIdRaw).trim()) {
    const ids = String(billIdRaw)
      .split(',')
      .map((s) => Number(String(s).trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 1) {
      sql += ' AND p.bill_id = ?';
      args.push(ids[0]);
    } else if (ids.length > 1) {
      sql += ` AND p.bill_id IN (${ids.map(() => '?').join(',')})`;
      args.push(...ids);
    }
  }
  if (month) {
    const range = monthDateRange(month);
    if (!range) {
      res.status(400).json({ error: 'Invalid month. Expected YYYY-MM.' });
      return;
    }
    sql += ' AND p.paid_date >= ? AND p.paid_date <= ?';
    args.push(range.start, range.end);
  }
  if (from) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from.trim());
    if (!m) {
      res.status(400).json({ error: 'Invalid from date. Expected YYYY-MM-DD.' });
      return;
    }
    sql += ' AND p.paid_date >= ?';
    args.push(from.trim());
  }
  if (to) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to.trim());
    if (!m) {
      res.status(400).json({ error: 'Invalid to date. Expected YYYY-MM-DD.' });
      return;
    }
    sql += ' AND p.paid_date <= ?';
    args.push(to.trim());
  }
  sql += ' ORDER BY p.paid_date DESC';
  res.json(ensureDb().prepare(sql).all(...args));
});

app.post('/api/payments', (req, res) => {
  const d = parseBody(
    req,
    res,
    z.object({
      bill_id: z.number().int(),
      occurrence_id: z.number().int().nullable().optional(),
      paid_date: IsoDateSchema,
      amount: z.number().nonnegative().nullable().optional(),
      method: z.string().optional().default(''),
      paid_by: z.string().optional().default(''),
      confirm_num: z.string().optional().default(''),
      notes: z.string().optional().default('')
    })
  );
  if (!d) return;
  const bill = getBillById(Number(d.bill_id));
  if (!bill) {
    res.status(404).json({ error: 'Bill not found' });
    return;
  }
  if (d.occurrence_id != null) {
    const occ = ensureDb()
      .prepare('SELECT id, bill_id FROM bill_occurrences WHERE id = ?')
      .get(Number(d.occurrence_id)) as any;
    if (!occ || Number(occ.bill_id) !== Number(d.bill_id)) {
      res.status(400).json({ error: 'Invalid occurrence_id for bill_id' });
      return;
    }
  }

  const tx = ensureDb().transaction(() => {
    ensureOccurrencesForBillAroundDate(bill as any, d.paid_date);
    let occurrenceId: number | null = null;
    if (d.occurrence_id != null) {
      occurrenceId = Number(d.occurrence_id);
    } else {
      occurrenceId = nearestOccurrenceIdForPayment(Number(d.bill_id), d.paid_date);
    }
    ensureDb()
      .prepare(`INSERT INTO payments (bill_id, occurrence_id, paid_date, amount, method, paid_by, confirm_num, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        d.bill_id,
        occurrenceId,
        d.paid_date,
        d.amount == null ? (bill as any).amount : d.amount,
        d.method || (bill as any).method || '',
        d.paid_by || '',
        d.confirm_num || '',
        d.notes || ''
      );

    savePaymentMethod(d.method);

    if ((bill as any).next_date) {
      let dt = isoDate((bill as any).next_date);
      const today = startOfDay();
      let next = shiftDate(dt, (bill as any).frequency, 1);
      while (next && next <= today) {
        dt = next;
        next = shiftDate(dt, (bill as any).frequency, 1);
      }
      if (next) {
        ensureDb().prepare('UPDATE bills SET next_date = ? WHERE id = ?').run(formatDate(next), (bill as any).id);
      }
    }
  });

  tx();
  res.status(201).json({ ok: true });
});

app.put('/api/payments/:id', (req, res) => {
  const paymentId = Number(req.params.id);
  const existing = ensureDb().prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }
  const d = parseBody(
    req,
    res,
    z.object({
      paid_date: IsoDateSchema.optional(),
      amount: z.number().nonnegative().nullable().optional(),
      method: z.string().optional(),
      paid_by: z.string().optional(),
      confirm_num: z.string().optional(),
      notes: z.string().optional()
    })
  );
  if (!d) return;

  const paidDate = d.paid_date || existing.paid_date;
  const amount = d.amount == null ? existing.amount : d.amount;
  const method = d.method == null ? existing.method : d.method;
  const paidBy = d.paid_by == null ? existing.paid_by : d.paid_by;
  const confirmNum = d.confirm_num == null ? existing.confirm_num : d.confirm_num;
  const notes = d.notes == null ? existing.notes : d.notes;
  const bill = getBillById(Number(existing.bill_id)) as any;
  let occurrenceId = existing.occurrence_id ?? null;
  if (d.paid_date && bill) {
    ensureOccurrencesForBillAroundDate(bill, paidDate);
    occurrenceId = nearestOccurrenceIdForPayment(Number(existing.bill_id), paidDate);
  }

  ensureDb()
    .prepare(`UPDATE payments SET occurrence_id = ?, paid_date = ?, amount = ?, method = ?, paid_by = ?, confirm_num = ?, notes = ? WHERE id = ?`)
    .run(occurrenceId, paidDate, amount, method, paidBy, confirmNum, notes, paymentId);

  savePaymentMethod(method);
  res.json({ ok: true });
});

app.delete('/api/payments/:id', (req, res) => {
  ensureDb().prepare('DELETE FROM payments WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- Dashboard occurrences ---
app.get('/api/dashboard-occurrences', (req, res) => {
  const todayDt = startOfDay();
  const monthStart = new Date(todayDt.getFullYear(), todayDt.getMonth(), 1);
  const monthEnd = new Date(todayDt.getFullYear(), todayDt.getMonth() + 1, 0);
  const minDue = new Date(todayDt);
  minDue.setDate(minDue.getDate() - 30);

  const fromRaw = req.query.from ? String(req.query.from).trim() : formatDate(minDue);
  const toRaw = req.query.to ? String(req.query.to).trim() : formatDate(monthEnd);
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromRaw);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toRaw);
  if (!m1 || !m2) {
    res.status(400).json({ error: 'Invalid from/to date. Expected YYYY-MM-DD.' });
    return;
  }

  const from = fromRaw;
  const to = toRaw;
  const bills = ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills`).all() as any[];
  const startObj = isoDate(from);
  const endObj = isoDate(to);
  for (const bill of bills) {
    upsertOccurrencesForBill(bill, startObj, endObj);
  }

  const rows = ensureDb()
    .prepare(
      `
      SELECT
        o.id AS occurrence_id,
        o.bill_id AS bill_id,
        o.due_date AS due_date,
        o.expected_amount AS expected_amount,
        b.name AS bill_name,
        b.company AS company,
        b.frequency AS frequency,
        b.autopay AS autopay,
        p.id AS payment_id,
        p.paid_date AS paid_date,
        p.amount AS paid_amount
      FROM bill_occurrences o
      JOIN bills b ON b.id = o.bill_id
      LEFT JOIN payments p
        ON p.id = (
          SELECT p2.id
          FROM payments p2
          WHERE p2.occurrence_id = o.id
          ORDER BY p2.paid_date DESC, p2.id DESC
          LIMIT 1
        )
      WHERE o.due_date BETWEEN ? AND ?
      ORDER BY o.due_date ASC, b.name ASC
    `
    )
    .all(from, to);

  res.json({
    today: formatDate(todayDt),
    month_start: formatDate(monthStart),
    month_end: formatDate(monthEnd),
    overdue_window_start: formatDate(minDue),
    occurrences: rows
  });
});

// --- Year view ---
app.get('/api/year-view', (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const today = startOfDay();

  const yearStart = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const startStr = formatDate(yearStart);
  const endStr = formatDate(end);

  const yearPaidTotalRow = ensureDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE paid_date BETWEEN ? AND ?')
    .get(startStr, endStr) as any;
  const yearPaidTotal = Number(yearPaidTotalRow?.total || 0);

  const bills = ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills`).all() as any[];

  const allOccurrences = ensureDb()
    .prepare(
      `
      SELECT
        o.id AS occurrence_id,
        o.bill_id AS bill_id,
        b.name AS bill_name,
        COALESCE(b.company, '') AS company,
        COALESCE(o.expected_amount, b.amount) AS amount,
        o.due_date AS due_date,
        b.frequency AS frequency,
        b.autopay AS autopay,
        p.id AS payment_id,
        p.paid_date AS paid_date,
        p.paid_by AS paid_by,
        p.amount AS paid_amount
      FROM bill_occurrences o
      JOIN bills b ON b.id = o.bill_id
      LEFT JOIN payments p
        ON p.id = (
          SELECT p2.id
          FROM payments p2
          WHERE p2.occurrence_id = o.id
          ORDER BY p2.paid_date DESC, p2.id DESC
          LIMIT 1
        )
      WHERE o.due_date BETWEEN ? AND ?
      ORDER BY o.due_date ASC, b.name ASC
    `
    )
    .all(startStr, endStr)
    .map((occ: any) => {
      const occObj = isoDate(occ.due_date);
      let status = 'upcoming';
      if (occObj < today) status = 'overdue';
      if (occ.payment_id) status = 'paid';
      else {
        const diffDays = Math.round((occObj.getTime() - today.getTime()) / 86400000);
        if (diffDays >= 0 && diffDays <= 15) status = 'due-soon';
      }
      return {
        occurrence_id: occ.occurrence_id,
        payment_id: occ.payment_id ?? null,
        bill_id: occ.bill_id,
        bill_name: occ.bill_name,
        company: occ.company,
        amount: occ.amount,
        due_date: occ.due_date,
        frequency: occ.frequency,
        autopay: occ.autopay,
        status,
        paid_date: occ.paid_date || null,
        paid_by: occ.paid_by || null,
        paid_amount: occ.paid_amount ?? null
      };
    });

  allOccurrences.sort((a, b) => a.due_date.localeCompare(b.due_date));

  const months: Record<string, { occurrences: any[]; total: number; total_unpaid: number }> = {};
  for (const occ of allOccurrences) {
    const monthKey = occ.due_date.slice(0, 7);
    if (!months[monthKey]) months[monthKey] = { occurrences: [], total: 0, total_unpaid: 0 };
    months[monthKey].occurrences.push(occ);
    months[monthKey].total += occ.amount || 0;
    if (occ.status !== 'paid') months[monthKey].total_unpaid += occ.amount || 0;
  }

  res.json({
    year,
    year_total: allOccurrences.reduce((sum, occ) => sum + (occ.amount || 0), 0),
    year_unpaid: allOccurrences.filter((occ) => occ.status !== 'paid').reduce((sum, occ) => sum + (occ.amount || 0), 0),
    year_paid_total: Number(yearPaidTotal || 0),
    count: allOccurrences.length,
    months: Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }))
  });
});

app.get('/api/summary', (_req, res) => {
  const month = formatDate(new Date()).slice(0, 7);
  const range = monthDateRange(month);
  const totalBillsRow = ensureDb().prepare('SELECT COUNT(*) AS count FROM bills').get() as any;
  const totalBills = Number(totalBillsRow?.count || 0);
  const paidThisMonthRow = ensureDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE paid_date >= ? AND paid_date <= ?')
    .get(range?.start || `${month}-01`, range?.end || `${month}-31`) as any;
  const paidThisMonth = Number(paidThisMonthRow?.total || 0);

  res.json({
    total_bills: totalBills,
    paid_this_month: paidThisMonth,
    today: formatDate(new Date())
  });
});

export function startApp() {
  connectDb();
  initDb();
  backfillOccurrencesAndPaymentLinks();
  generateFutureOccurrencesForAllBills();
  seedPaymentMethods();
  ensureBackupDir();
}

