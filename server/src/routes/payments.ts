import express from 'express';
import { z } from 'zod';
import Database from 'better-sqlite3';
import type { BillRow, PaymentRow } from '../types/db';
import type { ParseBody } from '../types/http';

type PaymentsDeps = {
  ensureDb: () => Database.Database;
  parseBody: ParseBody;
  isoDateSchema: z.ZodString;
  getBillById: (id: number) => BillRow | undefined;
  ensureOccurrencesForBillAroundDate: (bill: BillRow, paidDate: string) => void;
  nearestOccurrenceIdForPayment: (billId: number, paidDate: string) => number | null;
  savePaymentMethod: (name: unknown) => void;
  monthDateRange: (month: string) => { start: string; end: string } | null;
  startOfDay: (d?: Date) => Date;
  formatDate: (d: Date) => string;
  shiftDate: (d: Date, frequency: string, direction?: number) => Date | null;
  isoDate: (s: string) => Date;
};

export function registerPaymentRoutes(app: express.Express, deps: PaymentsDeps) {
  const MAX_PAYMENTS_LIMIT = 1000;
  const PAYMENT_COLUMNS = 'p.id, p.bill_id, p.occurrence_id, p.paid_date, p.amount, p.method, p.paid_by, p.confirm_num, p.notes';
  const PAYMENT_BASE_COLUMNS = 'id, bill_id, occurrence_id, paid_date, amount, method, paid_by, confirm_num, notes';

  app.get('/api/payments/:id', (req, res) => {
    const id = Number(req.params.id);
    const payment = deps
      .ensureDb()
      .prepare(`SELECT ${PAYMENT_COLUMNS}, b.name AS bill_name FROM payments p LEFT JOIN bills b ON b.id = p.bill_id WHERE p.id = ?`)
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
    const to = req.query.to ? String(req.query.to) : deps.formatDate(deps.startOfDay(new Date()));
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const limitValue = limitRaw == null || String(limitRaw).trim() === '' ? 'all' : String(limitRaw).trim().toLowerCase();
    const isAllLimit = limitValue === 'all';
    const limit = isAllLimit ? null : Number(limitValue);
    const offset = offsetRaw == null || String(offsetRaw).trim() === '' ? 0 : Number(String(offsetRaw).trim());
    if (!isAllLimit && (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > MAX_PAYMENTS_LIMIT)) {
      res.status(400).json({ error: `Invalid limit. Expected "all" or an integer between 1 and ${MAX_PAYMENTS_LIMIT}.` });
      return;
    }
    if (!Number.isInteger(offset) || offset < 0) {
      res.status(400).json({ error: 'Invalid offset. Expected a non-negative integer.' });
      return;
    }

    const whereClauses: string[] = ['1=1'];
    const filterArgs: Array<string | number> = [];

    if (billIdRaw != null && String(billIdRaw).trim()) {
      const ids = String(billIdRaw)
        .split(',')
        .map((s) => Number(String(s).trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length === 1) {
        whereClauses.push('p.bill_id = ?');
        filterArgs.push(ids[0]);
      } else if (ids.length > 1) {
        whereClauses.push(`p.bill_id IN (${ids.map(() => '?').join(',')})`);
        filterArgs.push(...ids);
      }
    }
    if (month) {
      const range = deps.monthDateRange(month);
      if (!range) {
        res.status(400).json({ error: 'Invalid month. Expected YYYY-MM.' });
        return;
      }
      whereClauses.push('p.paid_date >= ?');
      whereClauses.push('p.paid_date <= ?');
      filterArgs.push(range.start, range.end);
    }
    if (from) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from.trim());
      if (!m) {
        res.status(400).json({ error: 'Invalid from date. Expected YYYY-MM-DD.' });
        return;
      }
      whereClauses.push('p.paid_date >= ?');
      filterArgs.push(from.trim());
    }
    if (to) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to.trim());
      if (!m) {
        res.status(400).json({ error: 'Invalid to date. Expected YYYY-MM-DD.' });
        return;
      }
      whereClauses.push('p.paid_date <= ?');
      filterArgs.push(to.trim());
    }

    const whereSql = whereClauses.join(' AND ');
    const baseSql = `FROM payments p LEFT JOIN bills b ON b.id = p.bill_id WHERE ${whereSql}`;

    if (isAllLimit) {
      const allSql =
        `SELECT ${PAYMENT_COLUMNS}, b.name AS bill_name, o.due_date AS occurrence_due_date
         FROM payments p
         LEFT JOIN bills b ON b.id = p.bill_id
         LEFT JOIN bill_occurrences o ON o.id = p.occurrence_id
         WHERE ${whereSql}
         ORDER BY p.paid_date DESC`;
      const allPayments = deps.ensureDb().prepare(allSql).all(...filterArgs);
      res.json(allPayments);
      return;
    }

    const aggregate = deps
      .ensureDb()
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(p.amount), 0) AS total_spent,
           COALESCE(SUM(COALESCE(b.amount, 0)), 0) AS total_estimated
         ${baseSql}`
      )
      .get(...filterArgs) as { total: number; total_spent: number | null; total_estimated: number | null } | undefined;

    const pageSql =
      `SELECT ${PAYMENT_COLUMNS}, b.name AS bill_name, o.due_date AS occurrence_due_date
       FROM payments p
       LEFT JOIN bills b ON b.id = p.bill_id
       LEFT JOIN bill_occurrences o ON o.id = p.occurrence_id
       WHERE ${whereSql}
       ORDER BY p.paid_date DESC
       LIMIT ? OFFSET ?`;
    const pagePayments = deps.ensureDb().prepare(pageSql).all(...filterArgs, Number(limit), offset);

    const total = Number(aggregate?.total || 0);
    const totalSpent = Number(aggregate?.total_spent || 0);
    const totalEstimated = Number(aggregate?.total_estimated || 0);
    res.json({
      payments: pagePayments,
      total,
      has_more: offset + pagePayments.length < total,
      total_estimated: totalEstimated,
      total_spent: totalSpent
    });
  });

  app.post('/api/payments', (req, res) => {
    const d = deps.parseBody(
      req,
      res,
      z.object({
        bill_id: z.number().int(),
        occurrence_id: z.number().int().nullable().optional(),
        paid_date: deps.isoDateSchema,
        amount: z.number().nonnegative().nullable().optional(),
        method: z.string().optional().default(''),
        paid_by: z.string().optional().default(''),
        confirm_num: z.string().optional().default(''),
        notes: z.string().optional().default('')
      })
    );
    if (!d) return;
    const bill = deps.getBillById(Number(d.bill_id));
    if (!bill) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }
    if (d.occurrence_id != null) {
      const occ = deps
        .ensureDb()
        .prepare('SELECT id, bill_id FROM bill_occurrences WHERE id = ?')
        .get(Number(d.occurrence_id)) as { id: number; bill_id: number } | undefined;
      if (!occ || Number(occ.bill_id) !== Number(d.bill_id)) {
        res.status(400).json({ error: 'Invalid occurrence_id for bill_id' });
        return;
      }
    }

    const tx = deps.ensureDb().transaction(() => {
      deps.ensureOccurrencesForBillAroundDate(bill, d.paid_date);
      let occurrenceId: number | null = null;
      if (d.occurrence_id != null) {
        occurrenceId = Number(d.occurrence_id);
      } else {
        occurrenceId = deps.nearestOccurrenceIdForPayment(Number(d.bill_id), d.paid_date);
      }
      deps
        .ensureDb()
        .prepare(`INSERT INTO payments (bill_id, occurrence_id, paid_date, amount, method, paid_by, confirm_num, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          d.bill_id,
          occurrenceId,
          d.paid_date,
          d.amount == null ? bill.amount : d.amount,
          d.method || bill.method || '',
          d.paid_by || '',
          d.confirm_num || '',
          d.notes || ''
        );

      deps.savePaymentMethod(d.method);

      if (bill.next_date) {
        let dt = deps.isoDate(bill.next_date);
        const today = deps.startOfDay();
        let next = deps.shiftDate(dt, bill.frequency, 1);
        while (next && next <= today) {
          dt = next;
          next = deps.shiftDate(dt, bill.frequency, 1);
        }
        if (next) {
          deps.ensureDb().prepare('UPDATE bills SET next_date = ? WHERE id = ?').run(deps.formatDate(next), bill.id);
        }
      }
    });

    tx();
    res.status(201).json({ ok: true });
  });

  app.put('/api/payments/:id', (req, res) => {
    const paymentId = Number(req.params.id);
    const existing = deps.ensureDb().prepare(`SELECT ${PAYMENT_BASE_COLUMNS} FROM payments WHERE id = ?`).get(paymentId) as PaymentRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }
    const d = deps.parseBody(
      req,
      res,
      z.object({
        paid_date: deps.isoDateSchema.optional(),
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
    const bill = deps.getBillById(Number(existing.bill_id));
    let occurrenceId = existing.occurrence_id ?? null;
    if (d.paid_date && bill) {
      deps.ensureOccurrencesForBillAroundDate(bill, paidDate);
      occurrenceId = deps.nearestOccurrenceIdForPayment(Number(existing.bill_id), paidDate);
    }

    deps
      .ensureDb()
      .prepare(`UPDATE payments SET occurrence_id = ?, paid_date = ?, amount = ?, method = ?, paid_by = ?, confirm_num = ?, notes = ? WHERE id = ?`)
      .run(occurrenceId, paidDate, amount, method, paidBy, confirmNum, notes, paymentId);

    deps.savePaymentMethod(method);
    res.json({ ok: true });
  });

  app.delete('/api/payments/:id', (req, res) => {
    deps.ensureDb().prepare('DELETE FROM payments WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
}
