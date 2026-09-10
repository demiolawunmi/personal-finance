import { it, expect } from 'vitest';
import { database, seedAccounts } from '../fixtures/database';
import { tx } from '../fixtures/transactions';
import { insert, first } from '../../packages/db/repository';
import { rebuild } from '../../packages/db/derive';
import { sha256 } from '../../packages/security/crypto';
import { dashboardApi } from '../../apps/finance-worker/src/routes/dashboard-api';
import { oauthRoute } from '../../apps/finance-worker/src/routes/oauth';
import type { AppEnv } from '../../apps/finance-worker/src/env';
async function setup() {
  const fixture = database();
  await seedAccounts(fixture.db);
  await insert(fixture.db, 'sessions', {
    id_hash: await sha256('test-session'),
    user_id: 'owner',
    csrf_token: 'test-csrf',
    expires_at: '2099-01-01',
  }).run();
  const env = {
    DB: fixture.db,
    APP_ENV: 'local',
    APP_ORIGIN: 'http://localhost:8787',
    OWNER_GITHUB_ID: 'owner',
    TIMEZONE: 'America/Toronto',
    JOBS: {
      send: async () => {
        await rebuild(fixture.db);
      },
    },
  } as unknown as AppEnv;
  const request = (path: string, method: string, body?: unknown) =>
    new Request(env.APP_ORIGIN + path, {
      method,
      headers: {
        Cookie: 'finance_session=test-session',
        Origin: env.APP_ORIGIN,
        'X-CSRF-Token': 'test-csrf',
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { ...fixture, env, request };
}
it('dashboard partial annotation edits preserve existing notes and provider truth', async () => {
  const { db, env, request, close } = await setup();
  try {
    await insert(db, 'transactions', tx('t', -10000000)).run();
    await rebuild(db);
    await dashboardApi(
      request('/api/transactions/t/annotation', 'PATCH', {
        note: 'Existing note',
        category_override_id: 'dining',
      }),
      env,
    );
    await dashboardApi(
      request('/api/transactions/t/annotation', 'PATCH', { merchant_override: 'Friendly name' }),
      env,
    );
    const annotation = await first<any>(
      db,
      "SELECT * FROM transaction_annotations WHERE transaction_id='t'",
    );
    expect(annotation.note).toBe('Existing note');
    expect(annotation.category_override_id).toBe('dining');
    expect((await first<any>(db, "SELECT * FROM transactions WHERE id='t'")).merchant_name).toBe(
      'Shop',
    );
    expect(
      (await first<any>(db, "SELECT * FROM transaction_facts WHERE transaction_id='t'")).merchant,
    ).toBe('Friendly name');
  } finally {
    close();
  }
});
it('rejects invalid budget categories before changing a saved budget', async () => {
  const { db, env, request, close } = await setup();
  try {
    await expect(
      dashboardApi(
        request('/api/budgets/b', 'PUT', {
          name: 'Budget',
          currency: 'CAD',
          start_date: '2026-09-01',
          lines: [{ category_id: 'transfers', limit: '100' }],
        }),
        env,
      ),
    ).rejects.toThrow('INVALID_BUDGET_CATEGORY');
    expect(await first(db, "SELECT * FROM budgets WHERE id='b'")).toBeNull();
  } finally {
    close();
  }
});
it('reports actionable setup checks without exposing secret values', async () => {
  const { env, request, close } = await setup();
  try {
    Object.assign(env, {
      GITHUB_CLIENT_ID: 'github-client-id',
      GITHUB_CLIENT_SECRET: 'github-super-secret',
      TOKEN_ENCRYPTION_KEY: 'token-super-secret',
      COOKIE_ENCRYPTION_KEY: 'cookie-super-secret',
      PLAID_CLIENT_ID: 'plaid-client-id',
      PLAID_SECRET: 'plaid-super-secret',
    });
    const response = await dashboardApi(request('/api/setup', 'GET'), env);
    const result = (await response.json()) as any;
    expect(result.status).toBe('ready');
    expect(result.checks.map((check: any) => check.id)).toEqual([
      'github_auth',
      'encryption',
      'database',
      'schema',
      'queue',
      'plaid',
      'bank_connection',
    ]);
    expect(JSON.stringify(result)).not.toContain('github-super-secret');
    expect(JSON.stringify(result)).not.toContain('token-super-secret');
    expect(JSON.stringify(result)).not.toContain('cookie-super-secret');
    expect(JSON.stringify(result)).not.toContain('plaid-super-secret');
  } finally {
    close();
  }
});
it('persists anomaly review state across rebuilds', async () => {
  const { db, env, request, close } = await setup();
  const query = '?currency=CAD&start_date=2026-09-01&end_date=2026-09-30';
  try {
    await insert(
      db,
      'transactions',
      tx('dup-a', -100000000, { date: '2026-09-01', merchant_name: 'Amazon', name: 'AMAZON' }),
    ).run();
    await insert(
      db,
      'transactions',
      tx('dup-b', -100000000, { date: '2026-09-02', merchant_name: 'Amazon', name: 'AMAZON' }),
    ).run();
    await rebuild(db);
    const list = (await (
      await dashboardApi(request('/api/anomalies' + query, 'GET'), env)
    ).json()) as any;
    expect(list.anomalies.length).toBeGreaterThan(0);
    const anomaly = list.anomalies[0];
    expect(['low', 'medium', 'high']).toContain(anomaly.severity);
    expect(anomaly.review_status).toBe('open');

    const save = await dashboardApi(
      request(`/api/anomalies/${anomaly.id}/review`, 'POST', { status: 'reviewed' }),
      env,
    );
    expect(((await save.json()) as any).saved).toBe(true);

    await rebuild(db);
    const after = (await (
      await dashboardApi(request('/api/anomalies' + query, 'GET'), env)
    ).json()) as any;
    expect(after.anomalies.find((a: any) => a.id === anomaly.id).review_status).toBe('reviewed');

    await expect(
      dashboardApi(request('/api/anomalies/missing/review', 'POST', { status: 'reviewed' }), env),
    ).rejects.toThrow('ANOMALY_NOT_FOUND');
  } finally {
    close();
  }
});
it('surfaces all-time open signals and dynamic notices', async () => {
  const { db, env, request, close } = await setup();
  try {
    await insert(
      db,
      'transactions',
      tx('old-a', -150000000, { date: '2026-06-01', merchant_name: 'Amazon', name: 'AMAZON' }),
    ).run();
    await insert(
      db,
      'transactions',
      tx('old-b', -150000000, { date: '2026-06-02', merchant_name: 'Amazon', name: 'AMAZON' }),
    ).run();
    await rebuild(db);

    // Period-scoped anomalies for the default month are empty...
    const spending = (await (
      await dashboardApi(
        request('/api/spending?currency=CAD&start_date=2026-09-01&end_date=2026-09-30', 'GET'),
        env,
      )
    ).json()) as any;
    expect(spending.anomalies).toHaveLength(0);

    // ...but the all-time signal feed still carries the June duplicate.
    const signals = (await (
      await dashboardApi(request('/api/signals?currency=CAD', 'GET'), env)
    ).json()) as any;
    expect(signals.signals.length).toBeGreaterThan(0);
    expect(signals.signals.some((s: any) => s.type === 'anomaly')).toBe(true);

    const health = (await (
      await dashboardApi(request('/api/data-health', 'GET'), env)
    ).json()) as any;
    expect(Array.isArray(health.notices)).toBe(true);
    expect(health.notices.length).toBeGreaterThan(0);
    expect(health.notices[0]).toHaveProperty('severity');
    expect(health.notices[0]).toHaveProperty('title');
  } finally {
    close();
  }
});
it('filters the transaction list to unclassified inflows for the classify action', async () => {
  const { db, env, request, close } = await setup();
  const q = '?currency=CAD&start_date=2026-09-01&end_date=2026-09-30';
  try {
    await insert(
      db,
      'transactions',
      tx('inflow', 50000000, { date: '2026-09-10', name: 'ONLINE DEPOSIT' }),
    ).run();
    await insert(
      db,
      'transactions',
      tx('spend', -50000000, { date: '2026-09-11', name: 'GROCERY STORE' }),
    ).run();
    await rebuild(db);
    const filtered = (await (
      await dashboardApi(request('/api/transactions' + q + '&status=unclassified', 'GET'), env)
    ).json()) as any;
    const ids = filtered.transactions.map((t: any) => t.id);
    expect(ids).toContain('inflow');
    expect(ids).not.toContain('spend');
    expect(filtered.transactions.every((t: any) => t.kind === 'unclassified_inflow')).toBe(true);
  } finally {
    close();
  }
});
it('explains missing local GitHub OAuth configuration at sign-in', async () => {  const { env, close } = await setup();
  try {
    const response = await oauthRoute(new Request(env.APP_ORIGIN + '/login'), env);
    expect(response?.status).toBe(503);
    const body = await response?.text();
    expect(body).toContain('GITHUB_CLIENT_ID');
    expect(body).toContain('/callback');
  } finally {
    close();
  }
});
