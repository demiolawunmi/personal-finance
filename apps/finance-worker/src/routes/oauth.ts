import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { AppEnv } from '../env';
import { first, stmt, insert, audit } from '../../../../packages/db/repository';
import { randomToken, sha256, encrypt, decrypt, equal } from '../../../../packages/security/crypto';
import {
  cookie,
  setCookie,
  session,
  requireSession,
  requireCsrf,
  type Session,
} from '../../../../packages/security/auth';
import { invariant, readBody } from '../../../../packages/shared/errors';
import { SCOPES } from '../mcp/scopes';
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
async function consent(env: AppEnv, s: Session, request: AuthRequest) {
  invariant(
    request.codeChallengeMethod === 'S256' && request.codeChallenge,
    400,
    'PKCE_S256_REQUIRED',
  );
  const scopes = request.scope.length ? request.scope : ['finance:summary'];
  invariant(
    scopes.every((v) => SCOPES.includes(v)),
    400,
    'INVALID_SCOPE',
  );
  request.scope = scopes;
  const client = await env.OAUTH_PROVIDER.lookupClient(request.clientId);
  invariant(client, 400, 'UNKNOWN_CLIENT');
  const id = randomToken();
  await insert(env.DB, 'oauth_consents', {
    id,
    session_hash: s.id_hash,
    request_json: JSON.stringify(request),
    expires_at: new Date(Date.now() + 600000).toISOString(),
  }).run();
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authorize finance access</title><body><main><h1>Allow ${escape(client.clientName ?? client.clientId)} to read your finances?</h1><p>Client: ${escape(client.clientId)}</p><p>Redirect: ${escape(request.redirectUri)}</p><ul>${scopes.map((s) => `<li>${escape(s)}</li>`).join('')}</ul><p>This grants access to private financial data. It cannot move money.</p><form action="/authorize/consent" method="post"><input type="hidden" name="id" value="${id}"><input type="hidden" name="csrf" value="${s.csrf_token}"><button name="decision" value="allow">Allow access</button><button name="decision" value="deny">Deny</button></form></main></body></html>`,
    { headers: { 'Content-Type': 'text/html;charset=utf-8' } },
  );
}
async function login(request: Request, env: AppEnv, auth: AuthRequest | null) {
  const missing = [
    !env.GITHUB_CLIENT_ID && 'GITHUB_CLIENT_ID',
    !env.GITHUB_CLIENT_SECRET && 'GITHUB_CLIENT_SECRET',
    !env.OWNER_GITHUB_ID && 'OWNER_GITHUB_ID',
    !env.COOKIE_ENCRYPTION_KEY && 'COOKIE_ENCRYPTION_KEY',
  ].filter(Boolean) as string[];
  if (missing.length && env.APP_ENV === 'local')
    return new Response(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GitHub sign-in setup</title><style>body{font:16px system-ui,sans-serif;line-height:1.5;max-width:720px;margin:48px auto;padding:0 24px;color:#26372d}code{background:#eef2ec;padding:2px 5px;border-radius:3px}li{margin:10px 0}.hint{color:#627167}</style><h1>GitHub sign-in is not configured</h1><p>The local Worker is running, but these values are blank in <code>apps/finance-worker/.dev.vars</code>:</p><ul>${missing.map((name) => `<li><code>${name}</code></li>`).join('')}</ul><ol><li>Create a GitHub OAuth App at <a href="https://github.com/settings/developers">GitHub Developer Settings</a>.</li><li>Set its callback URL to <code>${env.APP_ORIGIN}/callback</code>.</li><li>Copy the client ID and secret into <code>apps/finance-worker/.dev.vars</code>.</li><li>Set <code>OWNER_GITHUB_ID</code> to your numeric GitHub account ID.</li><li>Generate <code>COOKIE_ENCRYPTION_KEY</code> with <code>openssl rand -base64 32</code>, then restart <code>pnpm dev</code>.</li></ol><p class="hint">The setup portal opens after GitHub authentication; it cannot create the OAuth App or its credentials before the first sign-in.</p></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
    );
  invariant(!missing.length, 503, 'GITHUB_NOT_CONFIGURED');
  const state = randomToken(),
    browser = randomToken();
  const encrypted = await encrypt(
    JSON.stringify(auth),
    env.COOKIE_ENCRYPTION_KEY,
    'oauth-state:' + state,
  );
  await insert(env.DB, 'oauth_states', {
    id: state,
    browser_hash: await sha256(browser),
    request_json: JSON.stringify(encrypted),
    expires_at: new Date(Date.now() + 600000).toISOString(),
  }).run();
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: env.APP_ORIGIN + '/callback',
    state,
    scope: 'read:user',
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': setCookie('finance_oauth', browser, env, 600),
    },
  });
}
export async function oauthRoute(request: Request, env: AppEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/login' && request.method === 'GET') return login(request, env, null);
  if (url.pathname === '/authorize' && request.method === 'GET') {
    const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const s = await session(request, env);
    return s ? consent(env, s, auth) : login(request, env, auth);
  }
  if (url.pathname === '/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state'),
      code = url.searchParams.get('code'),
      browser = cookie(request, 'finance_oauth');
    invariant(state && code && browser, 400, 'INVALID_OAUTH_CALLBACK');
    // One-use state is deleted atomically before the upstream exchange.
    const row = await stmt(
      env.DB,
      'DELETE FROM oauth_states WHERE id=? AND expires_at>? AND browser_hash=? RETURNING request_json',
      state,
      new Date().toISOString(),
      await sha256(browser),
    ).first<{ request_json: string }>();
    invariant(row, 400, 'INVALID_OAUTH_STATE');
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: env.APP_ORIGIN + '/callback',
      }),
      signal: AbortSignal.timeout(15000),
    });
    invariant(tokenResponse.ok, 502, 'GITHUB_UNAVAILABLE');
    const token = (await tokenResponse.json()) as { access_token?: string };
    invariant(token.access_token, 401, 'GITHUB_LOGIN_FAILED');
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'User-Agent': 'personal-finance',
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15000),
    });
    invariant(userResponse.ok, 502, 'GITHUB_UNAVAILABLE');
    const user = (await userResponse.json()) as { id: number };
    invariant(String(user.id) === env.OWNER_GITHUB_ID, 403, 'OWNER_ONLY');
    const sessionToken = randomToken(),
      s: Session = {
        id_hash: await sha256(sessionToken),
        user_id: String(user.id),
        csrf_token: randomToken(),
        expires_at: new Date(Date.now() + 43200000).toISOString(),
      };
    await insert(env.DB, 'sessions', s).run();
    const encrypted = JSON.parse(row.request_json);
    const auth = JSON.parse(
      await decrypt(
        encrypted.ciphertext,
        encrypted.iv,
        env.COOKIE_ENCRYPTION_KEY,
        'oauth-state:' + state,
      ),
    ) as AuthRequest | null;
    const response = auth
      ? await consent(env, s, auth)
      : new Response(null, { status: 302, headers: { Location: env.APP_ORIGIN + '/' } });
    response.headers.append('Set-Cookie', setCookie('finance_session', sessionToken, env));
    response.headers.append('Set-Cookie', setCookie('finance_oauth', '', env, 0));
    await audit(env.DB, 'OWNER_LOGIN', 'session', null, s.user_id);
    return response;
  }
  if (url.pathname === '/authorize/consent' && request.method === 'POST') {
    const s = await requireSession(request, env);
    const form = new URLSearchParams(await readBody(request));
    requireCsrf(request, env, s, form.get('csrf'));
    const row = await stmt(
      env.DB,
      'DELETE FROM oauth_consents WHERE id=? AND session_hash=? AND expires_at>? RETURNING request_json',
      form.get('id'),
      s.id_hash,
      new Date().toISOString(),
    ).first<{ request_json: string }>();
    invariant(row, 400, 'CONSENT_EXPIRED');
    const auth = JSON.parse(row.request_json) as AuthRequest;
    if (form.get('decision') !== 'allow') {
      const redirect = new URL(auth.redirectUri);
      redirect.searchParams.set('error', 'access_denied');
      redirect.searchParams.set('state', auth.state);
      return Response.redirect(redirect.toString(), 302);
    }
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: auth,
      userId: s.user_id,
      scope: auth.scope,
      metadata: { clientId: auth.clientId },
      props: { userId: s.user_id, scopes: auth.scope, clientId: auth.clientId },
    });
    await audit(env.DB, 'MCP_ACCESS_GRANTED', 'oauth_client', auth.clientId, s.user_id, {
      scopes: auth.scope,
    });
    return Response.redirect(redirectTo, 302);
  }
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    const s = await requireSession(request, env);
    requireCsrf(request, env, s);
    await stmt(env.DB, 'DELETE FROM sessions WHERE id_hash=?', s.id_hash).run();
    return Response.json(
      { ok: true },
      { headers: { 'Set-Cookie': setCookie('finance_session', '', env, 0) } },
    );
  }
  return null;
}
