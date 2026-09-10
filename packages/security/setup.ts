import { all, first, type Database } from '../db/repository';

export type SetupStatus = 'ready' | 'needs_action' | 'error';
export type SetupCheck = {
  id: string;
  label: string;
  status: SetupStatus;
  detail: string;
};

type SetupEnv = {
  DB: Database;
  JOBS?: unknown;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  OWNER_GITHUB_ID?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  COOKIE_ENCRYPTION_KEY?: string;
};

const requiredTables = [
  'system_state',
  'sessions',
  'plaid_items',
  'accounts',
  'transactions',
  'audit_events',
];

const configured = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

export async function getSetupStatus(env: SetupEnv) {
  const checks: SetupCheck[] = [];
  const githubReady =
    configured(env.GITHUB_CLIENT_ID) &&
    configured(env.GITHUB_CLIENT_SECRET) &&
    configured(env.OWNER_GITHUB_ID);
  checks.push({
    id: 'github_auth',
    label: 'GitHub owner login',
    status: githubReady ? 'ready' : 'needs_action',
    detail: githubReady
      ? 'The OAuth application and owner allowlist are configured.'
      : 'Add GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and OWNER_GITHUB_ID to the Worker secrets.',
  });

  const encryptionReady =
    configured(env.TOKEN_ENCRYPTION_KEY) && configured(env.COOKIE_ENCRYPTION_KEY);
  checks.push({
    id: 'encryption',
    label: 'Encryption keys',
    status: encryptionReady ? 'ready' : 'needs_action',
    detail: encryptionReady
      ? 'Session cookies and bank access tokens can be encrypted.'
      : 'Set TOKEN_ENCRYPTION_KEY and COOKIE_ENCRYPTION_KEY before connecting an institution.',
  });

  let databaseReady = false;
  try {
    await first(env.DB, 'SELECT 1 AS ok');
    databaseReady = true;
  } catch {
    /* The individual check below gives the owner a useful recovery step. */
  }
  checks.push({
    id: 'database',
    label: 'D1 database',
    status: databaseReady ? 'ready' : 'error',
    detail: databaseReady
      ? 'The Worker can reach the configured D1 database.'
      : 'The Worker could not query D1. Check the binding and run the migrations.',
  });

  let missingTables: string[] = [];
  if (databaseReady) {
    try {
      const rows = await all<{ name: string }>(
        env.DB,
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${requiredTables
          .map(() => '?')
          .join(',')})`,
        ...requiredTables,
      );
      const present = new Set(rows.map((row) => row.name));
      missingTables = requiredTables.filter((name) => !present.has(name));
    } catch {
      missingTables = [...requiredTables];
    }
  } else {
    missingTables = [...requiredTables];
  }
  checks.push({
    id: 'schema',
    label: 'Database schema',
    status: missingTables.length ? 'needs_action' : 'ready',
    detail: missingTables.length
      ? `Run the D1 migrations. Missing tables: ${missingTables.join(', ')}.`
      : 'The core financial tables are present.',
  });

  const queueReady = Boolean(env.JOBS);
  checks.push({
    id: 'queue',
    label: 'Background jobs',
    status: queueReady ? 'ready' : 'error',
    detail: queueReady
      ? 'The sync queue is available for imports and scheduled rebuilds.'
      : 'The JOBS queue binding is missing from this Worker environment.',
  });

  const plaidReady = configured(env.PLAID_CLIENT_ID) && configured(env.PLAID_SECRET);
  checks.push({
    id: 'plaid',
    label: 'Plaid banking access',
    status: plaidReady ? 'ready' : 'needs_action',
    detail: plaidReady
      ? 'Plaid credentials are available for read-only bank connections.'
      : 'Add PLAID_CLIENT_ID and PLAID_SECRET to enable bank connections.',
  });

  let connectionCount = 0;
  if (databaseReady && !missingTables.includes('plaid_items')) {
    try {
      const row = await first<{ count: number }>(
        env.DB,
        'SELECT COUNT(*) AS count FROM plaid_items WHERE disconnected_at IS NULL',
      );
      connectionCount = Number(row?.count ?? 0);
    } catch {
      connectionCount = 0;
    }
  }
  checks.push({
    id: 'bank_connection',
    label: 'First bank connection',
    status: connectionCount > 0 ? 'ready' : 'needs_action',
    detail:
      connectionCount > 0
        ? `${connectionCount} active institution${connectionCount === 1 ? '' : 's'} connected.`
        : 'Connect an institution to begin importing your financial history.',
  });

  const hasError = checks.some((check) => check.status === 'error');
  const needsAction = checks.some((check) => check.status === 'needs_action');
  return {
    status: hasError ? 'error' : needsAction ? 'needs_action' : 'ready',
    checks,
    connections: connectionCount,
    next_steps: checks.filter((check) => check.status !== 'ready').map((check) => check.detail),
    checked_at: new Date().toISOString(),
  } as const;
}
