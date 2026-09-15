# Connect your own Plaid banking data

This project ships with no credentials and no personal data. You supply your own Plaid
application, GitHub OAuth app, Cloudflare resources and generated encryption keys. Bank
access is read-only: Plaid Link connects, transactions are imported, and no money can move.

There are two ways to start:

- **Local** against the Plaid **Sandbox** (free, synthetic data) — best for a first run.
- **Deployed** to your own Cloudflare account, then optionally switched to Plaid
  **Production** for real accounts.

Plaid's free plan includes Sandbox plus a limited Production/Trial allowance. You only need
the `transactions` product and the `client_id` / `secret` pair from the dashboard.

## What you need

- Node 24+ and pnpm 11.19.0.
- A Cloudflare account (`wrangler` deploys Workers, D1, KV and Queues).
- A GitHub account for the single-owner login gate.
- A Plaid account — sign up free at <https://dashboard.plaid.com/signup>.

## 1. Get Plaid credentials

1. Sign up at <https://dashboard.plaid.com/signup> and open your team.
2. Open **Developers → Keys** (or **Team Settings → Keys**).
3. Copy the `client_id` and the **Sandbox** `secret`. The Sandbox secret and the Production
   secret are different values; never use the Production secret locally.

This build requests the `transactions` product and hard-codes `country_codes: ['CA']` in
`apps/finance-worker/src/routes/plaid.ts` (Link token, institution lookup) and
`packages/plaid/sync.ts` (institution metadata). **If you are not in Canada, change those
`['CA']` values** to your country (`['US']`, `['GB']`, …) before connecting anything.

## 2. Create the GitHub OAuth app (owner gate)

Only the account whose **numeric, immutable GitHub user ID** you configure can sign in.

1. Open <https://github.com/settings/developers> → **New OAuth App**.
2. Homepage URL: your Worker origin (local: `http://localhost:8787`).
3. Authorization callback URL: that same origin plus `/callback`
   (local: `http://localhost:8787/callback`).
4. Copy the Client ID and Client Secret.
5. Find your numeric ID at <https://api.github.com/users/YOUR_USERNAME> — use the `id`
   field, not your login name. Run:

   ```sh
   curl -s https://api.github.com/users/YOUR_USERNAME | grep '"id"'
   ```

Use a **separate OAuth app** for local and for each deployed environment.

## 3. Run locally against Plaid Sandbox

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
cp apps/finance-worker/.dev.vars.example apps/finance-worker/.dev.vars
```

Fill `apps/finance-worker/.dev.vars` (never commit this file):

| Variable                | Value                                           |
| ----------------------- | ----------------------------------------------- |
| `GITHUB_CLIENT_ID`      | From your local OAuth app                       |
| `GITHUB_CLIENT_SECRET`  | From your local OAuth app                       |
| `OWNER_GITHUB_ID`       | Your numeric GitHub ID                          |
| `PLAID_CLIENT_ID`       | From the Plaid dashboard                        |
| `PLAID_SECRET`          | The **Sandbox** secret                          |
| `TOKEN_ENCRYPTION_KEY`  | `openssl rand -base64 32`                       |
| `COOKIE_ENCRYPTION_KEY` | A second, independent `openssl rand -base64 32` |

Then start the Worker:

```sh
pnpm dev
```

Open <http://localhost:8787>, sign in with GitHub, and follow `/setup`. The setup portal
checks each piece (GitHub, encryption, Plaid, D1 schema, queue, first connection) without
ever printing a secret value.

Want to preview the dashboard with no credentials at all? Run `pnpm demo` and open
<http://localhost:4173> — synthetic data, bank connections disabled.

## 4. Connect an institution

**Option A — Sandbox seed (fastest):** creates one real Sandbox Item and syncs it.

```sh
pnpm db:seed
```

Run `pnpm backfill` again if Plaid is still preparing historical data. Repeated runs refuse
to create duplicates.

**Option B — Plaid Link:** on the Connections screen click **Connect**, sign in with the
Sandbox credentials shown in the Plaid dashboard, and select an institution.

There is no way for Plaid to call a local webhook, so use the Connections screen **Sync**
button or `pnpm backfill` to pull updates locally.

To exercise the provider end to end from the shell, with Sandbox credentials exported:

```sh
RUN_PLAID_SANDBOX=1 pnpm test:plaid
```

This creates and removes a single Sandbox Item and never prints the access token.

## 5. Deploy your own Worker

Decide your Worker origin first: `https://<worker-name>-sandbox.<your-subdomain>.workers.dev`.
Your subdomain is shown in the Cloudflare dashboard. Keep it exact, with no trailing slash.

1. Log in and create the resources for the `sandbox` environment:

   ```sh
   pnpm exec wrangler login
   pnpm exec wrangler d1 create finance-sandbox
   pnpm exec wrangler kv namespace create OAUTH_KV --env sandbox -c apps/finance-worker/wrangler.jsonc
   pnpm exec wrangler queues create finance-sandbox
   pnpm exec wrangler queues create finance-sandbox-dlq
   ```

2. Put the returned IDs into the `sandbox` block of
   `apps/finance-worker/wrangler.jsonc`, and set `APP_ORIGIN` to your Worker origin. The
   committed `REPLACE_*` values are placeholders; do not commit your own IDs if you plan to
   share the repository.

3. Set the Worker secrets:

   ```sh
   pnpm exec wrangler secret put GITHUB_CLIENT_ID --env sandbox -c apps/finance-worker/wrangler.jsonc
   pnpm exec wrangler secret put GITHUB_CLIENT_SECRET --env sandbox -c apps/finance-worker/wrangler.jsonc
   pnpm exec wrangler secret put OWNER_GITHUB_ID --env sandbox -c apps/finance-worker/wrangler.jsonc
   pnpm exec wrangler secret put PLAID_CLIENT_ID --env sandbox -c apps/finance-worker/wrangler.jsonc
   pnpm exec wrangler secret put PLAID_SECRET --env sandbox -c apps/finance-worker/wrangler.jsonc
   pnpm exec wrangler secret put TOKEN_ENCRYPTION_KEY --env sandbox -c apps/finance-worker/wrangler.jsonc
   pnpm exec wrangler secret put COOKIE_ENCRYPTION_KEY --env sandbox -c apps/finance-worker/wrangler.jsonc
   ```

4. Update the GitHub OAuth app callback to `https://<your-origin>/callback`.

5. Validate, migrate, then deploy (migrations are additive and run before the code):

   ```sh
   pnpm check
   pnpm exec wrangler d1 migrations apply finance-sandbox --remote --env sandbox -c apps/finance-worker/wrangler.jsonc
   pnpm exec wrangler deploy --env sandbox -c apps/finance-worker/wrangler.jsonc
   ```

6. Open `https://<your-origin>/setup`, sign in, and connect an institution. Deployed
   Sandbox Workers can receive Plaid webhooks at `/webhooks/plaid`.

The full operations detail — cron, reconciliation, backups, key rotation, rollback — is in
[the runbook](runbook.md).

## 6. Switch to Production (real bank data)

1. Apply for **Production** access in the Plaid dashboard and copy the Production
   `secret`. Never use it locally.
2. Duplicate the `sandbox` resources for the `production` environment (a **separate** D1
   database, KV namespace, queue and dead-letter queue) and fill the `production` block of
   `wrangler.jsonc`.
3. Set `PLAID_ENV` to `production` (already the default in that block) and deploy with
   `--env production`.
4. Set the same secrets for `--env production`, using the Production Plaid secret and
   **fresh** encryption keys. A database restored without its matching keys cannot decrypt
   stored Plaid tokens.
5. Complete the live acceptance checklist in [the runbook](runbook.md#live-acceptance).
   Canadian institution coverage and cost have not been verified for your accounts.

## Troubleshooting

| Symptom                           | Fix                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PLAID_NOT_CONFIGURED`            | `PLAID_CLIENT_ID` / `PLAID_SECRET` are blank in this environment.                               |
| `INVALID_API_KEYS`                | You mixed Sandbox and Production credentials. Match the secret to `PLAID_ENV`.                  |
| `PRODUCT_NOT_READY`               | Enable the `transactions` product for this Plaid application.                                   |
| `INSTITUTION_NOT_SUPPORTED`       | The institution is not offered for the configured `country_codes` or environment.               |
| `INVALID_ENCRYPTION_KEY`          | `TOKEN_ENCRYPTION_KEY` is not 32 random bytes encoded as base64. Regenerate.                    |
| Setup shows the same action twice | Confirm `APP_ORIGIN` matches the real origin and re-run `pnpm db:migrate` for that environment. |

Errors never include secret values. Plaid access tokens are stored encrypted in D1
(ciphertext, IV and key version only); see [security](security.md).
