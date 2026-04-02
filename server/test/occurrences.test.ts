import { describe, expect, test } from 'vitest';
import { calcEstimatedTaxOccurrences } from '../src/services/occurrences';

describe('Estimated Tax (US/NY) occurrences', () => {
  test('includes the four standard due dates for a year', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 11, 31);
    const occ = calcEstimatedTaxOccurrences(start, end);
    expect(occ).toEqual(['2026-01-15', '2026-04-15', '2026-06-15', '2026-09-15']);
  });

  test('handles ranges that cross year boundaries', () => {
    const start = new Date(2026, 8, 1); // Sep 1 2026
    const end = new Date(2027, 1, 1); // Feb 1 2027
    const occ = calcEstimatedTaxOccurrences(start, end);
    expect(occ).toEqual(['2026-09-15', '2027-01-15']);
  });
});

