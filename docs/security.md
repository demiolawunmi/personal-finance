# Security boundaries

## Authentication

The dashboard requires a random 256-bit session token, stored in an HttpOnly SameSite=Lax cookie (Secure outside local HTTP). D1 stores its SHA-256 hash, owner ID, expiry and CSRF token. Each request checks the immutable GitHub owner ID. Sessions expire after 12 hours; logout deletes the record. Mutations require both an exact Origin match and CSRF token. OAuth state is short-lived, browser-bound and consumed atomically; the stored authorization request is encrypted with a separate key.

MCP uses Cloudflare Workers OAuth Provider with a dedicated KV namespace, PKCE S256, one-hour access tokens and 30-day refresh tokens. The owner sees a consent page for every authorization with client identity, redirect and scopes. Token scopes are intersected with grant properties at request time. Tools outside those scopes are not registered. The Settings screen lists active client grants and allows the owner to revoke them. The reports scope explicitly grants report contents including aggregate balances and transaction anomaly signals. Transaction notes and raw provider IDs are excluded from MCP results.

`/health` returns only infrastructure status. `queue: configured` means a binding exists; it is deliberately not a claim that queue delivery has been tested remotely. Static assets contain no financial data or credentials; content-addressed build assets are served `public, max-age=31536000, immutable` and the SPA shell `public, max-age=0, must-revalidate` with an ETag. All `/api/*`, `/mcp`, OAuth and webhook responses remain `private, no-store` and include CSP, nosniff, frame denial and no-referrer headers. Institution logos are served from a session-gated endpoint as `private, max-age=604800` with a content ETag. There is no permissive CORS policy.

## Secrets

Plaid access tokens are AES-256-GCM encrypted with a random 96-bit IV per write and additional authenticated data binding the internal Item ID and key version. D1 stores ciphertext/IV/version. Keys and provider secrets live in Worker Secrets (gitignored `.dev.vars` only for local work). Old version keys are read from `TOKEN_PREVIOUS_KEYS` during rotation. Transaction fields remain queryable in D1 under platform protections; they are never exposed publicly.

Logs contain event identifiers and safe counts/errors, not request bodies, raw financial records, headers or credentials. Audit events store metadata summaries; changes do not copy transaction notes into logs. Merchant strings and all provider text are untrusted data, not instructions for an AI client. No tool accepts raw SQL or can move money.

## Webhooks and sync

Webhook JWTs require ES256 and a fetched Plaid public key, a valid signature, `iat` no older than five minutes and no future issue time, and a SHA-256 match to the exact raw request body. Request size is capped. A verified event enqueues a job; duplicates are harmless because provider transaction IDs are unique and sync is idempotent.

Sync uses an expiring per-Item lease. The final D1 batch includes a CHECK-constrained fence verifying lease ownership, lease expiry, unchanged original cursor and a still-connected Item. A failed fence rolls back the batch. Full pagination restarts from the initial cursor on Plaid's mutation error. Partial pages never advance the cursor. An expired or overlapping worker cannot commit over a newer result.

## Recovery and deletion

Disconnect revokes the provider connection, removes its credential ciphertext, stops future syncs and retains financial history. Reauthentication uses update Link without deleting the Item. Delete history requires the exact confirmation string `DELETE <internal-item-id>`; it removes source records via foreign keys, invalidates derived data and deletes all saved reports because reports can combine institutions. Audit history remains and contains no complete financial payload.

Review Cloudflare account access and backup retention separately. D1 Time Travel/platform backups can retain records after application deletion until their retention expires. No claim is made that an application delete instantly removes platform backups.
