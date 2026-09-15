import { it, expect, vi } from 'vitest';
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import { database } from '../fixtures/database';
import { session, requireSession, requireCsrf } from '../../packages/security/auth';
import { encrypt, sha256 } from '../../packages/security/crypto';
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

it('reuses a valid owner session during a GitHub callback', async () => {
  const { db, sqlite, close } = database();
  try {
    const browserToken = 'browser-token';
    const sessionToken = 'session-token';
    const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    await insert(db, 'sessions', {
      id_hash: await sha256(sessionToken),
      user_id: '123',
      csrf_token: 'session-csrf',
      expires_at: '2099-01-01T00:00:00.000Z',
    }).run();
    const encrypted = await encrypt('null', encryptionKey, 'oauth-state:state');
    await insert(db, 'oauth_states', {
      id: 'state',
      browser_hash: await sha256(browserToken),
      request_json: JSON.stringify(encrypted),
      expires_at: '2099-01-01T00:00:00.000Z',
    }).run();
    const githubFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'github-token' }))
      .mockResolvedValueOnce(Response.json({ id: 123 }));
    vi.stubGlobal('fetch', githubFetch);
    const env = {
      DB: db,
      OWNER_GITHUB_ID: '123',
      APP_ORIGIN: 'https://finance.test',
      COOKIE_ENCRYPTION_KEY: encryptionKey,
      GITHUB_CLIENT_ID: 'github-client',
      GITHUB_CLIENT_SECRET: 'github-secret',
    } as AppEnv;

    const response = await oauthRoute(
      new Request('https://finance.test/callback?code=code&state=state', {
        headers: {
          Cookie: `finance_oauth=${browserToken}; finance_session=${sessionToken}`,
        },
      }),
      env,
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toBe('https://finance.test/');
    expect(response?.headers.get('Set-Cookie')).not.toContain('finance_session=');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n).toBe(1);
    expect(githubFetch).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    close();
  }
});

it('creates a consent-specific CSRF token instead of exposing the session token', async () => {
  const { db, close } = database();
  try {
    const sessionToken = 'session-token';
    await insert(db, 'sessions', {
      id_hash: await sha256(sessionToken),
      user_id: '123',
      csrf_token: 'session-csrf',
      expires_at: '2099-01-01T00:00:00.000Z',
    }).run();
    const auth: AuthRequest = {
      responseType: 'code',
      clientId: 'codex',
      redirectUri: 'https://client.test/callback',
      scope: ['finance:summary'],
      state: 'client-state',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
    };
    const env = {
      DB: db,
      OWNER_GITHUB_ID: '123',
      APP_ORIGIN: 'https://finance.test',
      OAUTH_PROVIDER: {
        parseAuthRequest: vi.fn().mockResolvedValue(auth),
        lookupClient: vi.fn().mockResolvedValue({ clientId: 'codex', clientName: 'Codex' }),
      },
    } as unknown as AppEnv;

    const response = await oauthRoute(
      new Request('https://finance.test/authorize', {
        headers: { Cookie: `finance_session=${sessionToken}` },
      }),
      env,
    );
    const html = await response!.text();
    const consentToken = html.match(/name="csrf" value="([^"]+)"/)?.[1];
    expect(consentToken).toBeTruthy();
    expect(consentToken).not.toBe('session-csrf');
    const stored = await db
      .prepare('SELECT csrf_hash FROM oauth_consents')
      .first<{ csrf_hash: string }>();
    expect(stored?.csrf_hash).toBe(await sha256(consentToken!));
  } finally {
    close();
  }
});

it('allows the client redirect origin in the consent page form-action', async () => {
  const { db, close } = database();
  try {
    const sessionToken = 'session-token';
    await insert(db, 'sessions', {
      id_hash: await sha256(sessionToken),
      user_id: '123',
      csrf_token: 'session-csrf',
      expires_at: '2099-01-01T00:00:00.000Z',
    }).run();
    const auth: AuthRequest = {
      responseType: 'code',
      clientId: 'chatgpt',
      redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      scope: ['finance:summary'],
      state: 'client-state',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
    };
    const env = {
      DB: db,
      OWNER_GITHUB_ID: '123',
      APP_ORIGIN: 'https://finance.test',
      OAUTH_PROVIDER: {
        parseAuthRequest: vi.fn().mockResolvedValue(auth),
        lookupClient: vi.fn().mockResolvedValue({ clientId: 'chatgpt', clientName: 'ChatGPT' }),
      },
    } as unknown as AppEnv;

    const response = await oauthRoute(
      new Request('https://finance.test/authorize', {
        headers: { Cookie: `finance_session=${sessionToken}` },
      }),
      env,
    );

    // Chromium/Safari block a form-submission redirect to an origin outside
    // form-action, which stalled the OAuth code handoff to ChatGPT.
    const policy = response!.headers.get('Content-Security-Policy');
    expect(policy).toContain("form-action 'self' https://chatgpt.com");
  } finally {
    close();
  }
});

it('accepts a pending consent after another owner session replaces the browser cookie', async () => {
  const { db, close } = database();
  try {
    const originalSessionToken = 'original-session';
    const currentSessionToken = 'current-session';
    for (const [token, csrf] of [
      [originalSessionToken, 'original-session-csrf'],
      [currentSessionToken, 'current-session-csrf'],
    ])
      await insert(db, 'sessions', {
        id_hash: await sha256(token),
        user_id: '123',
        csrf_token: csrf,
        expires_at: '2099-01-01T00:00:00.000Z',
      }).run();

    const consentToken = 'consent-specific-token';
    const auth: AuthRequest = {
      responseType: 'code',
      clientId: 'codex',
      redirectUri: 'https://client.test/callback',
      scope: ['finance:summary'],
      state: 'client-state',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
    };
    await insert(db, 'oauth_consents', {
      id: 'pending-consent',
      session_hash: await sha256(originalSessionToken),
      csrf_hash: await sha256(consentToken),
      request_json: JSON.stringify(auth),
      expires_at: '2099-01-01T00:00:00.000Z',
    }).run();

    const completeAuthorization = vi
      .fn()
      .mockResolvedValue({ redirectTo: 'https://client.test/callback?code=issued' });
    const env = {
      DB: db,
      OWNER_GITHUB_ID: '123',
      APP_ORIGIN: 'https://finance.test',
      OAUTH_PROVIDER: { completeAuthorization },
    } as unknown as AppEnv;
    const request = (csrf = consentToken, origin = env.APP_ORIGIN) =>
      new Request('https://finance.test/authorize/consent', {
        method: 'POST',
        headers: {
          Cookie: `finance_session=${currentSessionToken}`,
          ...(origin ? { Origin: origin } : {}),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          id: 'pending-consent',
          csrf,
          decision: 'allow',
        }),
      });

    await expect(oauthRoute(request('wrong-token'), env)).rejects.toThrow('INVALID_CSRF');
    await expect(oauthRoute(request(consentToken, 'https://evil.test'), env)).rejects.toThrow(
      'INVALID_CSRF',
    );
    expect(completeAuthorization).not.toHaveBeenCalled();

    const opaque = await oauthRoute(request(consentToken, 'null'), env);
    expect(opaque?.status).toBe(303);
    expect(opaque?.headers.get('Location')).toBe('https://client.test/callback?code=issued');
    expect(completeAuthorization).toHaveBeenCalledOnce();
    expect(completeAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '123', request: auth }),
    );

    await expect(oauthRoute(request(), env)).rejects.toThrow('CONSENT_EXPIRED');
  } finally {
    close();
  }
});

it('accepts a consent POST without an Origin header, as OAuth connector clients send it', async () => {
  const { db, close } = database();
  try {
    const sessionToken = 'session-token';
    await insert(db, 'sessions', {
      id_hash: await sha256(sessionToken),
      user_id: '123',
      csrf_token: 'session-csrf',
      expires_at: '2099-01-01T00:00:00.000Z',
    }).run();
    const consentToken = 'consent-specific-token';
    const auth: AuthRequest = {
      responseType: 'code',
      clientId: 'codex',
      redirectUri: 'https://client.test/callback',
      scope: ['finance:summary'],
      state: 'client-state',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
    };
    await insert(db, 'oauth_consents', {
      id: 'pending-consent',
      session_hash: await sha256(sessionToken),
      csrf_hash: await sha256(consentToken),
      request_json: JSON.stringify(auth),
      expires_at: '2099-01-01T00:00:00.000Z',
    }).run();
    const completeAuthorization = vi
      .fn()
      .mockResolvedValue({ redirectTo: 'https://client.test/callback?code=issued' });
    const env = {
      DB: db,
      OWNER_GITHUB_ID: '123',
      APP_ORIGIN: 'https://finance.test',
      OAUTH_PROVIDER: { completeAuthorization },
    } as unknown as AppEnv;

    const response = await oauthRoute(
      new Request('https://finance.test/authorize/consent', {
        method: 'POST',
        headers: {
          Cookie: `finance_session=${sessionToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ id: 'pending-consent', csrf: consentToken, decision: 'allow' }),
      }),
      env,
    );

    expect(response?.status).toBe(303);
    expect(response?.headers.get('Location')).toBe('https://client.test/callback?code=issued');
    expect(completeAuthorization).toHaveBeenCalledOnce();
  } finally {
    close();
  }
});

it('only denies consent on an explicit deny decision', async () => {
  const { db, close } = database();
  try {
    const sessionToken = 'session-token';
    await insert(db, 'sessions', {
      id_hash: await sha256(sessionToken),
      user_id: '123',
      csrf_token: 'session-csrf',
      expires_at: '2099-01-01T00:00:00.000Z',
    }).run();
    const auth: AuthRequest = {
      responseType: 'code',
      clientId: 'codex',
      redirectUri: 'https://client.test/callback',
      scope: ['finance:summary'],
      state: 'client-state',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
    };
    const completeAuthorization = vi
      .fn()
      .mockResolvedValue({ redirectTo: 'https://client.test/callback?code=issued' });
    const env = {
      DB: db,
      OWNER_GITHUB_ID: '123',
      APP_ORIGIN: 'https://finance.test',
      OAUTH_PROVIDER: { completeAuthorization },
    } as unknown as AppEnv;
    const consent = async (id: string, csrf: string, decision?: string) => {
      await insert(db, 'oauth_consents', {
        id,
        session_hash: await sha256(sessionToken),
        csrf_hash: await sha256(csrf),
        request_json: JSON.stringify(auth),
        expires_at: '2099-01-01T00:00:00.000Z',
      }).run();
      return oauthRoute(
        new Request('https://finance.test/authorize/consent', {
          method: 'POST',
          headers: {
            Cookie: `finance_session=${sessionToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            id,
            csrf,
            ...(decision === undefined ? {} : { decision }),
          }),
        }),
        env,
      );
    };

    const denied = await consent('deny-consent', 'deny-token', 'deny');
    expect(denied?.status).toBe(303);
    expect(denied?.headers.get('Location')).toContain('error=access_denied');
    expect(completeAuthorization).not.toHaveBeenCalled();

    // Programmatic submissions omit the submit button value; that is approval.
    const approved = await consent('implicit-consent', 'implicit-token');
    expect(approved?.status).toBe(303);
    expect(approved?.headers.get('Location')).toBe('https://client.test/callback?code=issued');
    expect(completeAuthorization).toHaveBeenCalledOnce();
  } finally {
    close();
  }
});
