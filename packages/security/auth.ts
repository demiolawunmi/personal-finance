import type { Database } from '../db/repository';
import { first, stmt } from '../db/repository';
import { sha256, equal } from './crypto';
import { invariant } from '../shared/errors';
export type Session = { id_hash: string; user_id: string; csrf_token: string; expires_at: string };
// Deliberately narrow: security does not depend on the app's generated Env.
export type AuthEnv = { DB: Database; OWNER_GITHUB_ID: string; APP_ORIGIN: string };
export function cookie(request: Request, name: string) {
  return (
    request.headers
      .get('Cookie')
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + '='))
      ?.slice(name.length + 1) ?? null
  );
}
export function setCookie(name: string, value: string, env: AuthEnv, maxAge = 43200) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.APP_ORIGIN.startsWith('https:') ? '; Secure' : ''}`;
}
export async function session(request: Request, env: AuthEnv): Promise<Session | null> {
  const token = cookie(request, 'finance_session');
  if (!token) return null;
  const row = await first<Session>(
    env.DB,
    'SELECT id_hash,user_id,csrf_token,expires_at FROM sessions WHERE id_hash=? AND expires_at>?',
    await sha256(token),
    new Date().toISOString(),
  );
  return row && row.user_id === env.OWNER_GITHUB_ID ? row : null;
}
export async function requireSession(request: Request, env: AuthEnv) {
  const s = await session(request, env);
  invariant(s, 401, 'AUTHENTICATION_REQUIRED');
  return s;
}
export function requireCsrf(
  request: Request,
  env: AuthEnv,
  s: Session,
  token = request.headers.get('X-CSRF-Token'),
) {
  invariant(
    request.headers.get('Origin') === env.APP_ORIGIN && token && equal(token, s.csrf_token),
    403,
    'INVALID_CSRF',
  );
}
