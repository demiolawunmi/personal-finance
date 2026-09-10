# V1 acceptance status

The repository contains the V1 implementation and local tests. It is **not yet a live, production-accepted financial system**.

## Implemented and locally tested

Exact money, explicit currency, provider/annotation separation, owner session checks, CSRF, AES-GCM authenticated encryption, webhook JWT signature/body/age checks, sync pagination restart, atomic cursor publication, pending annotation carryover, updates/removals, conservative transfers, refund netting, recurring detection, budget computation, aggregates, reconciliation, bounded search, safe MCP output and scope-filtered tools. React and Worker production bundles build. Real local D1 migrations apply. HTTP smoke tests verify unauthenticated rejection and public infrastructure routes.

## Implemented; live validation requires setup

GitHub OAuth login and consent; Plaid Link and reauthentication; actual bank sync; production webhook delivery; Queues retries/dead-letter behavior; scheduled reports; external MCP-client OAuth; production key rotation; actual institution coverage and cost/load validation. `tests/plaid-sandbox/live.test.ts` is intentionally opt-in and is skipped without credentials. The prompt-selection corpus is ready for external model evaluation, which has not been run.

## Deliberate V1 implementation boundaries

- Recurring analysis and anomaly thresholds are conservative heuristics. No claim of fraud, prediction or guaranteed future charges.
- Unknown inflows and ambiguous transfer matches require user review. Direct cash withdrawals count as cash spending; generic external transfers are not assumed to be owned-account transfers.
- Reports preserve snapshots, but freshly querying a past period uses current user classifications and budget configuration. Calculation and input versions make this explicit.
- Balances use cached `/accounts/get` observations, with observation time and incomplete coverage. No on-demand Balance refresh is billed automatically.
- The current full-history rebuild and sync batch must be load-tested on the chosen Cloudflare plan. Chunked generation staging is a scaling follow-up if the measured personal history does not fit the atomic batch envelope.
- Investments, liabilities product integration, FX conversion, tax/document/receipt analysis and predictive affordability remain out of scope. No endpoints for these capabilities are exposed.

The original acceptance criterion requiring a **real Canadian institution connection** cannot be checked until the owner configures and completes that connection. No production resources or financial accounts were created during implementation.
