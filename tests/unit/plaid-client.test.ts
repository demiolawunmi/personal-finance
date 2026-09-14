import { afterEach, expect, it, vi } from 'vitest';
import { PlaidClient } from '../../packages/plaid/client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

it('binds the Worker fetch function before calling Plaid', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ link_token: 'link-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  const client = new PlaidClient({
    PLAID_ENV: 'sandbox',
    PLAID_CLIENT_ID: 'client-id',
    PLAID_SECRET: 'secret',
  });

  await expect(client.call('/link/token/create', {})).resolves.toEqual({
    link_token: 'link-token',
  });
  expect(fetch).toHaveBeenCalledOnce();
});
