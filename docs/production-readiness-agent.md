# Production readiness handoff

Copy the following instructions to the implementation agent.

## Mission

Prepare `/Users/demiladeolawunmi/Documents/ChatGPT/Personal Finance` for a secure production deployment of the Personal Finance Worker. The target is real Canadian financial institutions through Plaid, GitHub owner-only login, Cloudflare Workers, D1, KV, and Queues. Do not deploy, connect a real bank, or create remote resources unless the user explicitly authorizes that action and supplies the required account access.

## First read

Read these files before changing code or infrastructure:

- `README.md`
- `docs/runbook.md`
- `docs/security.md`
- `docs/acceptance.md`
- `apps/finance-worker/wrangler.jsonc`
- `apps/finance-worker/src/index.ts`
- `apps/finance-worker/src/routes/oauth.ts`
- `apps/finance-worker/src/routes/plaid.ts`
- `packages/plaid/client.ts`

Load the Cloudflare Wrangler and Workers best-practices skills before using Wrangler or changing Worker configuration.

## Configuration work

Audit `apps/finance-worker/wrangler.jsonc` and remove every production placeholder without inventing values. The Production block must contain:

- the final HTTPS `APP_ORIGIN`, with no trailing slash;
- `APP_ENV: "production"`;
- `PLAID_ENV: "production"`;
- the real Production D1 database ID;
- the real Production KV namespace ID;
- separate Production queue and dead-letter queue names.

Keep local and Sandbox resources separate from Production. The Worker intentionally rejects `PLAID_ENV=production` when `APP_ENV` is not `production`.

Never write secrets into source files, `wrangler.jsonc`, logs, frontend bundles, or commit history. Set them with Wrangler secrets for the Production environment:

```sh
pnpm exec wrangler secret put GITHUB_CLIENT_ID --env production -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET --env production -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put OWNER_GITHUB_ID --env production -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put PLAID_CLIENT_ID --env production -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put PLAID_SECRET --env production -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put TOKEN_ENCRYPTION_KEY --env production -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put COOKIE_ENCRYPTION_KEY --env production -c apps/finance-worker/wrangler.jsonc
```

Use Plaid Production or Trial credentials, never Sandbox credentials. Generate independent 32-byte base64 values for the two encryption keys. Keep `OWNER_GITHUB_ID` as the numeric immutable GitHub user ID. Create a separate GitHub OAuth App for Production with callback URL `<APP_ORIGIN>/callback`.

## Plaid and real institutions

Verify in the Plaid Dashboard that:

1. Production or Trial access is enabled.
2. The application and company profiles are complete.
3. The Transactions product is enabled for Canada.
4. The target institutions support Transactions in Production.
5. The Link customization/use-case requirements are complete.

The current integration requests `country_codes: ['CA']` and `products: ['transactions']`. If the user requires another country or product, update the code and tests deliberately; do not silently broaden access.

Confirm that `packages/plaid/client.ts` keeps the Worker `fetch` binding intact. The default fetcher must use `globalThis.fetch.bind(globalThis)` or an equivalent bound function; an unbound Worker fetch produces an `Illegal invocation` error.

## Database and infrastructure

Before deploying code that depends on schema changes:

```sh
pnpm exec wrangler d1 migrations apply finance-production --remote --env production -c apps/finance-worker/wrangler.jsonc
```

Verify the Production D1, KV, queue, and dead-letter queue bindings are real and belong to the Production environment. Do not reuse local or Sandbox bindings. Verify the queue consumer has retry and dead-letter behavior and that scheduled jobs use the Production queue.

## Security review

Check that:

- only the configured GitHub owner can create a session;
- OAuth uses the Production callback and PKCE/CSRF protections remain active;
- Plaid access tokens are encrypted before D1 persistence;
- encryption keys never appear in responses, logs, or frontend code;
- bank credentials are entered only inside Plaid Link;
- disconnect and permanent deletion retain their existing confirmation/audit behavior;
- production responses keep `Cache-Control: no-store`, security headers, and the existing CSP;
- setup diagnostics report readiness without returning secret values;
- no demo or authentication bypass is reachable in Production.

## Validation

Run from the repository root:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec wrangler deploy --dry-run --env production -c apps/finance-worker/wrangler.jsonc
```

If a live Plaid test is authorized, test only the Production/Trial environment intended by the user and do not print access tokens. Verify:

1. `/health` reports a healthy database.
2. GitHub owner login succeeds and a second GitHub user is rejected.
3. Plaid Link lists the intended Canadian institution.
4. The institution can complete Link and appears in Connections.
5. A first sync is queued and eventually imports accounts and transactions.
6. D1 contains ciphertext and IV fields, never a plaintext access token.
7. Data Health reports the expected sync state and history coverage.
8. Disconnect, reconnect, and explicit permanent deletion behave as documented.

## Deliverable

Return a production-readiness report containing:

- files changed;
- configuration values still missing, without printing secrets;
- Cloudflare resources still missing;
- Plaid access or institution-coverage blockers;
- validation commands and results;
- the exact deploy command to run after the user approves deployment.

If required IDs, credentials, or approvals are missing, leave the code and configuration in the safest validated state and report the blocker. Do not guess IDs, generate fake production bindings, commit secrets, or deploy partially configured infrastructure.
