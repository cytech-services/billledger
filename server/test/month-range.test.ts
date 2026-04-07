import { describe, expect, test } from 'vitest';
import { monthDateRange } from '../src/app';

describe('monthDateRange', () => {
  test('returns month boundaries for valid month', () => {
    expect(monthDateRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthDateRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });

  test('rejects invalid month values', () => {
    expect(monthDateRange('2026-00')).toBeNull();
    expect(monthDateRange('2026-13')).toBeNull();
    expect(monthDateRange('not-a-month')).toBeNull();
  });
});
