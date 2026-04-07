import express from 'express';
import { z } from 'zod';
import Database from 'better-sqlite3';
import type { BillRow } from '../types/db';
import type { ParseBody } from '../types/http';

type BillsDeps = {
  ensureDb: () => Database.Database;
  parseBody: ParseBody;
  frequencySchema: z.ZodType<string>;
  autopaySchema: z.ZodType<'Yes' | 'No'>;
  isoDateSchema: z.ZodString;
  normalizeMonthDay: (value: string) => string | null;
  savePaymentMethod: (name: unknown) => void;
  getBillById: (id: number) => BillRow | undefined;
  attachBillSchedule: <T extends { id: number } | null | undefined>(bill: T) => T;
  backfillWindowStart: (base?: Date) => Date;
  backfillWindowEnd: (base?: Date) => Date;
  startOfDay: (d?: Date) => Date;
  upsertOccurrencesForBill: (bill: BillRow, startDate: Date, endDate: Date) => void;
  regenerateFutureUnpaidOccurrencesForBill: (bill: BillRow, fromDate: Date, endDate: Date) => void;
  futureHorizonEnd: (base?: Date) => Date;
  formatDate: (d: Date) => string;
};

export function registerBillRoutes(app: express.Express, deps: BillsDeps) {
  app.get('/api/bills', (_req, res) => {
    const bills = deps.ensureDb().prepare(`SELECT id, name, company, frequency, due_day, next_date, amount, autopay, method, account, notes, created FROM bills ORDER BY name`).all() as BillRow[];
    res.json(bills.map((b) => deps.attachBillSchedule(b)));
  });

  app.get('/api/bills/:id', (req, res) => {
    const bill = deps.getBillById(Number(req.params.id));
    if (!bill) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }
    res.json(deps.attachBillSchedule(bill));
  });

  app.get('/api/bills/:id/details', (req, res) => {
    const billId = Number(req.params.id);
    const bill = deps.getBillById(billId);
    if (!bill) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }

    const payments = deps.ensureDb().prepare('SELECT * FROM payments WHERE bill_id = ? ORDER BY paid_date DESC LIMIT 50').all(billId);
    const today = deps.startOfDay();
    const end = deps.futureHorizonEnd(today);

    deps.upsertOccurrencesForBill(bill, today, end);
    const upcoming = deps
      .ensureDb()
      .prepare(
        `SELECT due_date
         FROM bill_occurrences
         WHERE bill_id = ? AND due_date >= ? AND due_date <= ?
         ORDER BY due_date
         LIMIT 20`
      )
      .all(billId, deps.formatDate(today), deps.formatDate(end))
      .map((r) => (r as { due_date: string }).due_date);

    res.json({
      bill: deps.attachBillSchedule(bill),
      upcoming,
      payments
    });
  });

  const billSchema = z.object({
    name: z.string().trim().min(1),
    company: z.string().optional().default(''),
    frequency: deps.frequencySchema,
    due_day: z.number().int().nullable().optional(),
    next_date: deps.isoDateSchema.nullable().optional(),
    amount: z.number().nonnegative().nullable().optional(),
    autopay: deps.autopaySchema.optional(),
    method: z.string().optional().default(''),
    account: z.string().optional().default(''),
    notes: z.string().optional().default(''),
    custom_dates: z.array(deps.isoDateSchema).optional().default([]),
    month_day_combinations: z.array(z.string().trim().regex(/^\d{2}-\d{2}$/)).optional().default([])
  });

  app.post('/api/bills', (req, res) => {
    const d = deps.parseBody(req, res, billSchema);
    if (!d) return;
    const parsedMonthDays = (d.month_day_combinations || []).map((v) => deps.normalizeMonthDay(v));
    const normalizedMonthDays = Array.from(new Set(parsedMonthDays.filter(Boolean))) as string[];
    if (d.frequency === 'Yearly (Month/Day)' && !normalizedMonthDays.length) {
      res.status(400).json({ error: 'At least one month/day combination is required' });
      return;
    }
    if (parsedMonthDays.some((v) => !v)) {
      res.status(400).json({ error: 'month_day_combinations must be valid MM-DD values' });
      return;
    }
    const insert = deps.ensureDb().prepare(
      `INSERT INTO bills (name, company, frequency, due_day, next_date, amount, autopay, method, account, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = deps.ensureDb().transaction(() => {
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
      const insertCustomDate = deps.ensureDb().prepare('INSERT INTO bill_custom_dates (bill_id, due_date) VALUES (?, ?)');
      for (const dt of d.custom_dates || []) {
        if (dt) insertCustomDate.run(billId, dt);
      }
      const insertMonthDay = deps.ensureDb().prepare('INSERT INTO bill_month_day_combinations (bill_id, month_day) VALUES (?, ?)');
      for (const md of normalizedMonthDays) insertMonthDay.run(billId, md);

      deps.savePaymentMethod(d.method);
      const insertedBill = deps.getBillById(billId);
      if (insertedBill) {
        const start = deps.backfillWindowStart(deps.startOfDay());
        const end = deps.backfillWindowEnd(deps.startOfDay());
        deps.upsertOccurrencesForBill(insertedBill, start, end);
      }
      return billId;
    });

    const billId = tx();
    res.status(201).json(deps.attachBillSchedule(deps.getBillById(billId)));
  });

  app.put('/api/bills/:id', (req, res) => {
    const billId = Number(req.params.id);
    const existing = deps.getBillById(billId);
    if (!existing) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }
    const d = deps.parseBody(req, res, billSchema);
    if (!d) return;
    const parsedMonthDays = (d.month_day_combinations || []).map((v) => deps.normalizeMonthDay(v));
    const normalizedMonthDays = Array.from(new Set(parsedMonthDays.filter(Boolean))) as string[];
    if (d.frequency === 'Yearly (Month/Day)' && !normalizedMonthDays.length) {
      res.status(400).json({ error: 'At least one month/day combination is required' });
      return;
    }
    if (parsedMonthDays.some((v) => !v)) {
      res.status(400).json({ error: 'month_day_combinations must be valid MM-DD values' });
      return;
    }

    const tx = deps.ensureDb().transaction(() => {
      deps
        .ensureDb()
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

      deps.ensureDb().prepare('DELETE FROM bill_custom_dates WHERE bill_id = ?').run(billId);
      const insertCustomDate = deps.ensureDb().prepare('INSERT INTO bill_custom_dates (bill_id, due_date) VALUES (?, ?)');
      for (const dt of d.custom_dates || []) {
        if (dt) insertCustomDate.run(billId, dt);
      }
      deps.ensureDb().prepare('DELETE FROM bill_month_day_combinations WHERE bill_id = ?').run(billId);
      const insertMonthDay = deps.ensureDb().prepare('INSERT INTO bill_month_day_combinations (bill_id, month_day) VALUES (?, ?)');
      for (const md of normalizedMonthDays) insertMonthDay.run(billId, md);

      deps.savePaymentMethod(d.method);
      const updatedBill = deps.getBillById(billId);
      if (updatedBill) {
        const start = deps.backfillWindowStart(deps.startOfDay());
        const end = deps.backfillWindowEnd(deps.startOfDay());
        deps.regenerateFutureUnpaidOccurrencesForBill(updatedBill, start, end);
      }
    });

    tx();
    res.json(deps.attachBillSchedule(deps.getBillById(billId)));
  });

  app.delete('/api/bills/:id', (req, res) => {
    const billId = Number(req.params.id);
    deps.ensureDb().prepare('DELETE FROM bills WHERE id = ?').run(billId);
    res.json({ ok: true });
  });
}
