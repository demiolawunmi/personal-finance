# Operations runbook

## Provision Sandbox first

No remote resources have been created. In your Cloudflare account create a **separate** D1 database, KV namespace for OAuth, work queue and dead-letter queue for each environment. Example commands from the repository root:

```sh
pnpm exec wrangler d1 create finance-sandbox
pnpm exec wrangler kv namespace create OAUTH_KV --env sandbox -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler queues create finance-sandbox
pnpm exec wrangler queues create finance-sandbox-dlq
```

Put returned IDs into the Sandbox section of `apps/finance-worker/wrangler.jsonc`. Set `APP_ORIGIN` to its exact HTTPS Worker origin without a trailing slash. Production must have different D1/KV/queue bindings and `PLAID_ENV=production`. Keep local and deployed Sandbox on Plaid Sandbox.

Create a GitHub OAuth application with that origin and `/callback` as its callback. Configure these Worker Secrets per environment, never as committed variables:

```sh
pnpm exec wrangler secret put GITHUB_CLIENT_ID --env sandbox -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET --env sandbox -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put OWNER_GITHUB_ID --env sandbox -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put PLAID_CLIENT_ID --env sandbox -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put PLAID_SECRET --env sandbox -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put TOKEN_ENCRYPTION_KEY --env sandbox -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler secret put COOKIE_ENCRYPTION_KEY --env sandbox -c apps/finance-worker/wrangler.jsonc
```

Both encryption keys are independent base64 encodings of 32 random bytes. `TOKEN_KEY_VERSION` starts at `1`. `TOKEN_PREVIOUS_KEYS` is an optional secret JSON map of old versions to base64 keys.

Validate, apply additive migrations, then deploy code that depends on them:

```sh
pnpm check
pnpm exec wrangler d1 migrations apply finance-sandbox --remote --env sandbox -c apps/finance-worker/wrangler.jsonc
pnpm exec wrangler deploy --env sandbox -c apps/finance-worker/wrangler.jsonc
```

This deliberately corrects the original brief's deploy-before-migrate sequence. For incompatible future changes use expand/migrate/contract across multiple deployments. All existing migrations are append-only.

## Live acceptance

1. Load `/health`; verify the database and inspect the dashboard after owner login.
2. Verify a second GitHub user cannot access the application.
3. Connect a Sandbox Item with Link; exercise new, modified, removed and pending-to-posted transactions.
4. Verify that D1 holds token ciphertext, IV and key version only. Do not print token values to logs.
5. Exercise signed webhooks; verify work queue retries and dead-letter handling.
6. Reauthenticate an Item through update Link. Do not delete/recreate a Production Item to repair login.
7. Connect an external MCP client, grant only summary scope, verify that transaction and balance tools are absent, then test a full explicitly approved grant.
8. Test disconnect (history retained) separately from confirmed deletion (history removed and report cache cleared).
9. Load-test a realistic history, inspect CPU, D1 rows read/written, batch payload size, queue retries and request duration. Choose an appropriate paid plan if needed; no free-tier guarantee is made.
10. Only then provision Production, validate actual Canadian institution support, and connect the real institution yourself through Plaid Link.

## Daily operations

Cron runs at 10:00 UTC daily, enqueues active Items and reconciliation, and schedules weekly reports on Sunday and previous-month reports on the first day in America/Toronto. Queue delivery is at least once. Sync commits and report IDs are idempotent; retry failures are recorded without raw payloads. Local cron is manual: visit `/cdn-cgi/local/scheduled` on the Wrangler development server.

Data Health distinguishes fresh (<24h), degraded (24–72h), stale (>72h), errors, disconnected history, incomplete history, unknown currency and outdated derived generations. Missing data never implies a fresh zero balance. A report includes its observed coverage even when an institution fails. The daily reconciliation job rebuilds aggregates after a missed queue notification.

Large histories: the current initial-sync and full-derived publication use atomic D1 batches. If a workload exceeds batch/CPU limits, it fails without committing its cursor or partial aggregates. Do not raise claims of completeness to hide this: implement generation-staged chunking and an atomic generation-pointer switch before supporting histories beyond the measured envelope.

## Key rotation

1. Generate a fresh random key and a new version label.
2. Put the existing key under its old version in `TOKEN_PREVIOUS_KEYS`, while preserving any versions still present in D1.
3. Update `TOKEN_ENCRYPTION_KEY` and `TOKEN_KEY_VERSION` together as a controlled configuration change.
4. Use `rotateTokens` in `packages/security/rotation.ts` from a trusted operator context. `pnpm rotate:tokens` performs the same operation on **local D1 only**.
5. Verify that all connected rows use the new version and test a sync before removing an old key.

Each rewrite uses compare-and-swap on the previous ciphertext/version to avoid overwriting a simultaneous reconnect. The routine is safe to repeat. Rotating the cookie-state key invalidates in-progress logins; existing sessions use random opaque tokens, not that encryption key.

## Backups and recovery

Use D1's available backup/Time Travel capabilities for the selected plan and test a restore to a separate database. For a manual export:

```sh
pnpm exec wrangler d1 export finance-production --remote --env production -c apps/finance-worker/wrangler.jsonc --output /secure/local/path/finance-backup.sql
```

Exports contain sensitive financial data and encrypted credential material. Keep them outside the repository with restricted filesystem access. Back up encryption keys separately; a database restore without the matching keys cannot decrypt Plaid credentials. Apply migrations and rerun reconciliation after restoring. Do not automatically replay production financial data into a test environment.

## Deployment rollback

Keep migrations backward compatible. Roll back Worker code only when it understands the current schema. Inspect `/health`, queue failures, connection freshness and aggregate generation after deployment. The GitHub Actions workflow validates builds and local migrations only; it does not publish or mutate a production database.
