import { z } from 'zod';
import type { AppEnv } from '../env';
import { PlaidClient, PlaidError } from '../../../../packages/plaid/client';
import { accessToken, type Item } from '../../../../packages/plaid/sync';
import { encrypt, decrypt } from '../../../../packages/security/crypto';
import { first, all, stmt, insert, auditStatement } from '../../../../packages/db/repository';
import { invariant, readBody } from '../../../../packages/shared/errors';
import type { Session } from '../../../../packages/security/auth';
export async function plaidRoute(
  request: Request,
  env: AppEnv,
  s: Session,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/plaid/')) return null;
  invariant(request.method === 'POST', 405, 'METHOD_NOT_ALLOWED');
  const client = new PlaidClient(env);
  const body = JSON.parse((await readBody(request)) || '{}');
  const createLink = async (token?: string) =>
    client.call<{ link_token: string }>('/link/token/create', {
      user: { client_user_id: env.OWNER_GITHUB_ID },
      client_name: 'Personal Finance',
      country_codes: ['CA'],
      language: 'en',
      ...(token ? { access_token: token } : { products: ['transactions'] }),
      ...(env.APP_ENV === 'local' ? {} : { webhook: env.APP_ORIGIN + '/webhooks/plaid' }),
    });
  if (path === '/api/plaid/link-token') {
    const { link_token } = await createLink();
    return Response.json({ link_token });
  }
  if (path === '/api/plaid/exchange') {
    const { public_token } = z.object({ public_token: z.string().min(1).max(500) }).parse(body);
    const exchanged = await client.call<{ access_token: string; item_id: string }>(
      '/item/public_token/exchange',
      { public_token },
    );
    const previous = await first<Item>(
      env.DB,
      'SELECT * FROM plaid_items WHERE plaid_item_id=?',
      exchanged.item_id,
    );
    invariant(!previous?.disconnected_at, 409, 'ITEM_WAS_DISCONNECTED');
    const id = previous?.id ?? crypto.randomUUID();
    const token = await encrypt(
      exchanged.access_token,
      env.TOKEN_ENCRYPTION_KEY,
      `plaid:${id}:${env.TOKEN_KEY_VERSION}`,
    );
    let name = 'Connected institution';
    await env.DB.batch([
      insert(
        env.DB,
        'plaid_items',
        {
          id,
          plaid_item_id: exchanged.item_id,
          institution_id: null,
          institution_name: name,
          access_token_ciphertext: token.ciphertext,
          access_token_iv: token.iv,
          key_version: env.TOKEN_KEY_VERSION,
          created_at: new Date().toISOString(),
        },
        "ON CONFLICT(plaid_item_id) DO UPDATE SET access_token_ciphertext=excluded.access_token_ciphertext,access_token_iv=excluded.access_token_iv,key_version=excluded.key_version,status='healthy'",
      ),
      auditStatement(env.DB, 'PLAID_ITEM_CONNECTED', 'item', id, s.user_id),
    ]);
    // Persist the encrypted credential before optional metadata calls can fail.
    try {
      const info = await client.call<{ item: { institution_id: string | null } }>('/item/get', {
        access_token: exchanged.access_token,
      });
      if (info.item.institution_id) {
        const result = await client.call<{
          institution: { name: string; logo: string | null; primary_color: string | null };
        }>('/institutions/get_by_id', {
          institution_id: info.item.institution_id,
          country_codes: ['CA'],
          options: { include_optional_metadata: true },
        });
        name = result.institution.name;
        await stmt(
          env.DB,
          'UPDATE plaid_items SET institution_id=?,institution_name=?,logo=?,primary_color=? WHERE id=?',
          info.item.institution_id,
          name,
          result.institution.logo ?? null,
          result.institution.primary_color ?? null,
          id,
        ).run();
      }
    } catch {
      /* Metadata can be recovered without exchanging a new Item. */
    }
    await env.JOBS.send({ type: 'SYNC_ITEM', itemId: id });
    return Response.json({ id, institution: name });
  }
  const match = /^\/api\/plaid\/items\/([^/]+)\/(update-link-token|sync|disconnect|delete)$/.exec(
    path,
  );
  if (!match) return null;
  const item = await first<Item>(env.DB, 'SELECT * FROM plaid_items WHERE id=?', match[1]);
  invariant(item, 404, 'ITEM_NOT_FOUND');
  if (match[2] === 'update-link-token') {
    invariant(!item.disconnected_at, 409, 'ITEM_DISCONNECTED');
    const { link_token } = await createLink(await accessToken(item, env));
    return Response.json({ link_token });
  }
  if (match[2] === 'sync') {
    invariant(!item.disconnected_at, 409, 'ITEM_DISCONNECTED');
    await env.JOBS.send({ type: 'SYNC_ITEM', itemId: item.id });
    return Response.json({ queued: true });
  }
  if (match[2] === 'delete')
    invariant(
      body.confirmation === `DELETE ${item.id}`,
      400,
      'EXPLICIT_DELETE_CONFIRMATION_REQUIRED',
    );
  if (!item.disconnected_at) {
    try {
      await client.call('/item/remove', { access_token: await accessToken(item, env) });
    } catch (error) {
      if (
        !(error instanceof PlaidError) ||
        !['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'].includes(error.code)
      )
        throw error;
    }
    await env.DB.batch([
      stmt(
        env.DB,
        "UPDATE plaid_items SET status='disconnected',disconnected_at=?,access_token_ciphertext=NULL,access_token_iv=NULL,key_version=NULL WHERE id=?",
        new Date().toISOString(),
        item.id,
      ),
      stmt(env.DB, 'UPDATE accounts SET is_active=0 WHERE plaid_item_id=?', item.id),
      auditStatement(env.DB, 'ITEM_DISCONNECTED', 'item', item.id, s.user_id),
    ]);
  }
  if (match[2] === 'delete') {
    await env.DB.batch([
      stmt(env.DB, 'DELETE FROM plaid_items WHERE id=?', item.id),
      stmt(env.DB, 'DELETE FROM report_runs'),
      stmt(env.DB, 'UPDATE system_state SET data_revision=data_revision+1 WHERE id=1'),
      auditStatement(env.DB, 'FINANCIAL_DATA_DELETED', 'item', item.id, s.user_id),
    ]);
    await env.JOBS.send({ type: 'REBUILD_AGGREGATES' });
  }
  return Response.json({ ok: true });
}
