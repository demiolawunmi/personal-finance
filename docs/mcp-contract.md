# MCP contract

Endpoint: `/mcp`, authenticated Streamable HTTP through the Cloudflare Agents SDK and MCP SDK v2. Legacy SDK v1 clients are covered by in-memory protocol tests. Authorization discovery, `/authorize`, `/token`, `/register`, and `/callback` are handled by Workers OAuth Provider and the owner login routes.

Each tool takes `start_date`, `end_date`, `currency` (CAD default). Periods are inclusive and bounded to 366 days. Each successful response includes a period, currency, as-of timestamp, per-institution freshness, exclusions and a `data` object. Money is `{amount: decimal_string, currency: ISO_code}`.

| Tool                   | Required scope       |
| ---------------------- | -------------------- |
| get_financial_snapshot | finance:summary      |
| get_spending_summary   | finance:summary      |
| get_category_breakdown | finance:summary      |
| get_merchant_breakdown | finance:summary      |
| compare_periods        | finance:summary      |
| get_cashflow           | finance:summary      |
| get_recurring_expenses | finance:summary      |
| get_budget_status      | finance:summary      |
| get_data_health        | finance:summary      |
| search_transactions    | finance:transactions |
| get_anomalies          | finance:transactions |
| get_net_worth          | finance:balances     |
| get_financial_report   | finance:reports      |

Summary-only snapshots deliberately omit balances and transaction details. A report scope allows its complete structured report, including balances and anomaly transaction references; the client consent screen lists that scope.

`search_transactions`: optional `query`, `category_id`, `account_id`, `pending`, `cursor`, `limit` (1–100). Results contain no Plaid IDs, credentials, or transaction notes. `compare_periods`: optional paired `previous_start_date` / `previous_end_date`. `get_financial_report`: `report_type` is weekly or monthly. MCP report queries calculate without creating dashboard report runs, though access is audited.

The server does not expose annotations, budget writes, SQL, transfers, purchases or payments as MCP tools. All tool descriptions carry read-only and non-destructive annotations. Errors have a safe code and `isError: true`; database/provider failures do not become zero financial results.

Prompt-selection scenarios are in `tests/mcp-evals/prompts.json`. They are an evaluation corpus for a chosen external model, not a claim that a live ChatGPT/Claude model evaluation has run.
