import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { ZodError } from 'zod';
import type { AppEnv } from './env';
import { oauthRoute } from './routes/oauth';
import { dashboardApi } from './routes/dashboard-api';
import { mcpFetch } from './mcp/server';
import { SCOPES } from './mcp/scopes';
import { consume } from './queue/consumer';
import { scheduled } from './cron/scheduled';
import { HttpError, readBody } from '../../../packages/shared/errors';
import { verifyWebhook } from '../../../packages/plaid/webhooks';
import { PlaidClient, PlaidError } from '../../../packages/plaid/client';
import { first, stmt, revision } from '../../../packages/db/repository';
const PRIVATE_PATHS = ['/login', '/callback', '/token', '/register', '/health'];
function cacheControlFor(pathname: string, method: string): string {
  if (method !== 'GET' && method !== 'HEAD') return 'private, no-store';
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname === '/favicon.svg') return 'public, max-age=604800';
  if (pathname.startsWith('/api/')) return 'private, no-store';
  if (
    pathname.startsWith('/mcp') ||
    pathname.startsWith('/webhooks/') ||
    pathname.startsWith('/authorize') ||
    PRIVATE_PATHS.includes(pathname)
  )
    return 'private, no-store';
  // Static SPA shell: stored but revalidated so a rebuild is picked up (304 otherwise).
  return 'public, max-age=0, must-revalidate';
}
async function routes(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/health') {
    try {
      await env.DB.prepare('SELECT 1').first();
      return Response.json({
        status: 'healthy',
        database: 'healthy',
        queue: 'configured',
        version: '0.1.0',
      });
    } catch {
      return Response.json(
        { status: 'error', database: 'unavailable', version: '0.1.0' },
        { status: 503 },
      );
    }
  }
  if (url.pathname === '/webhooks/plaid' && request.method === 'POST') {
    const raw = await readBody(request);
    const payload = await verifyWebhook(
      raw,
      request.headers.get('Plaid-Verification'),
      new PlaidClient(env),
    );
    if (payload.item_id) {
      const item = await first<{ id: string }>(
        env.DB,
        'SELECT id FROM plaid_items WHERE plaid_item_id=? AND disconnected_at IS NULL',
        payload.item_id,
      );
      if (item) {
        await stmt(
          env.DB,
          'UPDATE plaid_items SET last_webhook_at=? WHERE id=?',
          new Date().toISOString(),
          item.id,
        ).run();
        if (payload.error?.error_code === 'ITEM_LOGIN_REQUIRED')
          await stmt(
            env.DB,
            "UPDATE plaid_items SET status='reauth_required' WHERE id=?",
            item.id,
          ).run();
        await env.JOBS.send({ type: 'SYNC_ITEM', itemId: item.id });
      }
    }
    return Response.json({ received: true });
  }
  const auth = await oauthRoute(request, env);
  if (auth) return auth;
  if (url.pathname.startsWith('/api/')) {
    // Mutations skip the revision fence; only reads need it (and the second
    // read only happens for reads).
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return dashboardApi(request, env);
    const before = await revision(env.DB);
    const response = await dashboardApi(request, env);
    if ((await revision(env.DB)).data_revision !== before.data_revision)
      throw new HttpError(409, 'DATA_CHANGED_RETRY');
    return response;
  }
  if (request.method === 'GET' && !url.pathname.startsWith('/mcp')) {
    const path = /\.[a-z0-9]+$/.test(url.pathname) ? url.pathname : '/';
    return env.ASSETS.fetch(new Request(new URL(path, env.APP_ORIGIN), request));
  }
  return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
}
export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    let response: Response;
    try {
      if (env.APP_ENV !== 'production' && env.PLAID_ENV !== 'sandbox')
        throw new HttpError(503, 'ENVIRONMENT_MISMATCH');
      if (request.body) {
        const raw = await readBody(request, 131072);
        request = new Request(request, { body: raw });
      }
      const provider = new OAuthProvider<AppEnv>({
        apiRoute: '/mcp',
        apiHandler: { fetch: mcpFetch },
        defaultHandler: { fetch: routes },
        authorizeEndpoint: '/authorize',
        tokenEndpoint: '/token',
        clientRegistrationEndpoint: '/register',
        scopesSupported: SCOPES,
        allowImplicitFlow: false,
        allowPlainPKCE: false,
        accessTokenTTL: 3600,
        refreshTokenTTL: 2592000,
        resourceMetadata: {
          resource: env.APP_ORIGIN + '/mcp',
          ...(env.APP_ENV === 'local' ? {} : { authorization_servers: [env.APP_ORIGIN] }),
          scopes_supported: SCOPES,
          resource_name: 'Private Personal Finance',
        },
      });
      response = await provider.fetch(request, env, ctx);
    } catch (error) {
      const plaidCode = error instanceof PlaidError ? error.code : undefined;
      const internalCode =
        error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
          ? error.message
          : undefined;
      const status =
        error instanceof HttpError
          ? error.status
          : plaidCode
            ? plaidCode === 'PLAID_NOT_CONFIGURED'
              ? 503
              : 502
            : error instanceof ZodError || error instanceof SyntaxError
              ? 400
              : 503;
      const code =
        error instanceof HttpError
          ? error.code
          : (plaidCode ?? internalCode)
            ? (plaidCode ?? internalCode)!
            : status === 400
              ? 'INVALID_REQUEST'
              : 'SERVICE_UNAVAILABLE';
      console.error(
        JSON.stringify({
          event: 'REQUEST_FAILED',
          status,
          code,
          ...(env.APP_ENV === 'local' && error instanceof Error ? { detail: error.message } : {}),
        }),
      );
      response = Response.json({ error: code }, { status });
    }
    const secured = new Response(response.body, response);
    const reqUrl = new URL(request.url);
    // Immutable hashed assets and the SPA shell may be cached by the browser;
    // everything dynamic stays private. Endpoints that set their own
    // Cache-Control (e.g. institution logos) are left untouched.
    if (!/^\/api\/institutions\/[^/]+\/logo$/.test(reqUrl.pathname)) {
      secured.headers.set('Cache-Control', cacheControlFor(reqUrl.pathname, request.method));
    }
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    secured.headers.set('Referrer-Policy', 'no-referrer');
    secured.headers.set('X-Frame-Options', 'DENY');
    secured.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://cdn.plaid.com; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return secured;
  },
  queue: consume,
  scheduled,
} satisfies ExportedHandler<AppEnv>;
