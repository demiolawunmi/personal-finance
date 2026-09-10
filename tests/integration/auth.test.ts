import { it, expect } from 'vitest';
import { database } from '../fixtures/database';
import { session, requireSession, requireCsrf } from '../../packages/security/auth';
import { sha256 } from '../../packages/security/crypto';
import { insert } from '../../packages/db/repository';
import type { AppEnv } from '../../apps/finance-worker/src/env';
import { oauthRoute } from '../../apps/finance-worker/src/routes/oauth';
it('rejects absent, expired and non-owner sessions', async () => {
  const { db, close } = database();
  try {
    const env = { DB: db, OWNER_GITHUB_ID: '123', APP_ORIGIN: 'https://finance.test' } as AppEnv;
    await expect(
      requireSession(new Request('https://finance.test/api/overview'), env),
    ).rejects.toThrow('AUTHENTICATION_REQUIRED');
    for (const [token, user, expires] of [
      ['wrong', '456', '2099-01-01'],
      ['expired', '123', '2000-01-01'],
      ['valid', '123', '2099-01-01'],
    ])
      await insert(db, 'sessions', {
        id_hash: await sha256(token),
        user_id: user,
        csrf_token: 'csrf',
        expires_at: expires,
      }).run();
    const request = (token: string) =>
      new Request('https://finance.test/api/overview', {
        headers: { Cookie: 'finance_session=' + token },
      });
    expect(await session(request('wrong'), env)).toBeNull();
    expect(await session(request('expired'), env)).toBeNull();
    expect((await requireSession(request('valid'), env)).user_id).toBe('123');
  } finally {
    close();
  }
});
it('requires exact origin and CSRF token for writes', () => {
  const env = { APP_ORIGIN: 'https://finance.test' } as AppEnv;
  const s = { csrf_token: 'csrf' } as any;
  expect(() =>
    requireCsrf(
      new Request('https://finance.test', {
        headers: { Origin: 'https://evil.test', 'X-CSRF-Token': 'csrf' },
      }),
      env,
      s,
    ),
  ).toThrow();
  expect(() =>
    requireCsrf(
      new Request('https://finance.test', {
        headers: { Origin: env.APP_ORIGIN, 'X-CSRF-Token': 'bad' },
      }),
      env,
      s,
    ),
  ).toThrow();
  expect(() =>
    requireCsrf(
      new Request('https://finance.test', {
        headers: { Origin: env.APP_ORIGIN, 'X-CSRF-Token': 'csrf' },
      }),
      env,
      s,
    ),
  ).not.toThrow();
});
it('rejects a callback with no browser-bound state before contacting GitHub', async () => {
  const { db, close } = database();
  try {
    const env = { DB: db } as AppEnv;
    await expect(
      oauthRoute(new Request('https://finance.test/callback?code=x&state=y'), env),
    ).rejects.toThrow('INVALID_OAUTH_CALLBACK');
    await expect(
      oauthRoute(
        new Request('https://finance.test/callback?code=x&state=y', {
          headers: { Cookie: 'finance_oauth=wrong' },
        }),
        env,
      ),
    ).rejects.toThrow('INVALID_OAUTH_STATE');
  } finally {
    close();
  }
});
