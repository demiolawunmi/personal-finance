import { z } from 'zod';
export type PlaidConfig = { PLAID_ENV: string; PLAID_CLIENT_ID: string; PLAID_SECRET: string };
export class PlaidError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export class PlaidClient {
  constructor(
    private env: PlaidConfig,
    // Cloudflare's fetch implementation requires its global this reference.
    private fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  async call<T>(path: string, body: Record<string, unknown>, schema?: z.ZodType<T>): Promise<T> {
    if (!['sandbox', 'production'].includes(this.env.PLAID_ENV))
      throw new Error('INVALID_PLAID_ENV');
    if (!this.env.PLAID_CLIENT_ID || !this.env.PLAID_SECRET)
      throw new PlaidError('PLAID_NOT_CONFIGURED');
    const response = await this.fetcher(`https://${this.env.PLAID_ENV}.plaid.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Plaid-Version': '2020-09-14' },
      body: JSON.stringify({
        ...body,
        client_id: this.env.PLAID_CLIENT_ID,
        secret: this.env.PLAID_SECRET,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const error = (await response.json()) as { error_code?: string };
      throw new PlaidError(
        error.error_code && /^[A-Z_]+$/.test(error.error_code)
          ? error.error_code
          : 'PLAID_UNAVAILABLE',
      );
    }
    const result = await response.json();
    return schema ? schema.parse(result) : (result as T);
  }
}
const amount = z.number().finite().nullable();
export const accountSchema = z.object({
  account_id: z.string(),
  name: z.string(),
  official_name: z.string().nullable().optional(),
  mask: z.string().nullable().optional(),
  type: z.string(),
  subtype: z.string().nullable().optional(),
  balances: z.object({
    current: amount,
    available: amount,
    limit: amount.optional(),
    iso_currency_code: z.string().nullable(),
    unofficial_currency_code: z.string().nullable().optional(),
    last_updated_datetime: z.string().nullable().optional(),
  }),
});
export const transactionSchema = z.object({
  transaction_id: z.string(),
  account_id: z.string(),
  amount: z.number().finite(),
  iso_currency_code: z.string().nullable(),
  unofficial_currency_code: z.string().nullable().optional(),
  date: z.string(),
  authorized_date: z.string().nullable().optional(),
  datetime: z.string().nullable().optional(),
  authorized_datetime: z.string().nullable().optional(),
  name: z.string(),
  merchant_name: z.string().nullable().optional(),
  original_description: z.string().nullable().optional(),
  personal_finance_category: z
    .object({ primary: z.string(), detailed: z.string() })
    .nullable()
    .optional(),
  pending: z.boolean(),
  pending_transaction_id: z.string().nullable().optional(),
  payment_channel: z.string().optional(),
});
export const syncSchema = z.object({
  accounts: z.array(accountSchema),
  added: z.array(transactionSchema),
  modified: z.array(transactionSchema),
  removed: z.array(z.object({ transaction_id: z.string() })),
  next_cursor: z.string(),
  has_more: z.boolean(),
  transactions_update_status: z.string().optional(),
});
export type PlaidTransaction = z.infer<typeof transactionSchema>;
export type PlaidAccount = z.infer<typeof accountSchema>;
export type SyncPage = z.infer<typeof syncSchema>;
