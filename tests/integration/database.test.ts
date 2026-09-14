import { it, expect } from 'vitest';
import { database, seedAccounts } from '../fixtures/database';
import { tx } from '../fixtures/transactions';
import { insert, first, all } from '../../packages/db/repository';
import { rebuild, reconcile } from '../../packages/db/derive';
import {
  spending,
  transactions,
  balances,
  periodAttention,
  trends,
} from '../../packages/analytics/service';
import { report } from '../../packages/reports/engine';
it('applies migrations and reconciles reports with manual overrides and refunds', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    await insert(db, 'transactions', tx('p', -150000000, { date: '2026-09-01' })).run();
    await insert(db, 'transactions', tx('r', 80000000, { date: '2026-09-05' })).run();
    await insert(
      db,
      'transactions',
      tx('pay', 1000000000, { plaid_primary_category: 'INCOME' }),
    ).run();
    await rebuild(db);
    expect((await reconcile(db)).ok).toBe(true);
    const p = { start_date: '2026-09-01', end_date: '2026-09-30', currency: 'CAD' };
    expect((await spending(db, p)).spending.amount).toBe('70.000000');
    await report(db, p, 'monthly', true);
    await report(db, p, 'monthly', true);
    expect((await all(db, 'SELECT * FROM report_runs')).length).toBe(1);
    await insert(db, 'transaction_annotations', {
      transaction_id: 'p',
      category_override_id: 'dining',
      updated_at: new Date().toISOString(),
    }).run();
    await expect(spending(db, p)).rejects.toThrow('DERIVED_DATA_REBUILDING');
    await rebuild(db);
    expect(
      (await first<any>(db, "SELECT * FROM transaction_facts WHERE transaction_id='p'"))!
        .category_id,
    ).toBe('dining');
    expect((await reconcile(db)).ok).toBe(true);
  } finally {
    close();
  }
});
it('search is bounded and excludes provider IDs, notes and tokens', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    for (let i = 0; i < 105; i++)
      await insert(db, 'transactions', tx('t' + String(i).padStart(3, '0'), -100)).run();
    await rebuild(db);
    const p = { start_date: '2026-09-01', end_date: '2026-09-30', currency: 'CAD' };
    const page = await transactions(db, p, { limit: 100 });
    expect(page.transactions).toHaveLength(100);
    expect(JSON.stringify(page)).not.toContain('plaid_transaction_id');
    const next = await transactions(db, p, { limit: 100, cursor: page.next_cursor! });
    expect(next.transactions).toHaveLength(5);
    expect(new Set([...page.transactions, ...next.transactions].map((t) => t.id)).size).toBe(105);
    expect((await transactions(db, p, { query: "' OR 1=1 --" })).transactions).toHaveLength(0);
  } finally {
    close();
  }
});
it('normalizes liability balances and signals missing snapshots', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    for (const [account_id, current_amount_micros] of [
      ['checking', 1000000000],
      ['card', 200000000],
    ] as const)
      await insert(db, 'balance_snapshots', {
        id: account_id,
        account_id,
        current_amount_micros,
        currency: 'CAD',
        observed_at: '2026-09-08T12:00:00Z',
      }).run();
    const result = await balances(db, 'CAD');
    expect(result.net_worth.amount).toBe('800.000000');
    expect(result.coverage_complete).toBe(false);
    expect(result.accounts.find((a) => a.id === 'savings')!.current).toBeNull();
  } finally {
    close();
  }
});
it('enforces exact-money and transactional fence constraints', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    await expect(
      db.batch([
        insert(db, 'transactions', tx('x', -1)),
        db.prepare('INSERT INTO write_fences VALUES(?,?)').bind('bad', 0),
      ]),
    ).rejects.toThrow();
    expect(await first(db, "SELECT * FROM transactions WHERE id='x'")).toBeNull();
    await expect(
      insert(db, 'transactions', tx('bad', -100, { plaid_amount_micros: 200 })).run(),
    ).rejects.toThrow();
  } finally {
    close();
  }
});

it('versions report inputs when budget limits change', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    await rebuild(db);
    const p = { start_date: '2026-09-01', end_date: '2026-09-30', currency: 'CAD' };
    const initial = await report(db, p, 'monthly', true);
    await insert(db, 'budgets', {
      id: 'b',
      name: 'Budget',
      currency: 'CAD',
      start_date: '2026-09-01',
    }).run();
    await insert(db, 'budget_lines', {
      budget_id: 'b',
      category_id: 'dining',
      limit_micros: 100000000,
    }).run();
    await rebuild(db);
    const updated = await report(db, p, 'monthly', true);
    expect(updated.data_revision).toBeGreaterThan(initial.data_revision);
    expect((await all(db, 'SELECT id FROM report_runs')).length).toBe(2);
  } finally {
    close();
  }
});
it('projects pace from elapsed days, not the whole selected month', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    for (const date of ['2026-06-15', '2026-07-15', '2026-08-15'])
      await insert(
        db,
        'transactions',
        tx('base-' + date, -100000000, {
          date,
          merchant_name: 'Uber',
          plaid_primary_category: 'TRANSPORTATION',
          plaid_detailed_category: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
        }),
      ).run();
    await insert(
      db,
      'transactions',
      tx('current', -200000000, {
        date: '2026-09-05',
        merchant_name: 'Uber',
        plaid_primary_category: 'TRANSPORTATION',
        plaid_detailed_category: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
      }),
    ).run();
    await rebuild(db);
    const p = { start_date: '2026-09-01', end_date: '2026-09-30', currency: 'CAD' };
    const early = await periodAttention(db, p, '2026-09-15');
    const late = await periodAttention(db, p, '2026-09-30');
    expect(early.pace.days_elapsed).toBe(15);
    expect(late.pace.days_elapsed).toBe(30);
    const signal = early.category_signals.find((s) => s.category === 'transportation');
    expect(signal?.spent_to_date.amount).toBe('200.000000');
    expect(signal?.projected_month_spending.amount).toBe('400.000000');
    // By month end the same spending is no longer off-pace.
    expect(late.category_signals.find((s) => s.category === 'transportation')).toBeUndefined();
  } finally {
    close();
  }
});
it('trends does not fabricate net worth before the first balance snapshot', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    await insert(db, 'transactions', tx('jun', -100000000, { date: '2026-06-15' })).run();
    await insert(db, 'transactions', tx('jul', -100000000, { date: '2026-07-15' })).run();
    await insert(db, 'transactions', tx('aug', -100000000, { date: '2026-08-15' })).run();
    await insert(db, 'balance_snapshots', {
      id: 's1',
      account_id: 'checking',
      current_amount_micros: 500000000,
      currency: 'CAD',
      observed_at: '2026-08-15T10:00:00.000Z',
    }).run();
    await rebuild(db);
    const t = await trends(
      db,
      { start_date: '2026-08-01', end_date: '2026-08-31', currency: 'CAD' },
      6,
    );
    expect(t.months.find((m) => m.month === '2026-06')?.net_worth).toBeNull();
    expect(t.months.find((m) => m.month === '2026-07')?.net_worth).toBeNull();
    expect(t.months.find((m) => m.month === '2026-08')?.net_worth).toBe(500);
  } finally {
    close();
  }
});
it('can estimate pre-snapshot net worth from cash flow when enabled', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    await insert(db, 'transactions', tx('jun', -100000000, { date: '2026-06-15' })).run();
    await insert(db, 'transactions', tx('jul', -100000000, { date: '2026-07-15' })).run();
    await insert(db, 'transactions', tx('aug', -100000000, { date: '2026-08-15' })).run();
    await insert(db, 'balance_snapshots', {
      id: 's1',
      account_id: 'checking',
      current_amount_micros: 200000000,
      currency: 'CAD',
      observed_at: '2026-08-15T10:00:00.000Z',
    }).run();
    await rebuild(db);
    const t = await trends(
      db,
      { start_date: '2026-08-01', end_date: '2026-08-31', currency: 'CAD' },
      6,
      true,
    );
    expect(t.months.find((m) => m.month === '2026-08')).toMatchObject({
      net_worth: 200,
      estimated: false,
    });
    expect(t.months.find((m) => m.month === '2026-07')).toMatchObject({
      net_worth: 300,
      estimated: true,
    });
    expect(t.months.find((m) => m.month === '2026-06')).toMatchObject({
      net_worth: 400,
      estimated: true,
    });
  } finally {
    close();
  }
});
