# Data model and consistency

Source: `plaid_items`, `accounts`, `balance_snapshots`, `transactions`. Public IDs are internal identifiers. Provider transaction IDs are unique. Removed source transactions are soft-deleted; user annotations remain independently stored.

Enrichment: `transaction_annotations`, `categories`, `classification_rules`, `merchant_aliases`. Rules carry versions and edits produce audit events. Categories explicitly distinguish consumption, income and transfer treatment.

Derived: `transaction_facts`, `transfer_pairs`, `recurring_series`, `anomalies`, daily category/merchant aggregates and monthly metrics. A background rebuild writes a complete new derived state atomically. A database revision fence rejects an inconsistent read generation. Every material calculation input increments `system_state.data_revision`; queries requiring derived facts fail while `derived_revision` differs. Queue retry and daily reconciliation repair interruptions. Interactive summary queries use date/currency aggregates; transaction search uses bound parameters and date indexes.

Reports: `report_runs` stores immutable versioned JSON, input revision, period, currency and generation time. Repeated report jobs for the same type/period/currency/method/input revision do not duplicate rows. Health: connection freshness, incomplete history, unknown currencies, failed syncs and reconciliation state are reported explicitly.

Operational: `sync_leases`, `sync_runs`, `write_fences`, `audit_events`, `data_health_events`, `sessions`, `oauth_states`, `oauth_consents`. OAuth access grants live in the separate KV binding managed by Cloudflare's provider.

The implementation uses one database and one owner. This is not a multi-tenant application. A provider adapter can be added later without exposing provider identifiers through financial tools.
