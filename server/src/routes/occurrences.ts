import express from 'express';
import Database from 'better-sqlite3';

type BillRow = {
  id: number;
  name: string;
  company: string | null;
  frequency: string;
  due_day: number | null;
  next_date: string | null;
  amount: number | null;
  autopay: 'Yes' | 'No';
  method: string | null;
  account: string | null;
  notes: string | null;
  created: string;
};

type DashboardOccurrenceRow = {
  occurrence_id: number;
  bill_id: number;
  due_date: string;
  expected_amount: number | null;
  bill_name: string;
  company: string | null;
  frequency: string;
  autopay: 'Yes' | 'No';
  payment_id: number | null;
  paid_date: string | null;
  paid_amount: number | null;
};

type YearOccurrenceRow = {
  occurrence_id: number;
  payment_id: number | null;
  bill_id: number;
  bill_name: string;
  company: string;
  amount: number | null;
  due_date: string;
  frequency: string;
  autopay: 'Yes' | 'No';
  paid_date: string | null;
  paid_by: string | null;
  paid_amount: number | null;
};

type YearOccurrenceOut = YearOccurrenceRow & { status: 'overdue' | 'due-soon' | 'upcoming' | 'paid' };

type OccurrenceDeps = {
  ensureDb: () => Database.Database;
  billFields: string;
  startOfDay: (d?: Date) => Date;
  formatDate: (d: Date) => string;
  isoDate: (s: string) => Date;
  monthDateRange: (month: string) => { start: string; end: string } | null;
  upsertOccurrencesForBill: (bill: BillRow, startDate: Date, endDate: Date) => void;
};

export function registerOccurrenceRoutes(app: express.Express, deps: OccurrenceDeps) {
  app.get('/api/dashboard-occurrences', (req, res) => {
    const todayDt = deps.startOfDay();
    const monthStart = new Date(todayDt.getFullYear(), todayDt.getMonth(), 1);
    const monthEnd = new Date(todayDt.getFullYear(), todayDt.getMonth() + 1, 0);
    const minDue = new Date(todayDt);
    minDue.setDate(minDue.getDate() - 30);

    const fromRaw = req.query.from ? String(req.query.from).trim() : deps.formatDate(minDue);
    const toRaw = req.query.to ? String(req.query.to).trim() : deps.formatDate(monthEnd);
    const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromRaw);
    const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toRaw);
    if (!m1 || !m2) {
      res.status(400).json({ error: 'Invalid from/to date. Expected YYYY-MM-DD.' });
      return;
    }

    const from = fromRaw;
    const to = toRaw;
    const bills = deps.ensureDb().prepare(`SELECT ${deps.billFields} FROM bills`).all() as BillRow[];
    const startObj = deps.isoDate(from);
    const endObj = deps.isoDate(to);
    for (const bill of bills) {
      deps.upsertOccurrencesForBill(bill, startObj, endObj);
    }

    const rows = deps
      .ensureDb()
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
      .all(from, to) as DashboardOccurrenceRow[];

    res.json({
      today: deps.formatDate(todayDt),
      month_start: deps.formatDate(monthStart),
      month_end: deps.formatDate(monthEnd),
      overdue_window_start: deps.formatDate(minDue),
      occurrences: rows
    });
  });

  app.get('/api/year-view', (req, res) => {
    const year = Number(req.query.year || new Date().getFullYear());
    const today = deps.startOfDay();

    const yearStart = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    const startStr = deps.formatDate(yearStart);
    const endStr = deps.formatDate(end);

    const yearPaidTotalRow = deps
      .ensureDb()
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE paid_date BETWEEN ? AND ?')
      .get(startStr, endStr) as { total: number | null } | undefined;
    const yearPaidTotal = Number(yearPaidTotalRow?.total || 0);

    const bills = deps.ensureDb().prepare(`SELECT ${deps.billFields} FROM bills`).all() as BillRow[];

    const allOccurrences = (deps
      .ensureDb()
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
      .all(startStr, endStr) as YearOccurrenceRow[])
      .map((occ): YearOccurrenceOut => {
        const occObj = deps.isoDate(occ.due_date);
        let status: YearOccurrenceOut['status'] = 'upcoming';
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

    const months: Record<string, { occurrences: YearOccurrenceOut[]; total: number; total_unpaid: number }> = {};
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
    const month = deps.formatDate(new Date()).slice(0, 7);
    const range = deps.monthDateRange(month);
    const totalBillsRow = deps.ensureDb().prepare('SELECT COUNT(*) AS count FROM bills').get() as { count: number } | undefined;
    const totalBills = Number(totalBillsRow?.count || 0);
    const paidThisMonthRow = deps
      .ensureDb()
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE paid_date >= ? AND paid_date <= ?')
      .get(range?.start || `${month}-01`, range?.end || `${month}-31`) as { total: number | null } | undefined;
    const paidThisMonth = Number(paidThisMonthRow?.total || 0);

    res.json({
      total_bills: totalBills,
      paid_this_month: paidThisMonth,
      today: deps.formatDate(new Date())
    });
  });
}
