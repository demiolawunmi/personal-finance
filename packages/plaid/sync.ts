import { ZodError } from 'zod';
import { all, first, stmt, insert, auditStatement, type Database } from '../db/repository';
import { micros } from '../domain/money';
import { decrypt } from '../security/crypto';
import {
  PlaidClient,
  PlaidError,
  syncSchema,
  type SyncPage,
  type PlaidAccount,
  type PlaidTransaction,
} from './client';
import type { Transaction } from '../domain/transactions';
export type Item = {
  id: string;
  plaid_item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  logo: string | null;
  primary_color: string | null;
  access_token_ciphertext: string | null;
  access_token_iv: string | null;
  key_version: string | null;
  sync_cursor: string | null;
  disconnected_at: string | null;
  status: string;
};
export type TokenKeys = {
  TOKEN_ENCRYPTION_KEY: string;
  TOKEN_KEY_VERSION: string;
  TOKEN_PREVIOUS_KEYS?: string;
};
export async function accessToken(item: Item, keys: TokenKeys) {
  if (!item.access_token_ciphertext || !item.access_token_iv || !item.key_version)
    throw new Error('ITEM_DISCONNECTED');
  const key =
    item.key_version === keys.TOKEN_KEY_VERSION
      ? keys.TOKEN_ENCRYPTION_KEY
      : JSON.parse(keys.TOKEN_PREVIOUS_KEYS || '{}')[item.key_version];
  if (!key) throw new Error('TOKEN_KEY_VERSION_MISSING');
  return decrypt(
    item.access_token_ciphertext,
    item.access_token_iv,
    key,
    `plaid:${item.id}:${item.key_version}`,
  );
}
export async function collectSync(
  client: PlaidClient,
  token: string,
  cursor: string | null,
): Promise<SyncPage[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pages: SyncPage[] = [];
    let next = cursor ?? '';
    try {
      for (let i = 0; i < 1000; i++) {
        const page = await client.call(
          '/transactions/sync',
          {
            access_token: token,
            cursor: next,
            count: 500,
            options: { include_original_description: true },
          },
          syncSchema,
        );
        pages.push(page);
        if (!page.has_more) return pages;
        if (page.next_cursor === next) throw new Error('SYNC_CURSOR_STALLED');
        next = page.next_cursor;
      }
      throw new Error('SYNC_PAGE_LIMIT');
    } catch (error) {
      if (
        !(error instanceof PlaidError) ||
        error.code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new Error('SYNC_FAILED');
}
export function normalize(
  t: PlaidTransaction,
  accountId: string,
  id: string,
  now: string,
): Transaction {
  const amount = micros(t.amount, { round: true });
  return {
    id,
    plaid_transaction_id: t.transaction_id,
    account_id: accountId,
    plaid_amount_micros: amount,
    cashflow_amount_micros: -amount,
    currency: t.iso_currency_code ?? t.unofficial_currency_code ?? 'UNKNOWN',
    date: t.date,
    authorized_date: t.authorized_date ?? null,
    datetime: t.datetime ?? null,
    authorized_datetime: t.authorized_datetime ?? null,
    name: t.name,
    merchant_name: t.merchant_name ?? null,
    original_description: t.original_description ?? null,
    plaid_primary_category: t.personal_finance_category?.primary ?? null,
    plaid_detailed_category: t.personal_finance_category?.detailed ?? null,
    pending: Number(t.pending),
    pending_transaction_id: t.pending_transaction_id ?? null,
    payment_channel: t.payment_channel ?? null,
    is_removed: 0,
    created_at: now,
    updated_at: now,
  };
}
export function accountStatements(
  db: Database,
  accounts: PlaidAccount[],
  itemId: string,
  existing: Map<string, string>,
  now: string,
) {
  const statements: D1PreparedStatement[] = [];
  for (const a of accounts) {
    const id = existing.get(a.account_id) ?? crypto.randomUUID();
    existing.set(a.account_id, id);
    const currency =
      a.balances.iso_currency_code ?? a.balances.unofficial_currency_code ?? 'UNKNOWN';
    statements.push(
      insert(
        db,
        'accounts',
        {
          id,
          plaid_account_id: a.account_id,
          plaid_item_id: itemId,
          name: a.name,
          official_name: a.official_name ?? null,
          type: a.type,
          subtype: a.subtype ?? null,
          currency,
          mask: a.mask ?? null,
          is_active: 1,
          created_at: now,
          updated_at: now,
        },
        'ON CONFLICT(plaid_account_id) DO UPDATE SET name=excluded.name,official_name=excluded.official_name,type=excluded.type,subtype=excluded.subtype,currency=excluded.currency,mask=excluded.mask,is_active=1,updated_at=excluded.updated_at',
      ),
    );
    statements.push(
      insert(
        db,
        'balance_snapshots',
        {
          id: crypto.randomUUID(),
          account_id: id,
          current_amount_micros:
            a.balances.current === null ? null : micros(a.balances.current, { round: true }),
          available_amount_micros:
            a.balances.available === null ? null : micros(a.balances.available, { round: true }),
          limit_amount_micros:
            a.balances.limit == null ? null : micros(a.balances.limit, { round: true }),
          currency,
          observed_at: now,
          source_updated_at: a.balances.last_updated_datetime ?? null,
        },
        'ON CONFLICT(account_id,observed_at) DO NOTHING',
      ),
    );
  }
  return statements;
}
// Converts any thrown value into a stable, non-sensitive diagnostic. Field
// paths and Zod issue codes are safe; response values and messages are not.
function diagnostic(error: unknown): { code: string; detail: string } {
  if (error instanceof PlaidError) return { code: error.code, detail: error.code };
  if (error instanceof ZodError)
    return {
      code: 'SCHEMA_MISMATCH',
      detail:
        'SCHEMA_MISMATCH:' +
        error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '(root)'}:${i.code}`)
          .join('|'),
    };
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message))
    return { code: error.message, detail: error.message };
  return {
    code: 'SYNC_FAILED',
    detail: error instanceof Error ? `SYNC_FAILED:${error.name}` : 'SYNC_FAILED',
  };
}
export async function syncItem(db: Database, client: PlaidClient, keys: TokenKeys, itemId: string) {
  const item = await first<Item>(db, 'SELECT * FROM plaid_items WHERE id=?', itemId);
  if (!item || item.disconnected_at) return;
  const owner = crypto.randomUUID(),
    now = new Date().toISOString(),
    expires = new Date(Date.now() + 25 * 60 * 1000).toISOString();
  const lease = await stmt(
    db,
    'INSERT INTO sync_leases VALUES(?,?,?) ON CONFLICT(item_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE sync_leases.expires_at<? RETURNING owner',
    itemId,
    owner,
    expires,
    now,
  ).first<{ owner: string }>();
  if (!lease || lease.owner !== owner) throw new Error('SYNC_BUSY');
  await insert(db, 'sync_runs', {
    id: owner,
    item_id: itemId,
    started_at: now,
    status: 'running',
  }).run();
  try {
    // Backfill institution branding once; it is optional metadata.
    if (!item.logo && item.institution_id) {
      try {
        const meta = await client.call<{
          institution: { logo: string | null; primary_color: string | null };
        }>('/institutions/get_by_id', {
          institution_id: item.institution_id,
          country_codes: ['CA'],
          options: { include_optional_metadata: true },
        });
        await stmt(
          db,
          'UPDATE plaid_items SET logo=?,primary_color=? WHERE id=?',
          meta.institution.logo ?? null,
          meta.institution.primary_color ?? null,
          itemId,
        ).run();
      } catch {
        /* Branding is optional; never block a sync on it. */
      }
    }
    const pages = await collectSync(client, await accessToken(item, keys), item.sync_cursor);
    const accountsResponse = await client.call<{ accounts: PlaidAccount[] }>('/accounts/get', {
      access_token: await accessToken(item, keys),
    });
    const existingAccounts = await all<{ id: string; plaid_account_id: string }>(
      db,
      'SELECT id,plaid_account_id FROM accounts WHERE plaid_item_id=?',
      itemId,
    );
    const accountMap = new Map(existingAccounts.map((a) => [a.plaid_account_id, a.id]));
    const completed = new Date().toISOString();
    const existing = await all<{ id: string; plaid_transaction_id: string }>(
      db,
      'SELECT t.id,t.plaid_transaction_id FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.plaid_item_id=?',
      itemId,
    );
    const ids = new Map(existing.map((t) => [t.plaid_transaction_id, t.id]));
    const fence = crypto.randomUUID();
    const statements = [
      stmt(
        db,
        `INSERT INTO write_fences VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM sync_leases l JOIN plaid_items i ON i.id=l.item_id WHERE l.item_id=? AND l.owner=? AND l.expires_at>? AND i.disconnected_at IS NULL AND i.sync_cursor IS ?) THEN 1 ELSE 0 END)`,
        fence,
        itemId,
        owner,
        completed,
        item.sync_cursor,
      ),
      stmt(db, 'UPDATE accounts SET is_active=0 WHERE plaid_item_id=?', itemId),
      ...accountStatements(db, accountsResponse.accounts, itemId, accountMap, completed),
    ];
    // Preserve all pages until the full update succeeds: no partial cursor commit.
    for (const page of pages) {
      statements.push(
        ...accountStatements(
          db,
          page.accounts.filter((a) => !accountMap.has(a.account_id)),
          itemId,
          accountMap,
          completed,
        ),
      );
      for (const t of [...page.added, ...page.modified]) {
        const accountId = accountMap.get(t.account_id);
        if (!accountId) throw new Error('UNKNOWN_ACCOUNT');
        const id = ids.get(t.transaction_id) ?? crypto.randomUUID();
        ids.set(t.transaction_id, id);
        const row = normalize(t, accountId, id, completed);
        statements.push(
          insert(
            db,
            'transactions',
            row,
            'ON CONFLICT(plaid_transaction_id) DO UPDATE SET ' +
              Object.keys(row)
                .filter((k) => !['id', 'plaid_transaction_id', 'created_at'].includes(k))
                .map((k) => `${k}=excluded.${k}`)
                .join(','),
          ),
        );
        if (!t.pending && t.pending_transaction_id) {
          statements.push(
            stmt(
              db,
              `INSERT INTO transaction_annotations SELECT ?,merchant_override,category_override_id,essentiality_override,exclude_from_spending,exclude_reason,note,updated_at FROM transaction_annotations WHERE transaction_id=(SELECT id FROM transactions WHERE plaid_transaction_id=?) ON CONFLICT(transaction_id) DO NOTHING`,
              id,
              t.pending_transaction_id,
            ),
          );
          statements.push(
            stmt(
              db,
              'UPDATE transactions SET is_removed=1,updated_at=? WHERE plaid_transaction_id=? AND pending=1',
              completed,
              t.pending_transaction_id,
            ),
          );
        }
      }
      for (const t of page.removed)
        statements.push(
          stmt(
            db,
            'UPDATE transactions SET is_removed=1,updated_at=? WHERE plaid_transaction_id=? AND account_id IN (SELECT id FROM accounts WHERE plaid_item_id=?)',
            completed,
            t.transaction_id,
            itemId,
          ),
        );
    }
    const added = pages.reduce((n, p) => n + p.added.length, 0),
      modified = pages.reduce((n, p) => n + p.modified.length, 0),
      removed = pages.reduce((n, p) => n + p.removed.length, 0);
    statements.push(
      stmt(
        db,
        `UPDATE plaid_items SET sync_cursor=?,last_successful_sync_at=?,status='healthy',history_complete=CASE WHEN ?='HISTORICAL_UPDATE_COMPLETE' THEN 1 ELSE history_complete END WHERE id=?`,
        pages.at(-1)!.next_cursor,
        completed,
        pages.at(-1)!.transactions_update_status ?? '',
        itemId,
      ),
      stmt(
        db,
        `UPDATE sync_runs SET completed_at=?,status='completed',added=?,modified=?,removed=? WHERE id=?`,
        completed,
        added,
        modified,
        removed,
        owner,
      ),
      stmt(
        db,
        "UPDATE data_health_events SET resolved_at=? WHERE item_id=? AND kind='sync_failed'",
        completed,
        itemId,
      ),
      auditStatement(db, 'SYNC_COMPLETED', 'item', itemId, 'system', { added, modified, removed }),
      stmt(db, 'DELETE FROM write_fences WHERE id=?', fence),
    );
    await db.batch(statements);
  } catch (error) {
    const { code, detail } = diagnostic(error);
    const status = code === 'ITEM_LOGIN_REQUIRED' ? 'reauth_required' : 'error';
    console.error(JSON.stringify({ event: 'SYNC_FAILED', item_id: itemId, code, detail }));
    await db.batch([
      stmt(
        db,
        'UPDATE sync_runs SET status=?,error_code=?,completed_at=? WHERE id=?',
        'failed',
        detail,
        new Date().toISOString(),
        owner,
      ),
      stmt(
        db,
        'UPDATE plaid_items SET status=? WHERE id=? AND disconnected_at IS NULL',
        status,
        itemId,
      ),
      insert(db, 'data_health_events', {
        id: crypto.randomUUID(),
        item_id: itemId,
        kind: 'sync_failed',
        severity: 'error',
        message: code,
        created_at: new Date().toISOString(),
      }),
    ]);
    throw error;
  } finally {
    await stmt(db, 'DELETE FROM sync_leases WHERE item_id=? AND owner=?', itemId, owner).run();
  }
}
