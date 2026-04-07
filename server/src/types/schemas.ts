import { z } from 'zod';

export const FrequencySchema = z.enum([
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

export const AutopaySchema = z.enum(['Yes', 'No']).default('No');

export const IsoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format');
