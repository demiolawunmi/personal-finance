import { localPlatform } from './local-platform';
import { PlaidClient } from '../packages/plaid/client';
import { encrypt } from '../packages/security/crypto';
import { insert, first, audit } from '../packages/db/repository';
import { syncItem } from '../packages/plaid/sync';
import { rebuild } from '../packages/db/derive';
const platform = await localPlatform();
try {
  const env = platform.env;
  if (env.PLAID_ENV !== 'sandbox' || env.APP_ENV !== 'local') throw new Error('SANDBOX_ONLY');
  if (await first(env.DB, "SELECT id FROM plaid_items WHERE institution_name='Plaid Sandbox'"))
    throw new Error('SANDBOX_ITEM_ALREADY_EXISTS: use pnpm backfill');
  const client = new PlaidClient(env);
  const { public_token } = await client.call<{ public_token: string }>(
    '/sandbox/public_token/create',
    { institution_id: 'ins_109508', initial_products: ['transactions'] },
  );
  const exchanged = await client.call<{ access_token: string; item_id: string }>(
    '/item/public_token/exchange',
    { public_token },
  );
  const id = crypto.randomUUID();
  const encrypted = await encrypt(
    exchanged.access_token,
    env.TOKEN_ENCRYPTION_KEY,
    `plaid:${id}:${env.TOKEN_KEY_VERSION}`,
  );
  await insert(env.DB, 'plaid_items', {
    id,
    plaid_item_id: exchanged.item_id,
    institution_name: 'Plaid Sandbox',
    access_token_ciphertext: encrypted.ciphertext,
    access_token_iv: encrypted.iv,
    key_version: env.TOKEN_KEY_VERSION,
    created_at: new Date().toISOString(),
  }).run();
  await syncItem(env.DB, client, env, id);
  await rebuild(env.DB, env.TIMEZONE);
  await audit(env.DB, 'SANDBOX_SEEDED', 'item', id);
  console.log(
    'Sandbox item created and synchronized. Run backfill again if Plaid is still preparing historical data.',
  );
} finally {
  await platform.dispose();
}
