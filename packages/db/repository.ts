export type Database = D1Database;
export function stmt(db: Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params);
}
export async function all<T>(db: Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const result = await stmt(db, sql, ...params).all<T>();
  if (!result.success) throw new Error('DATABASE_ERROR');
  return result.results;
}
export async function first<T>(db: Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return stmt(db, sql, ...params).first<T>();
}
export function auditStatement(
  db: Database,
  event: string,
  resource: string,
  id: string | null,
  actor = 'system',
  metadata: Record<string, unknown> = {},
) {
  return stmt(
    db,
    'INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?)',
    crypto.randomUUID(),
    new Date().toISOString(),
    actor === 'system' ? 'system' : 'owner',
    actor,
    event,
    resource,
    id,
    JSON.stringify(metadata),
  );
}
export async function audit(
  db: Database,
  event: string,
  resource: string,
  id: string | null,
  actor = 'system',
  metadata: Record<string, unknown> = {},
) {
  await auditStatement(db, event, resource, id, actor, metadata).run();
}
export async function revision(db: Database) {
  const r = await first<{ data_revision: number; derived_revision: number }>(
    db,
    'SELECT data_revision,derived_revision FROM system_state WHERE id=1',
  );
  if (!r) throw new Error('DATABASE_UNINITIALIZED');
  return r;
}
export function insert(db: Database, table: string, row: Record<string, unknown>, suffix = '') {
  const keys = Object.keys(row);
  return stmt(
    db,
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) ${suffix}`,
    ...Object.values(row),
  );
}
