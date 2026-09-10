import { it, expect } from 'vitest';
import { PlaidClient, syncSchema } from '../../packages/plaid/client';
const enabled = process.env.RUN_PLAID_SANDBOX === '1';
it.skipIf(!enabled)(
  'creates a sandbox item, exchanges a token and calls transactions/sync',
  async () => {
    const client = new PlaidClient({
      PLAID_ENV: 'sandbox',
      PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID ?? '',
      PLAID_SECRET: process.env.PLAID_SECRET ?? '',
    });
    const publicToken = await client.call<{ public_token: string }>(
      '/sandbox/public_token/create',
      { institution_id: 'ins_109508', initial_products: ['transactions'] },
    );
    const item = await client.call<{ access_token: string }>('/item/public_token/exchange', {
      public_token: publicToken.public_token,
    });
    try {
      const page = await client.call(
        '/transactions/sync',
        { access_token: item.access_token, cursor: '' },
        syncSchema,
      );
      expect(typeof page.next_cursor).toBe('string');
    } finally {
      await client.call('/item/remove', { access_token: item.access_token });
    }
  },
  60000,
);
