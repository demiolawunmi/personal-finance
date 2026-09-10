import { it, expect } from 'vitest';
import { encrypt, decrypt, sha256 } from '../../packages/security/crypto';
import { verifyWebhook } from '../../packages/plaid/webhooks';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { PlaidClient } from '../../packages/plaid/client';
import { redact } from '../../packages/security/redaction';
it('encrypts with unique IVs and binds ciphertext to item and key version', async () => {
  const key = btoa('x'.repeat(32));
  const a = await encrypt('access-token', key, 'item:1'),
    b = await encrypt('access-token', key, 'item:1');
  expect(a.iv).not.toBe(b.iv);
  expect(a.ciphertext).not.toContain('access-token');
  expect(await decrypt(a.ciphertext, a.iv, key, 'item:1')).toBe('access-token');
  await expect(decrypt(a.ciphertext, a.iv, key, 'item:2')).rejects.toThrow();
});
it('verifies signature, algorithm, age and exact raw body hash', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const key = await exportJWK(publicKey);
  const raw = '{"item_id":"x"}';
  const now = new Date();
  const client = { call: async () => ({ key }) } as unknown as PlaidClient;
  const sign = (iat: number, hash: string) =>
    new SignJWT({ request_body_sha256: hash })
      .setProtectedHeader({ alg: 'ES256', kid: 'k' })
      .setIssuedAt(iat)
      .sign(privateKey);
  const jwt = await sign(Math.floor(now.getTime() / 1000), await sha256(raw));
  expect(await verifyWebhook(raw, jwt, client, now)).toMatchObject({ item_id: 'x' });
  await expect(verifyWebhook(raw + ' ', jwt, client, now)).rejects.toThrow('INVALID_WEBHOOK');
  await expect(
    verifyWebhook(
      raw,
      await sign(Math.floor(now.getTime() / 1000) - 301, await sha256(raw)),
      client,
      now,
    ),
  ).rejects.toThrow();
  await expect(
    verifyWebhook(
      raw,
      await sign(Math.floor(now.getTime() / 1000) + 60, await sha256(raw)),
      client,
      now,
    ),
  ).rejects.toThrow();
  await expect(verifyWebhook(raw, null, client, now)).rejects.toThrow();
});
it('redacts nested credential fields', () => {
  expect(redact({ access_token: 'abc', nested: { Authorization: 'Bearer x' }, safe: 3 })).toEqual({
    access_token: '[REDACTED]',
    nested: { Authorization: '[REDACTED]' },
    safe: 3,
  });
});

it('supports key rotation without retaining plaintext credentials', async () => {
  const { database, seedAccounts } = await import('../fixtures/database');
  const { rotateTokens } = await import('../../packages/security/rotation');
  const { first } = await import('../../packages/db/repository');
  const { accessToken } = await import('../../packages/plaid/sync');
  const { db, close } = database();
  try {
    await seedAccounts(db);
    const oldKey = btoa('a'.repeat(32)),
      newKey = btoa('b'.repeat(32));
    const e = await encrypt('fixture-secret', oldKey, 'plaid:item:1');
    await db
      .prepare(
        'UPDATE plaid_items SET access_token_ciphertext=?,access_token_iv=?,key_version=? WHERE id=?',
      )
      .bind(e.ciphertext, e.iv, '1', 'item')
      .run();
    const keys = {
      TOKEN_ENCRYPTION_KEY: newKey,
      TOKEN_KEY_VERSION: '2',
      TOKEN_PREVIOUS_KEYS: JSON.stringify({ '1': oldKey }),
    };
    expect((await rotateTokens(db, keys, 'test')).rotated).toBe(1);
    const item = await first<any>(db, "SELECT * FROM plaid_items WHERE id='item'");
    expect(item.key_version).toBe('2');
    expect(JSON.stringify(item)).not.toContain('fixture-secret');
    expect(await accessToken(item, keys)).toBe('fixture-secret');
    expect((await rotateTokens(db, keys, 'test')).rotated).toBe(0);
  } finally {
    close();
  }
});
