import { all, stmt, auditStatement, type Database } from '../db/repository';
import { accessToken, type Item, type TokenKeys } from '../plaid/sync';
import { encrypt } from './crypto';
export async function rotateTokens(db: Database, keys: TokenKeys, actor: string) {
  const items = await all<Item>(
    db,
    'SELECT * FROM plaid_items WHERE disconnected_at IS NULL AND key_version<>?',
    keys.TOKEN_KEY_VERSION,
  );
  let rotated = 0;
  for (const item of items) {
    const value = await accessToken(item, keys);
    const e = await encrypt(
      value,
      keys.TOKEN_ENCRYPTION_KEY,
      `plaid:${item.id}:${keys.TOKEN_KEY_VERSION}`,
    );
    const result = await db.batch([
      stmt(
        db,
        'UPDATE plaid_items SET access_token_ciphertext=?,access_token_iv=?,key_version=? WHERE id=? AND key_version=? AND access_token_ciphertext=?',
        e.ciphertext,
        e.iv,
        keys.TOKEN_KEY_VERSION,
        item.id,
        item.key_version,
        item.access_token_ciphertext,
      ),
      auditStatement(db, 'TOKEN_ROTATION_ATTEMPTED', 'item', item.id, actor, {
        from: item.key_version,
        to: keys.TOKEN_KEY_VERSION,
      }),
    ]);
    rotated += result[0].meta.changes;
  }
  return { rotated };
}
