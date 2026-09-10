import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
/** Uses real SQLite constraints and transactions, with the small D1 query surface. */
export function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(resolve('migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(resolve('migrations', name), 'utf8'));
  function prepared(sql: string, values: unknown[] = []): any {
    const execute = () => {
      const statement = sqlite.prepare(sql);
      const rows = statement.all(...(values as any[]));
      return {
        success: true,
        results: rows,
        meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get()!.n) },
        error: undefined,
      };
    };
    return {
      bind: (...args: unknown[]) => prepared(sql, args),
      first: async (column?: string) => {
        const r = execute().results[0];
        return column ? (r?.[column] ?? null) : (r ?? null);
      },
      all: async () => execute(),
      run: async () => execute(),
      raw: async () => execute().results.map((r) => Object.values(r)),
      _execute: execute,
    };
  }
  const db = {
    prepare: prepared,
    batch: async (statements: any[]) => {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((s) => s._execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
  return { db, sqlite, close: () => sqlite.close() };
}
export const NOW = '2026-09-08T16:00:00.000Z';
export async function seedAccounts(db: D1Database) {
  await db
    .prepare(
      "INSERT INTO plaid_items(id,plaid_item_id,institution_name,created_at,last_successful_sync_at,history_complete) VALUES('item','provider-item','Sandbox Bank',?,?,1)",
    )
    .bind(NOW, NOW)
    .run();
  for (const [id, type] of [
    ['checking', 'depository'],
    ['savings', 'depository'],
    ['card', 'credit'],
  ])
    await db
      .prepare(
        'INSERT INTO accounts(id,plaid_account_id,plaid_item_id,name,type,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(id, 'provider-' + id, 'item', id, type, 'CAD', NOW, NOW)
      .run();
}
