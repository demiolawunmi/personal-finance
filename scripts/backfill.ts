import { localPlatform } from './local-platform';
import { all } from '../packages/db/repository';
import { syncItem } from '../packages/plaid/sync';
import { PlaidClient } from '../packages/plaid/client';
import { rebuild } from '../packages/db/derive';
const platform = await localPlatform();
try {
  for (const { id } of await all<{ id: string }>(
    platform.env.DB,
    'SELECT id FROM plaid_items WHERE disconnected_at IS NULL',
  ))
    await syncItem(platform.env.DB, new PlaidClient(platform.env), platform.env, id);
  await rebuild(platform.env.DB, platform.env.TIMEZONE);
  console.log('Local sync and aggregate rebuild complete.');
} finally {
  await platform.dispose();
}
