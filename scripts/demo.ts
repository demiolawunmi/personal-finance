/** Isolated synthetic preview. Never bundled into the Worker; never connects to Plaid. */
import { createServer, type Connect } from 'vite';
import { database, seedAccounts } from '../tests/fixtures/database';
import { tx } from '../tests/fixtures/transactions';
import { insert } from '../packages/db/repository';
import { sha256 } from '../packages/security/crypto';
import { rebuild } from '../packages/db/derive';
import { report } from '../packages/reports/engine';
import { today, monthPeriod, addDays } from '../packages/domain/periods';
import { dashboardApi } from '../apps/finance-worker/src/routes/dashboard-api';
import type { AppEnv } from '../apps/finance-worker/src/env';
const { db } = database();
await seedAccounts(db);
const current = today();
const p = monthPeriod(current);
const now = new Date().toISOString();
await db.prepare('UPDATE plaid_items SET last_successful_sync_at=?').bind(now).run();
const monthStart = p.start_date;
let counter = 0;
const purchases = [
  ['Groceries', 68.42, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'],
  ['Uber Eats', 32.8, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT'],
  ['Bookshop', 46.5, 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_BOOKSTORES'],
  ['Transit', 22.75, 'TRANSPORTATION', 'TRANSPORTATION_PUBLIC_TRANSIT'],
  ['Coffee', 5.4, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE'],
];
for (let day = 1; day <= Math.min(8, Number(current.slice(-2))); day++)
  for (const [merchant, amount, primary, detailed] of purchases.slice(0, (day % 4) + 1)) {
    await insert(
      db,
      'transactions',
      tx('demo-' + counter++, -Math.round(Number(amount) * 1e6), {
        date: monthStart.slice(0, 8) + String(day).padStart(2, '0'),
        name: String(merchant),
        merchant_name: String(merchant),
        plaid_primary_category: String(primary),
        plaid_detailed_category: String(detailed),
      }),
    ).run();
  }
await insert(
  db,
  'transactions',
  tx('demo-income', 2480000000, {
    date: monthStart,
    name: 'Pay deposit',
    merchant_name: 'Employer',
    plaid_primary_category: 'INCOME',
  }),
).run();
await insert(
  db,
  'transactions',
  tx('demo-pending', -87000000, { date: current, pending: 1, name: 'Pending purchase' }),
).run();
for (let i = 3; i >= 0; i--) {
  const d = new Date(monthStart);
  d.setUTCMonth(d.getUTCMonth() - i);
  for (const [merchant, amount] of [
    ['Music subscription', 13.99],
    ['Cloud storage', 3.99],
  ] as const)
    await insert(
      db,
      'transactions',
      tx('demo-recurring-' + merchant + i, -Math.round(amount * 1e6), {
        date: d.toISOString().slice(0, 10),
        name: merchant,
        merchant_name: merchant,
        plaid_primary_category: 'ENTERTAINMENT',
      }),
    ).run();
}
// Signal fixtures: a duplicate pair, a first-ever high-dollar merchant and a
// fee make the anomaly feed visible; three months of modest grocery spend give
// the pace detector a baseline to project against.
await insert(
  db,
  'transactions',
  tx('demo-dup-a', -128000000, {
    date: monthStart.slice(0, 8) + '05',
    name: 'AMAZON MKTPLACE',
    merchant_name: 'Amazon',
    plaid_primary_category: 'GENERAL_MERCHANDISE',
  }),
).run();
await insert(
  db,
  'transactions',
  tx('demo-dup-b', -128000000, {
    date: monthStart.slice(0, 8) + '06',
    name: 'AMAZON MKTPLACE',
    merchant_name: 'Amazon',
    plaid_primary_category: 'GENERAL_MERCHANDISE',
  }),
).run();
await insert(
  db,
  'transactions',
  tx('demo-new-merchant', -899000000, {
    date: monthStart.slice(0, 8) + '07',
    name: 'APPLE STORE',
    merchant_name: 'Apple Store',
    plaid_primary_category: 'GENERAL_MERCHANDISE',
  }),
).run();
await insert(
  db,
  'transactions',
  tx('demo-fee', -35000000, {
    date: monthStart.slice(0, 8) + '08',
    name: 'OVERDRAFT FEE',
    merchant_name: 'Bank Fee',
    plaid_primary_category: 'BANK_FEES',
  }),
).run();
for (let i = 3; i >= 1; i--) {
  const hist = new Date(monthStart);
  hist.setUTCMonth(hist.getUTCMonth() - i);
  await insert(
    db,
    'transactions',
    tx('demo-grocery-history-' + i, -60000000, {
      date: hist.toISOString().slice(0, 10),
      name: 'Loblaws',
      merchant_name: 'Loblaws',
      plaid_primary_category: 'FOOD_AND_DRINK',
      plaid_detailed_category: 'FOOD_AND_DRINK_GROCERIES',
    }),
  ).run();
}
for (const [account_id, amount] of [
  ['checking', 2431],
  ['savings', 5200],
  ['card', 482],
] as const)
  await insert(db, 'balance_snapshots', {
    id: account_id,
    account_id,
    current_amount_micros: amount * 1e6,
    available_amount_micros: amount * 1e6,
    currency: 'CAD',
    observed_at: now,
  }).run();
await insert(db, 'budgets', {
  id: 'demo-budget',
  name: 'Monthly budget',
  currency: 'CAD',
  start_date: monthStart,
}).run();
for (const [category, amount] of [
  ['dining', 250],
  ['groceries', 350],
  ['shopping', 200],
] as const)
  await insert(db, 'budget_lines', {
    budget_id: 'demo-budget',
    category_id: category,
    limit_micros: amount * 1e6,
  }).run();
await insert(db, 'sessions', {
  id_hash: await sha256('demo-local-only'),
  user_id: 'demo',
  csrf_token: 'demo-csrf',
  expires_at: '2099-01-01',
}).run();
await rebuild(db);
await report(db, p, 'monthly', true);
const origin = 'http://localhost:4173';
const env = {
  DB: db,
  APP_ENV: 'local',
  APP_ORIGIN: origin,
  TIMEZONE: 'America/Toronto',
  OWNER_GITHUB_ID: 'demo',
  JOBS: {
    send: async (job: any) => {
      await rebuild(db);
      if (job.type === 'GENERATE_REPORT') await report(db, job.period, job.reportType, true);
    },
  },
} as unknown as AppEnv;
const handle: Connect.NextHandleFunction = async (req, res, next) => {
  if (!req.url?.startsWith('/api/')) return next();
  try {
    if (req.url.startsWith('/api/plaid/')) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Demo preview: bank connections are disabled.' }));
      return;
    }
    if (req.url.startsWith('/api/session')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ user_id: 'demo', csrf_token: 'demo-csrf', environment: 'demo' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
    headers.set('Cookie', 'finance_session=demo-local-only');
    const response = await dashboardApi(
      new Request(origin + req.url, { method: req.method, headers, ...(body ? { body } : {}) }),
      env,
    );
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(await response.text());
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Preview request failed.' }));
  }
};
const server = await createServer({
  configFile: 'apps/finance-worker/vite.config.ts',
  server: { host: 'localhost', port: 4173, strictPort: true },
  plugins: [
    {
      name: 'synthetic-finance-api',
      configureServer(server) {
        server.middlewares.use(handle);
      },
    },
  ],
});
await server.listen();
console.log(
  'Synthetic demo only: http://localhost:4173. Data is ephemeral and bank connections are disabled.',
);
