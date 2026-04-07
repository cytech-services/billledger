import express from 'express';
import { z } from 'zod';
import Database from 'better-sqlite3';

type ParseBody = <T extends z.ZodTypeAny>(req: express.Request, res: express.Response, schema: T) => z.infer<T> | null;

type PaymentMethodsDeps = {
  ensureDb: () => Database.Database;
  parseBody: ParseBody;
  normalizeMethodName: (name: unknown) => string;
  savePaymentMethod: (name: unknown) => void;
};

export function registerPaymentMethodRoutes(app: express.Express, deps: PaymentMethodsDeps) {
  app.get('/api/payment-methods', (_req, res) => {
    const rows = deps.ensureDb().prepare('SELECT name FROM payment_methods ORDER BY name').all();
    res.json(rows.map((r) => (r as { name: string }).name));
  });

  app.post('/api/payment-methods', (req, res) => {
    const body = deps.parseBody(req, res, z.object({ name: z.string().trim().min(1) }));
    if (!body) return;
    const name = deps.normalizeMethodName(body.name);
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    deps.savePaymentMethod(name);
    res.status(201).json({ ok: true });
  });

  app.get('/api/payment-methods/stats', (_req, res) => {
    const rows = deps
      .ensureDb()
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
    const body = deps.parseBody(
      req,
      res,
      z.object({
        from: z.string().trim().min(1),
        to: z.string().trim().min(1),
        replace_bill_defaults: z.boolean().optional().default(false)
      })
    );
    if (!body) return;
    const from = deps.normalizeMethodName(body.from);
    const to = deps.normalizeMethodName(body.to);
    const replaceBillDefaults = Boolean(body.replace_bill_defaults);
    if (!from || !to) {
      res.status(400).json({ error: 'from and to are required' });
      return;
    }

    const tx = deps.ensureDb().transaction(() => {
      const paymentsUpdated = deps
        .ensureDb()
        .prepare('UPDATE payments SET method = ? WHERE LOWER(method) = LOWER(?)')
        .run(to, from).changes;
      let billsUpdated = 0;
      if (replaceBillDefaults) {
        billsUpdated = deps
          .ensureDb()
          .prepare('UPDATE bills SET method = ? WHERE LOWER(method) = LOWER(?)')
          .run(to, from).changes;
      }
      return { paymentsUpdated, billsUpdated };
    });

    const result = tx();
    res.json(result);
  });

  app.delete('/api/payment-methods/:name', (req, res) => {
    const name = deps.normalizeMethodName(req.params.name);
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const usedRow = deps
      .ensureDb()
      .prepare('SELECT COUNT(*) AS c FROM payments WHERE LOWER(method) = LOWER(?)')
      .get(name) as { c: number } | undefined;
    const used = Number(usedRow?.c || 0);
    if (used > 0) {
      res.status(409).json({ error: 'Method is used by payments', requires_replacement: true, payment_count: used });
      return;
    }

    deps.ensureDb().prepare('DELETE FROM payment_methods WHERE LOWER(name) = LOWER(?)').run(name);
    res.json({ ok: true });
  });
}
