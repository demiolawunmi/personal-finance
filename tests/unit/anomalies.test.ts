import { describe, it, expect } from 'vitest';
import { detectAnomalies } from '../../packages/analytics/anomalies';
import { effective } from '../fixtures/transactions';

const D = 1_000_000;

describe('anomaly detection', () => {
  it('flags a duplicate within 48 hours and cites the matching charge', () => {
    const rows = [
      effective('a', -100 * D, { date: '2026-09-01', merchant: 'Amazon' }),
      effective('b', -100 * D, { date: '2026-09-02', merchant: 'Amazon' }),
    ];
    const found = detectAnomalies(rows);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'duplicate_candidate', severity: 'medium' });
    expect(found[0].transaction_id).toBe('b');
    expect(found[0].evidence).toMatch(/24h earlier/);
  });

  it('does not flag the same amount outside the 48 hour window', () => {
    const rows = [
      effective('a', -100 * D, { date: '2026-09-01', merchant: 'Amazon' }),
      effective('b', -100 * D, { date: '2026-09-04', merchant: 'Amazon' }),
    ];
    expect(detectAnomalies(rows).some((a) => a.kind === 'duplicate_candidate')).toBe(false);
  });

  it('suppresses low-value daily habits from the duplicate rule', () => {
    const rows = [
      effective('a', -5 * D, {
        date: '2026-09-01',
        merchant: 'Coffee',
        category_id: 'restaurants',
      }),
      effective('b', -5 * D, {
        date: '2026-09-02',
        merchant: 'Coffee',
        category_id: 'restaurants',
      }),
    ];
    expect(detectAnomalies(rows)).toHaveLength(0);
  });

  it('flags an amount spike above three sigma with enough history', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      effective('h' + i, -(10 + i) * D, {
        date: `2026-08-0${i + 1}`,
        merchant: 'Loblaws',
      }),
    );
    rows.push(effective('big', -100 * D, { date: '2026-09-01', merchant: 'Loblaws' }));
    const found = detectAnomalies(rows);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'unusual_amount', severity: 'high' });
    expect(found[0].evidence).toMatch(/σ/);
  });

  it('exempts recognised recurring merchants from amount spikes', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      effective('h' + i, -(10 + i) * D, { date: `2026-08-0${i + 1}`, merchant: 'Hydro' }),
    );
    rows.push(effective('big', -100 * D, { date: '2026-09-01', merchant: 'Hydro' }));
    expect(detectAnomalies(rows, { recurringMerchants: new Set(['Hydro']) })).toHaveLength(0);
  });

  it('flags a first-ever high-dollar merchant charge', () => {
    const found = detectAnomalies([
      effective('a', -600 * D, { date: '2026-09-01', merchant: 'Tech Shop' }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'large_new_merchant', severity: 'medium' });
  });

  it('flags overdraft fees at high severity', () => {
    const found = detectAnomalies([
      effective('a', -35 * D, {
        date: '2026-09-01',
        merchant: 'Bank',
        name: 'OVERDRAFT FEE',
      }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'fee', severity: 'high' });
  });

  it('emits at most one alert per transaction', () => {
    const rows = [
      effective('a', -40 * D, { date: '2026-09-01', merchant: 'Amazon' }),
      effective('b', -40 * D, { date: '2026-09-02', merchant: 'Amazon' }),
    ];
    const forB = detectAnomalies(rows).filter((a) => a.transaction_id === 'b');
    expect(forB).toHaveLength(1);
  });
});
