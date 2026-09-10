import { z } from 'zod';
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid calendar date',
  );
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);
export const periodShape = {
  start_date: dateSchema,
  end_date: dateSchema,
  currency: currencySchema.default('CAD'),
};
export type Period = { start_date: string; end_date: string; currency: string };
export function validatePeriod(p: Period): Period {
  dateSchema.parse(p.start_date);
  dateSchema.parse(p.end_date);
  currencySchema.parse(p.currency);
  const days = dayDiff(p.start_date, p.end_date);
  if (days < 0 || days > 365) throw new Error('PERIOD_MUST_BE_1_TO_366_DAYS');
  return p;
}
export function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
export function addDays(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}
export function today(timezone = 'America/Toronto', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function monthPeriod(date: string, currency = 'CAD'): Period {
  const start_date = date.slice(0, 7) + '-01';
  const d = new Date(start_date);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { start_date, end_date: addDays(d.toISOString().slice(0, 10), -1), currency };
}
export function previousPeriod(p: Period): Period {
  const days = dayDiff(p.start_date, p.end_date) + 1;
  return { ...p, start_date: addDays(p.start_date, -days), end_date: addDays(p.start_date, -1) };
}
