export type Frequency =
  | 'Monthly'
  | 'Bi-Monthly'
  | 'Quarterly'
  | 'Semi-Annual'
  | 'Annual'
  | 'Weekly'
  | 'Bi-Weekly'
  | 'Estimated Tax (US/NY)'
  | 'Yearly (Month/Day)'
  | 'Custom';

export function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoDate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return new Date(s);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d);
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

export function shiftDate(d: Date, frequency: Frequency, direction = 1) {
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

export function estimatedTaxDatesForYear(year: number) {
  return [new Date(year, 0, 15), new Date(year, 3, 15), new Date(year, 5, 15), new Date(year, 8, 15)];
}

export function calcEstimatedTaxOccurrences(startDate: Date, endDate: Date) {
  const result: string[] = [];
  for (let y = startDate.getFullYear() - 1; y <= endDate.getFullYear() + 1; y += 1) {
    for (const dueDate of estimatedTaxDatesForYear(y)) {
      if (dueDate >= startDate && dueDate <= endDate) result.push(formatDate(dueDate));
    }
  }
  result.sort();
  return result;
}

