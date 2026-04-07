import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import Database from 'better-sqlite3';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { registerBackupsRoutes } from './routes/backups';
import { registerPaymentMethodRoutes } from './routes/paymentMethods';
import { registerPaymentRoutes } from './routes/payments';
import { registerBillRoutes } from './routes/bills';
import { registerOccurrenceRoutes } from './routes/occurrences';
import type { BillRow, DashboardOccurrenceRow, PaymentRow, YearOccurrenceOut, YearOccurrenceRow } from './types/db';

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

function upsertOccurrencesForBill(bill: BillRow, startDate: Date, endDate: Date) {
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

function regenerateFutureUnpaidOccurrencesForBill(bill: BillRow, fromDate: Date, endDate: Date) {
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

function ensureOccurrencesForBillAroundDate(bill: BillRow, paidDate: string) {
  const center = isoDate(paidDate);
  const start = new Date(center);
  const end = new Date(center);
  start.setFullYear(start.getFullYear() - 2);
  end.setFullYear(end.getFullYear() + 2);
  upsertOccurrencesForBill(bill, start, end);
}

function backfillOccurrencesAndPaymentLinks() {
  const bills = ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills`).all() as BillRow[];
  const now = startOfDay();
  const defaultStart = backfillWindowStart(now);
  const defaultEnd = backfillWindowEnd(now);

  for (const bill of bills) {
    const paidRange = ensureDb()
      .prepare('SELECT MIN(paid_date) AS min_paid, MAX(paid_date) AS max_paid FROM payments WHERE bill_id = ?')
      .get(bill.id) as { min_paid: string | null; max_paid: string | null } | undefined;

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
  const bills = ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills`).all() as BillRow[];
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

export function monthDateRange(month: string) {
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

function calcOccurrences(bill: BillRow, startDate: Date, endDate: Date) {
  const freq = bill.frequency;
  const result: string[] = [];

  if (freq === 'Custom') {
    return ensureDb()
      .prepare('SELECT due_date FROM bill_custom_dates WHERE bill_id = ? AND due_date BETWEEN ? AND ? ORDER BY due_date')
      .all(bill.id, formatDate(startDate), formatDate(endDate))
      .map((row) => (row as { due_date: string }).due_date);
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
    .map((r) => String((r as { month_day: string }).month_day));
}

function attachBillSchedule<T extends { id: number } | null | undefined>(bill: T) {
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
  return ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills WHERE id = ?`).get(id) as BillRow | undefined;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

registerBackupsRoutes(app, {
  parseBody,
  listBackups,
  getBackupStatus,
  createBackup,
  pruneOldBackups,
  connectDb,
  initDb,
  seedPaymentMethods,
  backupDir: BACKUP_DIR,
  dbPath: DB_PATH
});

registerPaymentMethodRoutes(app, {
  ensureDb,
  parseBody,
  normalizeMethodName,
  savePaymentMethod
});

registerPaymentRoutes(app, {
  ensureDb,
  parseBody,
  isoDateSchema: IsoDateSchema,
  getBillById,
  ensureOccurrencesForBillAroundDate,
  nearestOccurrenceIdForPayment,
  savePaymentMethod,
  monthDateRange,
  startOfDay,
  formatDate,
  shiftDate,
  isoDate
});

registerBillRoutes(app, {
  ensureDb,
  parseBody,
  frequencySchema: FrequencySchema,
  autopaySchema: AutopaySchema,
  isoDateSchema: IsoDateSchema,
  normalizeMonthDay,
  savePaymentMethod,
  getBillById,
  attachBillSchedule,
  backfillWindowStart,
  backfillWindowEnd,
  startOfDay,
  upsertOccurrencesForBill,
  regenerateFutureUnpaidOccurrencesForBill,
  futureHorizonEnd,
  formatDate
});

registerOccurrenceRoutes(app, {
  ensureDb,
  billFields: BILL_FIELDS,
  startOfDay,
  formatDate,
  isoDate,
  monthDateRange,
  upsertOccurrencesForBill
});

export function startApp() {
  connectDb();
  initDb();
  backfillOccurrencesAndPaymentLinks();
  generateFutureOccurrencesForAllBills();
  seedPaymentMethods();
  ensureBackupDir();
}

