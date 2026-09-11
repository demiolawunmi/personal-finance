import { it, expect } from 'vitest';
import { database, seedAccounts } from '../fixtures/database';
import { collectSync, syncItem } from '../../packages/plaid/sync';
import { PlaidClient, PlaidError, type SyncPage } from '../../packages/plaid/client';
import { encrypt } from '../../packages/security/crypto';
import { first, insert } from '../../packages/db/repository';
const account = {
  account_id: 'provider-checking',
  name: 'Checking',
  type: 'depository',
  balances: { current: 100, available: 100, iso_currency_code: 'CAD' },
};
const transaction = {
  transaction_id: 'pending',
  account_id: 'provider-checking',
  amount: 12.34,
  iso_currency_code: 'CAD',
  date: '2026-09-08',
  name: 'Coffee',
  merchant_name: 'Coffee',
  pending: true,
};
const page = (extra: Partial<SyncPage> = {}): SyncPage => ({
  accounts: [account],
  added: [],
  modified: [],
  removed: [],
  has_more: false,
  next_cursor: 'cursor-1',
  transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE',
  ...extra,
});
it('restarts pagination from the original cursor after a mutation', async () => {
  const cursors: string[] = [];
  let n = 0;
  const client = {
    call: async (_p: string, b: any) => {
      cursors.push(b.cursor);
      n++;
      if (n === 2) throw new PlaidError('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION');
      return page({ has_more: n === 1, next_cursor: 'next' });
    },
  } as unknown as PlaidClient;
  await collectSync(client, 'token', 'original');
  expect(cursors).toEqual(['original', 'next', 'original']);
});
it('synchronizes additions, modifications, removals and pending annotation carryover idempotently', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    const keys = { TOKEN_ENCRYPTION_KEY: btoa('k'.repeat(32)), TOKEN_KEY_VERSION: '1' };
    const encrypted = await encrypt('access-test', keys.TOKEN_ENCRYPTION_KEY, 'plaid:item:1');
    await db
      .prepare(
        'UPDATE plaid_items SET access_token_ciphertext=?,access_token_iv=?,key_version=? WHERE id=?',
      )
      .bind(encrypted.ciphertext, encrypted.iv, '1', 'item')
      .run();
    let current = page({ added: [transaction] });
    const client = {
      call: async (path: string) => (path === '/accounts/get' ? { accounts: [account] } : current),
    } as unknown as PlaidClient;
    await syncItem(db, client, keys, 'item');
    const pending = await first<any>(
      db,
      "SELECT * FROM transactions WHERE plaid_transaction_id='pending'",
    );
    await insert(db, 'transaction_annotations', {
      transaction_id: pending.id,
      category_override_id: 'dining',
      note: 'Keep me',
      updated_at: new Date().toISOString(),
    }).run();
    current = page({
      added: [
        {
          ...transaction,
          transaction_id: 'posted',
          pending: false,
          pending_transaction_id: 'pending',
          amount: 13,
        },
      ],
      removed: [{ transaction_id: 'pending' }],
      next_cursor: 'cursor-2',
    });
    await syncItem(db, client, keys, 'item');
    await syncItem(db, client, keys, 'item');
    const posted = await first<any>(
      db,
      "SELECT * FROM transactions WHERE plaid_transaction_id='posted'",
    );
    expect(posted.plaid_amount_micros).toBe(13000000);
    expect(
      (
        await first<any>(
          db,
          'SELECT * FROM transaction_annotations WHERE transaction_id=?',
          posted.id,
        )
      ).note,
    ).toBe('Keep me');
    expect((await first<any>(db, 'SELECT COUNT(*) n FROM transactions')).n).toBe(2);
    current = page({
      modified: [{ ...transaction, transaction_id: 'posted', pending: false, amount: 15 }],
      next_cursor: 'cursor-3',
    });
    await syncItem(db, client, keys, 'item');
    expect(
      (await first<any>(db, "SELECT * FROM transactions WHERE plaid_transaction_id='posted'"))
        .plaid_amount_micros,
    ).toBe(15000000);
    expect(
      (
        await first<any>(
          db,
          'SELECT * FROM transaction_annotations WHERE transaction_id=?',
          posted.id,
        )
      ).category_override_id,
    ).toBe('dining');
  } finally {
    close();
  }
});
it('stores the transaction time-of-day when the institution provides it', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    const keys = { TOKEN_ENCRYPTION_KEY: btoa('k'.repeat(32)), TOKEN_KEY_VERSION: '1' };
    const e = await encrypt('access-test', keys.TOKEN_ENCRYPTION_KEY, 'plaid:item:1');
    await db
      .prepare(
        'UPDATE plaid_items SET access_token_ciphertext=?,access_token_iv=?,key_version=? WHERE id=?',
      )
      .bind(e.ciphertext, e.iv, '1', 'item')
      .run();
    const timed = {
      ...transaction,
      transaction_id: 'timed',
      pending: false,
      datetime: '2026-09-08T18:42:00Z',
      authorized_datetime: '2026-09-08T18:40:00Z',
    };
    const client = {
      call: async (path: string) =>
        path === '/accounts/get' ? { accounts: [account] } : page({ added: [timed] }),
    } as unknown as PlaidClient;
    await syncItem(db, client, keys, 'item');
    const row = await first<any>(
      db,
      "SELECT datetime,authorized_datetime FROM transactions WHERE plaid_transaction_id='timed'",
    );
    expect(row.datetime).toBe('2026-09-08T18:42:00Z');
    expect(row.authorized_datetime).toBe('2026-09-08T18:40:00Z');
  } finally {
    close();
  }
});
it('does not advance the cursor when a later page fails', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    const keys = { TOKEN_ENCRYPTION_KEY: btoa('k'.repeat(32)), TOKEN_KEY_VERSION: '1' };
    const e = await encrypt('access-test', keys.TOKEN_ENCRYPTION_KEY, 'plaid:item:1');
    await db
      .prepare(
        'UPDATE plaid_items SET access_token_ciphertext=?,access_token_iv=?,key_version=? WHERE id=?',
      )
      .bind(e.ciphertext, e.iv, '1', 'item')
      .run();
    let n = 0;
    const client = {
      call: async () => {
        if (n++) throw new PlaidError('INTERNAL_SERVER_ERROR');
        return page({ added: [transaction], has_more: true });
      },
    } as unknown as PlaidClient;
    await expect(syncItem(db, client, keys, 'item')).rejects.toThrow();
    expect(
      (await first<any>(db, "SELECT sync_cursor FROM plaid_items WHERE id='item'")).sync_cursor,
    ).toBeNull();
    expect((await first<any>(db, 'SELECT COUNT(*) n FROM transactions')).n).toBe(0);
  } finally {
    close();
  }
});
