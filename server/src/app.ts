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

async function createBackup(reason = 'manual') {
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
      const e = err as Error;
      console.error('Scheduled backup failed:', e.message);
    }
  }, intervalMs);
}

function initDb() {
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

    CREATE INDEX IF NOT EXISTS idx_payments_bill_id ON payments(bill_id);
    CREATE INDEX IF NOT EXISTS idx_payments_paid_date ON payments(paid_date);
    CREATE INDEX IF NOT EXISTS idx_bill_custom_dates_bill_id ON bill_custom_dates(bill_id);
    CREATE INDEX IF NOT EXISTS idx_bill_custom_dates_due_date ON bill_custom_dates(due_date);
  `);
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

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
      COALESCE(bc.bill_count, 0) AS bill_count,
      COALESCE(pc.payment_count, 0) AS payment_count,
      COALESCE(pc.total_paid, 0) AS total_paid
    FROM payment_methods pm
    LEFT JOIN (
      SELECT method, COUNT(*) AS bill_count
      FROM bills
      WHERE TRIM(COALESCE(method, '')) != ''
      GROUP BY method
    ) bc ON LOWER(bc.method) = LOWER(pm.name)
    LEFT JOIN (
      SELECT method, COUNT(*) AS payment_count, COALESCE(SUM(amount), 0) AS total_paid
      FROM payments
      WHERE TRIM(COALESCE(method, '')) != ''
      GROUP BY method
    ) pc ON LOWER(pc.method) = LOWER(pm.name)
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
  res.json(ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills ORDER BY name`).all());
});

app.get('/api/bills/:id', (req, res) => {
  const bill = getBillById(Number(req.params.id));
  if (!bill) {
    res.status(404).json({ error: 'Bill not found' });
    return;
  }
  res.json(bill);
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
  const end = new Date(today);
  end.setFullYear(end.getFullYear() + 2);

  const upcoming = calcOccurrences(bill, today, end).slice(0, 20);

  res.json({
    bill,
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
      custom_dates: z.array(IsoDateSchema).optional().default([])
    })
  );
  if (!d) return;
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

    savePaymentMethod(d.method);
    return billId;
  });

  const billId = tx();
  res.status(201).json(getBillById(billId));
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
      custom_dates: z.array(IsoDateSchema).optional().default([])
    })
  );
  if (!d) return;

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

    savePaymentMethod(d.method);
  });

  tx();
  res.json(getBillById(billId));
});

app.delete('/api/bills/:id', (req, res) => {
  const billId = Number(req.params.id);
  ensureDb().prepare('DELETE FROM bills WHERE id = ?').run(billId);
  res.json({ ok: true });
});

// --- Payments ---
app.get('/api/payments', (req, res) => {
  const billIdRaw = req.query.bill_id;
  const month = req.query.month ? String(req.query.month) : null;
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : formatDate(startOfDay(new Date()));
  let sql =
    'SELECT p.*, b.name AS bill_name FROM payments p LEFT JOIN bills b ON b.id = p.bill_id WHERE 1=1';
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
    sql += " AND strftime('%Y-%m', p.paid_date) = ?";
    args.push(month);
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

  const tx = ensureDb().transaction(() => {
    ensureDb()
      .prepare(`INSERT INTO payments (bill_id, paid_date, amount, method, paid_by, confirm_num, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        d.bill_id,
        d.paid_date,
        d.amount || (bill as any).amount,
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

  ensureDb()
    .prepare(`UPDATE payments SET paid_date = ?, amount = ?, method = ?, paid_by = ?, confirm_num = ?, notes = ? WHERE id = ?`)
    .run(paidDate, amount, method, paidBy, confirmNum, notes, paymentId);

  savePaymentMethod(method);
  res.json({ ok: true });
});

app.delete('/api/payments/:id', (req, res) => {
  ensureDb().prepare('DELETE FROM payments WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- Year view ---
app.get('/api/year-view', (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const today = startOfDay();

  const yearStart = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);

  const buffer = new Date(year, 0, 1);
  buffer.setDate(buffer.getDate() - 45);

  const allPayments = ensureDb()
    .prepare('SELECT * FROM payments WHERE paid_date BETWEEN ? AND ?')
    .all(formatDate(buffer), formatDate(end)) as any[];

  const yearPaidTotalRow = ensureDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE paid_date BETWEEN ? AND ?')
    .get(formatDate(yearStart), formatDate(end)) as any;
  const yearPaidTotal = Number(yearPaidTotalRow?.total || 0);

  const payMap = new Map<number, any[]>();
  for (const p of allPayments) {
    if (!payMap.has(p.bill_id)) payMap.set(p.bill_id, []);
    payMap.get(p.bill_id)!.push(p);
  }

  const bills = ensureDb().prepare(`SELECT ${BILL_FIELDS} FROM bills`).all() as any[];
  const allOccurrences: any[] = [];
  for (const bill of bills) {
    const occDates = calcOccurrences(bill, yearStart, end);
    const billPays = (payMap.get(bill.id) || []).slice().sort((a, b) => String(a.paid_date).localeCompare(String(b.paid_date)));

    const occMatches = occDates.map((d: string) => ({ dueDateStr: d, dueDateObj: isoDate(d) }));
    const matched: Record<string, any> = {};

    for (const payment of billPays) {
      if (!occMatches.length) break;
      const paidDateObj = isoDate(payment.paid_date);
      let bestIdx = 0;
      let bestScore = Number.POSITIVE_INFINITY;

      occMatches.forEach((occ: { dueDateStr: string; dueDateObj: Date }, idx: number) => {
        const score = paymentMatchScore(paidDateObj, occ.dueDateObj);
        if (score < bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      });

      const best = occMatches.splice(bestIdx, 1)[0];
      matched[best.dueDateStr] = payment;
    }

    for (const occStr of occDates) {
      const occObj = isoDate(occStr);
      let status = 'upcoming';
      if (occObj < today) status = 'overdue';
      if (matched[occStr]) status = 'paid';
      else {
        const diffDays = Math.round((occObj.getTime() - today.getTime()) / 86400000);
        if (diffDays >= 0 && diffDays <= 15) status = 'due-soon';
      }

      const paymentEntry = matched[occStr] || null;
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
        paid_by: paymentEntry ? paymentEntry.paid_by : null,
        paid_amount: paymentEntry ? paymentEntry.amount : null
      });
    }
  }

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
  const totalBillsRow = ensureDb().prepare('SELECT COUNT(*) AS count FROM bills').get() as any;
  const totalBills = Number(totalBillsRow?.count || 0);
  const paidThisMonthRow = ensureDb()
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE strftime('%Y-%m', paid_date) = ?")
    .get(month) as any;
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
  seedPaymentMethods();
  ensureBackupDir();
  startDailyBackupScheduler();
}

