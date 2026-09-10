import { describe, it, expect } from 'vitest';
import { micros, money, sum } from '../../packages/domain/money';
import { validatePeriod, monthPeriod, previousPeriod } from '../../packages/domain/periods';
import { classify } from '../../packages/classification/engine';
import { detectRecurring } from '../../packages/classification/recurring';
import { summarize } from '../../packages/analytics/core';
import { tx, effective } from '../fixtures/transactions';
const categories = [
  { id: 'shopping', type: 'spending' },
  { id: 'dining', type: 'spending' },
  { id: 'other', type: 'spending' },
  { id: 'transfers', type: 'transfer' },
  { id: 'income', type: 'income' },
] as const;
const classifyRows = (rows: ReturnType<typeof tx>[], annotations: any[] = [], rules: any[] = []) =>
  classify(rows, annotations, rules, [...categories]);
describe('exact money', () => {
  it('converts decimal and exponent inputs without floating arithmetic', () => {
    expect(micros('12.34')).toBe(12340000);
    expect(micros(0.1)).toBe(100000);
    expect(micros('1e-6')).toBe(1);
    expect(sum([micros(0.1), micros(0.2)])).toBe(micros('.30'.replace(/^\./, '0.')));
    expect(money(-12340000, 'CAD')).toEqual({ amount: '-12.340000', currency: 'CAD' });
  });
  it('rejects unsupported precision and unsafe integers', () => {
    expect(() => micros('0.0000001')).toThrow();
    expect(() => micros('9007199254.740992')).toThrow();
    expect(() => sum([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
  it('rounds provider sub-micro precision half away from zero when asked', () => {
    expect(micros('0.0000005', { round: true })).toBe(1);
    expect(micros('0.0000004', { round: true })).toBe(0);
    expect(micros('-0.0000005', { round: true })).toBe(-1);
    expect(micros(12.3456789, { round: true })).toBe(12345679);
    expect(micros('12.34', { round: true })).toBe(12340000);
  });
});
describe('classification', () => {
  it('pairs card payments without counting consumption twice', () => {
    const r = classifyRows([
      tx('purchase', -100000000, { account_id: 'card' }),
      tx('out', -100000000, { name: 'Credit card payment', merchant_name: null }),
      tx('in', 100000000, { name: 'Payment thank you', merchant_name: null, account_id: 'card' }),
    ]);
    expect(r.pairs).toHaveLength(1);
    expect(r.facts.map((f) => f.kind)).toEqual(['spending', 'transfer', 'transfer']);
  });
  it('does not pair different currencies or ambiguous candidates', () => {
    const rows = [
      tx('a', -500, { name: 'Transfer', merchant_name: null }),
      tx('b', 500, { name: 'Transfer', merchant_name: null, account_id: 'savings' }),
      tx('c', 500, { name: 'Transfer', merchant_name: null, account_id: 'card' }),
    ];
    expect(classifyRows(rows).pairs).toHaveLength(0);
    expect(classifyRows([rows[0], { ...rows[1], currency: 'USD' }]).pairs).toHaveLength(0);
  });
  it('manual overrides win over rules and matching', () => {
    const rows = [
      tx('a', -500, { name: 'Transfer' }),
      tx('b', 500, { name: 'Transfer', account_id: 'savings' }),
    ];
    const r = classifyRows(
      rows,
      [
        {
          transaction_id: 'a',
          category_override_id: 'dining',
          merchant_override: 'Dinner',
          exclude_from_spending: 0,
        },
      ],
      [
        {
          id: 'r',
          field: 'merchant',
          operator: 'contains',
          pattern: 'Dinner',
          category_id: 'shopping',
          priority: 1,
          version: 2,
        },
      ],
    );
    expect(r.facts[0]).toMatchObject({
      category_id: 'dining',
      merchant: 'Dinner',
      classification_source: 'manual',
    });
    expect(r.pairs).toHaveLength(0);
  });
  it('refunds offset original spending but unknown inflows are not income', () => {
    const r = classifyRows([
      tx('p', -150000000, { date: '2026-08-20' }),
      tx('refund', 80000000),
      tx('unknown', 500000000, { merchant_name: 'Unknown' }),
    ]);
    expect(r.facts[1]).toMatchObject({ kind: 'refund', refund_of: 'p', category_id: 'shopping' });
    expect(r.facts[2].kind).toBe('unclassified_inflow');
  });
  it('does not reuse a purchase for refunds beyond its amount', () => {
    const r = classifyRows([
      tx('p', -100, { date: '2026-09-01' }),
      tx('r1', 80, { date: '2026-09-02' }),
      tx('r2', 80, { date: '2026-09-03' }),
    ]);
    expect(r.facts[1].refund_of).toBe('p');
    expect(r.facts[2].refund_of).toBeNull();
  });
});
describe('financial summaries', () => {
  it('reconciles income, net refunds, transfers, pending and currencies', () => {
    const p = { start_date: '2026-09-01', end_date: '2026-09-30', currency: 'CAD' };
    const rows = [
      effective('income', 1000000000, { kind: 'income' }),
      effective('purchase', -150000000),
      effective('refund', 80000000, { kind: 'refund' }),
      effective('transfer', -600000000, { kind: 'transfer' }),
      effective('pending', -87000000, { pending: 1 }),
      effective('usd', -100000000, { currency: 'USD' }),
      effective('removed', -100000000, { is_removed: 1 }),
    ];
    const r = summarize(rows, p);
    expect(r.spending.amount).toBe('70.000000');
    expect(r.net_cashflow.amount).toBe('930.000000');
    expect(r.pending.amount).toBe('87.000000');
    expect(r.transfers_excluded).toBe(1);
  });
  it('uses null savings rate for no income and handles net refunds', () => {
    const r = summarize([effective('refund', 10000000, { kind: 'refund' })], {
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      currency: 'CAD',
    });
    expect(r.savings_rate).toBeNull();
    expect(r.spending.amount).toBe('-10.000000');
  });
  it('validates dates, leap years and bounded ranges', () => {
    expect(monthPeriod('2024-02-12').end_date).toBe('2024-02-29');
    expect(
      previousPeriod({ start_date: '2026-01-01', end_date: '2026-01-07', currency: 'CAD' })
        .start_date,
    ).toBe('2025-12-25');
    expect(() =>
      validatePeriod({ start_date: '2026-02-30', end_date: '2026-03-10', currency: 'CAD' }),
    ).toThrow();
    expect(() =>
      validatePeriod({ start_date: '2024-01-01', end_date: '2026-01-01', currency: 'CAD' }),
    ).toThrow();
  });
});
it('detects recurring bills, monthly equivalents and price changes', () => {
  const rows = ['2026-06-30', '2026-07-31', '2026-08-31'].map((date, i) =>
    effective('r' + i, i === 2 ? -13990000 : -12420000, { date, merchant: 'Spotify' }),
  );
  const r = detectRecurring(rows, '2026-09-08');
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({
    frequency: 'monthly',
    next_expected_date: '2026-09-30',
    typical_amount_micros: 13990000,
    previous_amount_micros: 12420000,
    monthly_amount_micros: 13990000,
  });
});

it('treats payroll reversals as negative income, not consumption', () => {
  const result = classifyRows([
    tx('salary', 100000000, { plaid_primary_category: 'INCOME' }),
    tx('reversal', -20000000, { plaid_primary_category: 'INCOME' }),
  ]);
  expect(result.facts.map((f) => f.kind)).toEqual(['income', 'income']);
});
it('does not use a prior purchase from another currency to infer a refund', () => {
  const result = classifyRows([
    tx('purchase', -100000000, { currency: 'USD' }),
    tx('credit', 10000000, { currency: 'CAD' }),
  ]);
  expect(result.facts[1].kind).toBe('unclassified_inflow');
});
