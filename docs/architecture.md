# Personal Finance MCP — V1 System Architecture

## 0. Product thesis

The system is a **private financial data and intelligence layer** owned by one person.

Its job is not to move money, trade, pay bills, or make autonomous financial decisions.

Its job is to:

> Continuously turn fragmented bank data into a clean, auditable model of where money is, where it went, what is changing, and what deserves attention — then expose that information safely to humans and AI systems.

The fundamental architecture is:

```text
                         ┌─────────────────────┐
                         │  Bank / Credit Card │
                         └──────────┬──────────┘
                                    │
                              Plaid Link
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────┐
│                  CLOUDFLARE EDGE                          │
│                                                           │
│  ┌─────────────┐   ┌────────────┐   ┌─────────────────┐  │
│  │ Web / API   │   │ Plaid      │   │ MCP / OAuth     │  │
│  │ Worker      │   │ Webhook    │   │ /mcp            │  │
│  └──────┬──────┘   └─────┬──────┘   └────────┬────────┘  │
│         │                 │                   │           │
│         │            Cloudflare Queue         │           │
│         │                 │                   │           │
│         └──────────┬──────┴──────────┬────────┘           │
│                    ▼                 ▼                    │
│              ┌──────────┐    ┌──────────────┐             │
│              │ D1       │    │ Analytics /  │             │
│              │ Database │◄──►│ Report Engine│             │
│              └──────────┘    └──────────────┘             │
└───────────────────────────────────────────────────────────┘
                  │                  │
                  ▼                  ▼
          Personal Dashboard     AI Clients
                              ChatGPT / Claude /
                              Codex / custom UI
```

Plaid is the **ingestion provider**.

D1 is the **long-term financial memory**.

The analytics engine is the **source of mathematical truth**.

MCP is an **AI-facing query interface**.

The LLM is the **reasoning and communication layer**, not the accounting engine.

---

# 1. Non-negotiable design principles

| Principle                         | Rule                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Read-only finance                 | V1 cannot transfer, withdraw, buy, sell, or pay anything.                                          |
| Provider truth is preserved       | Plaid data is never destructively rewritten because an AI disagrees with it.                       |
| Deterministic calculations        | Spending, income, cash flow, budgets, recurring expenses and net worth are calculated in code/SQL. |
| AI interprets; code calculates    | The model explains metrics and suggests actions. It does not generate authoritative totals itself. |
| User overrides win                | Manual classification always outranks automated classification.                                    |
| No arbitrary SQL over MCP         | AI receives purpose-built financial tools only.                                                    |
| No credentials exposed            | Plaid secrets/access tokens never appear in MCP results or frontend JavaScript.                    |
| Currency is explicit              | Every financial number carries a currency.                                                         |
| Freshness is explicit             | Every report states when each institution was last synchronized.                                   |
| Transfers are not spending        | Moving your own money cannot artificially inflate expenses or income.                              |
| Pending ≠ settled                 | Pending purchases are shown separately and do not silently alter finalized reports.                |
| Everything important is auditable | Syncs, classification changes and MCP calls can be traced.                                         |

Cloudflare itself recommends goal-oriented MCP tools rather than exposing an entire backend API to an agent.

---

# 2. V1 scope

V1 should solve **cash-flow personal finance exceptionally well** before expanding into every possible financial product.

### Included in V1

Core Plaid products:

```text
Transactions
Accounts
Balances
```

Core intelligence:

```text
transaction history
merchant normalization
custom categories
transfer detection
refund handling
income detection
spending analysis
recurring-payment detection
budgeting
cash flow
balance/net-worth snapshots
anomaly detection
weekly reports
monthly reports
MCP queries
financial data-health monitoring
```

### Architecture-ready but feature-flagged

```text
Investments
Investment holdings
Investment transactions
Liabilities
Debt details
Multi-currency FX conversion
Tax analysis
Receipt ingestion
Financial document ingestion
```

Plaid's current Trial plan supports Transactions, Balance, Investments, Liabilities and several other products, with up to **10 Production Items**. Importantly, removing an Item does **not** restore one of those ten Trial slots, so the application should use Plaid's update/re-authentication flows rather than casually deleting and recreating connections.

---

# 3. Technology stack

| Layer                 | V1 choice                                                        |
| --------------------- | ---------------------------------------------------------------- |
| Language              | TypeScript                                                       |
| Runtime               | Cloudflare Workers                                               |
| Frontend              | React/Vite or lightweight React rendered as Worker static assets |
| Database              | Cloudflare D1                                                    |
| Async jobs            | Cloudflare Queues                                                |
| Scheduling            | Cloudflare Cron Triggers                                         |
| Banking               | Plaid                                                            |
| Authentication        | OAuth 2.1 via Cloudflare Workers OAuth Provider                  |
| Identity provider     | GitHub OAuth initially                                           |
| MCP                   | Cloudflare Agents SDK / Streamable HTTP                          |
| Validation            | Zod                                                              |
| Tests                 | Vitest                                                           |
| Package manager       | pnpm                                                             |
| CI/CD                 | GitHub Actions or Cloudflare Builds                              |
| Secrets               | Cloudflare Worker Secrets                                        |
| Optional future files | R2                                                               |
| AI backend            | None required                                                    |

An important choice is that **V1 does not need its own AI model**.

ChatGPT, Claude, Codex or another MCP client provides the intelligence. The financial server remains deterministic.

That reduces cost, complexity and the amount of financial data being sent to models unnecessarily.

Cloudflare currently supports authenticated remote MCP servers over Streamable HTTP and provides an OAuth Provider implementation compatible with the MCP authorization model.

---

# 4. Repository architecture

Use a monorepo, even though everything can initially deploy as one Worker.

```text
personal-finance/
│
├── apps/
│   └── finance-worker/
│       ├── src/
│       │   ├── index.ts
│       │   │
│       │   ├── routes/
│       │   │   ├── health.ts
│       │   │   ├── plaid.ts
│       │   │   ├── webhook.ts
│       │   │   ├── dashboard-api.ts
│       │   │   └── oauth.ts
│       │   │
│       │   ├── mcp/
│       │   │   ├── server.ts
│       │   │   ├── tools/
│       │   │   └── scopes.ts
│       │   │
│       │   ├── queue/
│       │   │   ├── consumer.ts
│       │   │   └── messages.ts
│       │   │
│       │   ├── cron/
│       │   │   └── scheduled.ts
│       │   │
│       │   └── ui/
│       │
│       └── wrangler.jsonc
│
├── packages/
│   ├── domain/
│   │   ├── money.ts
│   │   ├── accounts.ts
│   │   ├── transactions.ts
│   │   ├── categories.ts
│   │   └── periods.ts
│   │
│   ├── plaid/
│   │   ├── client.ts
│   │   ├── link.ts
│   │   ├── sync.ts
│   │   ├── webhooks.ts
│   │   └── types.ts
│   │
│   ├── db/
│   │   ├── queries/
│   │   ├── repositories/
│   │   └── types.ts
│   │
│   ├── classification/
│   │   ├── merchant-normalizer.ts
│   │   ├── category-engine.ts
│   │   ├── transfers.ts
│   │   ├── income.ts
│   │   └── recurring.ts
│   │
│   ├── analytics/
│   │   ├── spending.ts
│   │   ├── cashflow.ts
│   │   ├── budgets.ts
│   │   ├── net-worth.ts
│   │   ├── comparisons.ts
│   │   └── anomalies.ts
│   │
│   ├── reports/
│   │   ├── snapshot.ts
│   │   ├── weekly.ts
│   │   ├── monthly.ts
│   │   └── schemas.ts
│   │
│   ├── security/
│   │   ├── crypto.ts
│   │   ├── auth.ts
│   │   ├── redaction.ts
│   │   └── webhook-verification.ts
│   │
│   └── shared/
│
├── migrations/
│   ├── 0001_core.sql
│   ├── 0002_categories.sql
│   ├── 0003_budgets.sql
│   ├── 0004_reports.sql
│   └── 0005_aggregates.sql
│
├── tests/
│   ├── fixtures/
│   ├── unit/
│   ├── integration/
│   ├── plaid-sandbox/
│   └── mcp-evals/
│
├── scripts/
│   ├── seed-sandbox.ts
│   ├── backfill.ts
│   └── integrity-check.ts
│
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── metrics.md
│   ├── security.md
│   ├── mcp-contract.md
│   └── runbook.md
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

The important separation is:

```text
Plaid != database
database != analytics
analytics != reports
reports != MCP
MCP != AI
```

That separation makes future provider replacement straightforward.

---

# 5. Data architecture

The database has five conceptual layers.

```text
L0  Connection metadata
        ↓
L1  Provider records
        ↓
L2  User enrichment
        ↓
L3  Deterministic derived facts
        ↓
L4  Reports / MCP responses
```

## L0 — Connections

### `plaid_items`

| Field                   | Purpose                           |
| ----------------------- | --------------------------------- |
| id                      | Internal UUID                     |
| plaid_item_id           | Provider Item ID                  |
| institution_id          | Plaid institution                 |
| institution_name        | Display label                     |
| access_token_ciphertext | Encrypted access token            |
| access_token_iv         | Encryption nonce                  |
| key_version             | Encryption-key version            |
| sync_cursor             | `/transactions/sync` cursor       |
| status                  | healthy / error / reauth_required |
| last_successful_sync_at | Data freshness                    |
| last_webhook_at         | Monitoring                        |
| created_at              | Audit                             |
| disconnected_at         | Nullable                          |

Never expose this table through MCP.

---

# 6. Account model

### `accounts`

```text
id
plaid_account_id
plaid_item_id
name
official_name
type
subtype
currency
mask
is_active
created_at
updated_at
```

The internal UUID becomes the identifier exposed to other parts of the system.

AI does **not** need Plaid's account IDs.

### `balance_snapshots`

```text
id
account_id
current_amount_micros
available_amount_micros
limit_amount_micros
currency
observed_at
source_updated_at
```

This allows:

```text
cash history
credit utilization
debt history
net-worth history
balance trend analysis
```

rather than only knowing today's balance.

---

# 7. Money representation

Never use floating-point values as your canonical financial representation.

Internally:

```text
$12.34 CAD
        ↓
12,340,000 micros
```

Use:

```text
amount_micros INTEGER
currency TEXT
```

One monetary unit = 1,000,000 micros.

This avoids rounding errors while supporting currencies that do not necessarily use exactly two decimal places.

---

# 8. Transaction storage

### `transactions`

```text
id
plaid_transaction_id
account_id

plaid_amount_micros
cashflow_amount_micros

currency

date
authorized_date

name
merchant_name
original_description

plaid_primary_category
plaid_detailed_category

pending
pending_transaction_id

payment_channel

is_removed

created_at
updated_at
```

Plaid defines a **positive transaction amount as money leaving an account and a negative value as money entering it**. Internally, I would preserve that value as `plaid_amount_micros`, but additionally store a normalized `cashflow_amount_micros` where positive means money came to you and negative means money left you. That makes financial calculations much less error-prone.

For example:

```text
Restaurant purchase

Plaid amount:        +45.00
Internal cashflow:   -45.00
```

```text
Paycheque

Plaid amount:        -1,500.00
Internal cashflow:   +1,500.00
```

---

# 9. Never mix source data with user annotations

### `transaction_annotations`

```text
transaction_id
merchant_override
category_override_id
essentiality_override
exclude_from_spending
exclude_reason
note
updated_at
```

The transaction remains what Plaid supplied.

The annotation answers:

> How does **my financial system** interpret this transaction?

This is a crucial distinction.

---

# 10. Categories

Use your own stable taxonomy.

### `categories`

```text
income
housing
utilities
groceries
dining
transportation
shopping
entertainment
travel
education
health
personal_care
subscriptions
financial_fees
insurance
gifts
charity
taxes
cash
transfers
investments
other
```

Subcategories can sit beneath these.

Example:

```text
Food
 ├── Groceries
 ├── Dining
 ├── Coffee
 └── Delivery
```

Every category has:

```text
id
parent_id
slug
display_name
type
is_spending
is_income
is_transfer
```

This means analytics never have to infer whether a category should count toward spending.

---

# 11. Classification precedence

Classification uses strict precedence:

```text
1. Manual transaction override
        ↓
2. User merchant rule
        ↓
3. Deterministic system rule
        ↓
4. Plaid Personal Finance Category
        ↓
5. Optional classifier suggestion
        ↓
6. Uncategorized
```

AI suggestions can never silently outrank a user.

### `classification_rules`

Example:

```text
Merchant contains "UBER EATS"
→ Dining / Delivery

Merchant equals "WESTERN UNIVERSITY"
→ Education

Original description matches "NETFLIX"
→ Entertainment / Streaming
```

Rules should be versioned and auditable.

---

# 12. Merchant normalization

Banks often return:

```text
UBER *EATS 04/17
UBER CANADA/UBEREATS
Uber Eats Toronto
UBER* EATS
```

Your system should normalize those to:

```text
Uber Eats
```

### `merchant_aliases`

```text
raw_pattern
canonical_merchant
confidence
source
created_at
```

Merchant normalization makes recurring-payment and historical comparison logic dramatically better.

---

# 13. Transfer detection

This is one of the most important parts of the whole project.

Without transfer detection, someone who:

```text
receives $1,000
moves $600 to savings
pays $400 to a credit card
```

can appear to have spent $2,000.

The engine therefore creates an internal distinction between:

```text
economic activity
vs
money movement
```

### Transfer detection signals

Use Plaid's category first.

Then detect pairs across owned accounts using:

```text
same absolute amount
opposite directions
within ±3 days
compatible account types
transfer-like descriptions
```

Store matches:

### `transfer_pairs`

```text
id
outgoing_transaction_id
incoming_transaction_id
confidence
detection_method
confirmed
```

Credit-card payments between your accounts are transfers.

Transfers to brokerage accounts are transfers/investment contributions.

Neither should appear under ordinary consumption spending.

---

# 14. Refund handling

Refunds should reduce the associated spending category rather than count as income.

Example:

```text
Nike purchase         -$150 Shopping
Nike refund            +$80 Shopping

Net Shopping          -$70
```

The system first attempts:

```text
merchant match
category match
amount relationship
time proximity
```

If a refund cannot be matched, it remains an unmatched refund with the category inferred normally.

---

# 15. Pending transactions

Pending transactions are handled separately.

Dashboard:

```text
Available balance
Settled spending
Pending commitments
```

Reports use **settled transactions** as canonical history.

Pending transactions may inform:

```text
"you currently have $87 pending"
```

but do not mutate historical finalized spending.

This matters because pending transaction details can change before settlement.

---

# 16. Recurring-payment engine

Do not make V1 dependent on Plaid's recurring endpoint.

Plaid provides `/transactions/recurring/get`, but it is an add-on that requires additional product access.

Build your own recurring engine.

### `recurring_series`

```text
id
canonical_merchant
category_id
frequency
typical_amount_micros
amount_variance
next_expected_date
confidence
status
first_seen
last_seen
```

A candidate recurring stream could require:

```text
≥ 3 observations
```

and consistent intervals such as:

```text
weekly       6–8 days
biweekly     12–16 days
monthly      25–35 days
annual       approximately 1 year
```

Then compare amount variance.

Example:

```text
Spotify
$12.42
$12.42
$12.42
$13.99
```

The system identifies both:

```text
Recurring subscription
Price increase +12.6%
```

---

# 17. Budget architecture

### `budgets`

```text
id
name
period_type
currency
start_date
active
```

### `budget_lines`

```text
budget_id
category_id
limit_micros
```

V1 budgets should be simple monthly category limits.

Example:

| Category      | Budget |
| ------------- | -----: |
| Dining        |   $250 |
| Groceries     |   $350 |
| Entertainment |   $100 |
| Shopping      |   $200 |

No carry-forward logic initially.

Budget utilization:

```text
settled qualifying spending
───────────────────────────
category budget
```

The system can additionally calculate a pace:

```text
month elapsed:     27%
Dining budget used: 46%

Status: running ahead of budget
```

---

# 18. Financial goals

### `goals`

```text
id
name
type
target_amount_micros
current_amount_micros
currency
target_date
linked_account_id
status
```

Supported V1 types:

```text
savings
emergency_fund
debt_reduction
custom
```

These are user-defined targets, not model-generated goals.

---

# 19. Deterministic analytics layer

The analytics package owns every important financial definition.

For example:

### Spending

```text
settled outflows
- transfers
- investment contributions
- excluded transactions
- refunds
```

### Income

```text
qualified inflows
- internal transfers
- refunds
```

### Net cash flow

```text
income - spending
```

### Savings rate

```text
income - spending
─────────────────
     income
```

### Budget variance

```text
actual spending - budget
```

### Net worth

```text
asset balances - liability balances
```

For credit accounts, balance semantics must be normalized correctly because Plaid's positive credit balance generally represents money owed.

Every metric definition belongs in:

```text
docs/metrics.md
```

and gets unit tests.

---

# 20. Derived aggregate tables

Do **not** scan two years of transactions every time an MCP client asks a simple question.

Maintain aggregates:

### `daily_category_totals`

```text
date
category_id
currency
spending_micros
income_micros
transaction_count
```

### `daily_merchant_totals`

```text
date
merchant_id
currency
spending_micros
transaction_count
```

### `monthly_financial_metrics`

```text
month
currency
income_micros
spending_micros
net_cashflow_micros
savings_rate
```

These are derived data and can always be rebuilt.

This is especially useful because D1's current Free tier allows 5 million rows read/day and 100,000 rows written/day, with 500 MB per individual Free database and 5 GB total storage. As of September 1, 2026, exceeding daily Free-tier D1 query limits causes queries to fail until reset, so good indexing and aggregates matter.

---

# 21. Required database indexes

At minimum:

```text
transactions(account_id, date)
transactions(date)
transactions(merchant_name, date)
transactions(pending, date)
transactions(plaid_transaction_id) UNIQUE

balance_snapshots(account_id, observed_at)

transaction_annotations(transaction_id)

transfer_pairs(outgoing_transaction_id)
transfer_pairs(incoming_transaction_id)

daily_category_totals(date, category_id)
daily_merchant_totals(date, merchant_id)

recurring_series(next_expected_date)

audit_events(created_at)
```

There should be no common analytics query that requires an unrestricted full-table scan.

---

# 22. Plaid connection flow

The user-facing process becomes:

```text
Dashboard
   │
   ▼
Connect Institution
   │
   ▼
POST /api/plaid/link-token
   │
   ▼
Plaid Link
   │
   ▼
Bank OAuth / authentication
   │
   ▼
public_token
   │
   ▼
POST /api/plaid/exchange
   │
   ▼
Worker exchanges it
   │
   ▼
access_token
   │
   ├── encrypt
   │
   ├── save Item
   │
   └── enqueue initial sync
```

The browser never receives the permanent Plaid access token.

---

# 23. Synchronization architecture

Plaid recommends `/transactions/sync` for new Transactions integrations and sends `SYNC_UPDATES_AVAILABLE` when data has changed.

The process should be:

```text
Plaid
  │
  │ webhook
  ▼
POST /webhooks/plaid
  │
  ├── verify signature
  ├── validate age/body hash
  ├── enqueue SYNC_ITEM
  └── return 200
          │
          ▼
   Cloudflare Queue
          │
          ▼
    transactions/sync
          │
          ▼
      D1 transaction
          │
          ├── additions
          ├── modifications
          ├── removals
          └── save cursor
                  │
                  ▼
          Recompute affected
          derived aggregates
```

Cloudflare Queues currently includes **10,000 operations/day on Workers Free**, with 24-hour retention, which is vastly beyond the requirements of a one-person banking sync system.

---

# 24. Webhook security

Do not merely accept POST requests because they claim to come from Plaid.

Plaid attaches a signed `Plaid-Verification` JWT.

The Worker should:

```text
read Plaid-Verification
       ↓
require ES256
       ↓
extract kid
       ↓
fetch/cache Plaid JWK
       ↓
verify JWT
       ↓
reject if >5 minutes old
       ↓
SHA-256 raw webhook body
       ↓
compare against request_body_sha256
       ↓
process
```

This follows Plaid's documented webhook-verification mechanism.

---

# 25. Queue jobs

Use typed queue messages.

```ts
type FinanceJob =
  | { type: "SYNC_ITEM"; itemId: string }
  | { type: "REFRESH_ACCOUNTS"; itemId: string }
  | { type: "REBUILD_AGGREGATES"; from: string; to: string }
  | { type: "DETECT_RECURRING"; from: string }
  | { type: "RUN_DATA_HEALTH_CHECK" }
  | { type: "GENERATE_REPORT"; reportType: "weekly" | "monthly" };
```

Every consumer must be idempotent because message delivery may be repeated.

---

# 26. Cron architecture

Webhooks are primary.

Cron is the safety net.

```text
Every day
    ↓
connection-health reconciliation
    ↓
detect missed syncs
    ↓
refresh stale aggregates
```

```text
Sunday
    ↓
build weekly report
```

```text
1st day of month
    ↓
close previous month
    ↓
build monthly report
```

The system should never assume webhooks are infallible.

---

# 27. Data freshness

Every response carries:

```json
{
  "data_freshness": {
    "status": "fresh",
    "last_successful_sync": "2026-09-08T18:31:00-04:00",
    "stale_institutions": []
  }
}
```

Suggested statuses:

```text
FRESH       <24 hours
DEGRADED    24–72 hours
STALE       >72 hours
ERROR       provider requires intervention
```

Plaid notes that normal institution transaction checks are generally performed between one and four times per day depending on institution, so the product should not imply that ordinary transaction data is a tick-by-tick realtime feed.

---

# 28. Report architecture

Reports are not free-form AI conversations.

The deterministic report engine first creates a structured **Finance Report Object**.

### `FinanceReportV1`

```json
{
  "schema_version": "1.0",
  "report_type": "weekly",
  "period": {
    "start": "2026-09-01",
    "end": "2026-09-07"
  },

  "data_health": {},

  "headline": {
    "income": {},
    "spending": {},
    "net_cashflow": {},
    "savings_rate": null,
    "ending_cash": {}
  },

  "spending": {
    "categories": [],
    "merchants": [],
    "largest_transactions": []
  },

  "changes": {
    "previous_period": {},
    "category_changes": [],
    "merchant_changes": []
  },

  "recurring": {
    "monthly_total": {},
    "new": [],
    "increased": [],
    "upcoming": []
  },

  "budget": {
    "overall": {},
    "categories": []
  },

  "anomalies": [],

  "goals": [],

  "action_candidates": [],

  "caveats": []
}
```

The report engine creates that object.

Then an AI may transform it into prose.

This prevents:

```text
AI math hallucination
AI forgetting transfers
AI accidentally mixing periods
AI comparing incomplete data
```

---

# 29. Weekly report

The weekly report should answer:

> What happened with my money this week, is anything going wrong, and what should I pay attention to next week?

Recommended structure:

| Section             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| Financial pulse     | Income, spending, net cash flow              |
| Spending movement   | Categories/merchants that changed            |
| Budget pace         | Ahead/on/behind                              |
| Recurring costs     | New, increased, upcoming                     |
| Unusual activity    | Transactions needing attention               |
| Cash outlook        | Current available cash and known commitments |
| Goals               | Progress                                     |
| Suggested attention | Maximum 3 meaningful actions                 |
| Data health         | What data may be stale/incomplete            |

It should prioritize exceptions rather than repeat every transaction.

---

# 30. Monthly report

The monthly report is more analytical.

```text
MONTHLY FINANCIAL REVIEW

Financial position
        ↓
Income and cash flow
        ↓
Where money went
        ↓
Month-over-month changes
        ↓
Recurring commitments
        ↓
Budget performance
        ↓
Savings
        ↓
Net-worth movement
        ↓
Notable anomalies
        ↓
Goals
        ↓
Three priorities for next month
```

Example headline:

```text
September 2026

Income                     $2,480
Spending                   $1,724
Net cash flow               +$756
Savings rate                 30.5%

vs August
Spending                    -8.2%
Dining                     +14.3%
Shopping                   -31.6%

Recurring commitments        $221/mo
New recurring                  1
Price increases                1

Budget categories over pace    2
```

Every number comes from the deterministic report payload.

---

# 31. Anomaly engine

V1 anomaly detection should be deterministic.

Examples:

### Transaction anomaly

```text
transaction >
max(
  merchant historical median × 3,
  configured absolute threshold
)
```

### Category anomaly

```text
current monthly category pace
vs
historical monthly category distribution
```

### Duplicate candidate

```text
same merchant
same/similar amount
same day
```

### Subscription change

```text
current recurring amount
vs
previous recurring amount
```

### New merchant

Large transaction from a merchant never previously seen.

### Balance anomaly

Unexpected large account-balance movement that cannot be explained by synchronized transactions.

Anomalies are **signals**, not accusations of fraud.

---

# 32. MCP architecture

Endpoint:

```text
https://finance.example.com/mcp
```

Use Streamable HTTP.

Require OAuth.

MCP receives **financially meaningful tools**, not database access.

Cloudflare supports this architecture directly and its current MCP implementation uses OAuth for authenticated remote servers.

---

# 33. V1 MCP tools

Keep V1 to approximately 12 excellent tools.

| Tool                     | Purpose                             |
| ------------------------ | ----------------------------------- |
| `get_financial_snapshot` | Current high-level picture          |
| `get_spending_summary`   | Spending for a period               |
| `get_category_breakdown` | Where money went                    |
| `get_merchant_breakdown` | Merchant analysis                   |
| `search_transactions`    | Find specific transactions          |
| `compare_periods`        | Week/month/custom period comparison |
| `get_cashflow`           | Income/outflow/net cash flow        |
| `get_recurring_expenses` | Subscriptions and recurring bills   |
| `get_budget_status`      | Budget usage and pace               |
| `get_net_worth`          | Assets/liabilities snapshots        |
| `get_anomalies`          | Items requiring attention           |
| `get_financial_report`   | Structured weekly/monthly report    |
| `get_data_health`        | Source freshness/errors             |

No:

```text
execute_sql
get_plaid_access_token
dump_database
transfer_money
buy_asset
pay_bill
```

---

# 34. Example MCP contract

### `get_spending_summary`

Input:

```json
{
  "start_date": "2026-09-01",
  "end_date": "2026-09-30",
  "currency": "CAD",
  "include_pending": false
}
```

Output:

```json
{
  "period": {
    "start": "2026-09-01",
    "end": "2026-09-30"
  },
  "currency": "CAD",
  "total_spending": 1724.31,
  "transaction_count": 82,
  "transfers_excluded": 4,
  "refunds_netted": 2,
  "pending": 87.12,
  "data_freshness": {
    "last_sync": "2026-09-30T18:43:00-04:00"
  }
}
```

This gives an AI everything it needs without exposing implementation details.

---

# 35. MCP output constraints

Every financial MCP response should include:

```text
currency
period
as_of timestamp
data freshness
important exclusions
```

Transaction-search results should have a hard maximum, for example:

```text
100 transactions per request
```

Date-range tools should also have bounded ranges.

This protects privacy, context windows and D1 query budgets.

---

# 36. MCP permissions

Architect scopes now even though there is initially one owner.

```text
finance:summary
finance:transactions
finance:reports
finance:balances
```

V1 MCP is **read-only**.

Later:

```text
finance:annotate
finance:budget_write
```

could exist separately.

There should never be:

```text
finance:money_movement
```

in this project.

---

# 37. Authentication

For the first personal deployment, use GitHub OAuth.

Cloudflare has a reference implementation where the MCP server uses GitHub as the upstream OAuth identity provider.

Production Worker secrets:

```text
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
COOKIE_ENCRYPTION_KEY

PLAID_CLIENT_ID
PLAID_SECRET

TOKEN_ENCRYPTION_KEY

OWNER_GITHUB_ID
```

After OAuth authentication:

```text
authenticated GitHub ID
        ↓
compare against OWNER_GITHUB_ID
        ↓
allow / deny
```

Use immutable GitHub account ID rather than relying solely on username.

---

# 38. Plaid token protection

The access token is the most sensitive object stored by the system.

Store:

```text
AES-256-GCM(
   plaid_access_token,
   random IV,
   TOKEN_ENCRYPTION_KEY
)
```

The encryption key lives only in Cloudflare Secrets.

D1 stores:

```text
ciphertext
IV
key version
```

Never the plaintext token.

Use a unique IV for every encryption operation.

Support key rotation from the beginning.

D1 itself also encrypts database contents at rest using AES-256 and encrypts data in transit, but application-level token encryption provides an additional boundary specifically for credentials.

---

# 39. Financial transaction data

Do **not** application-encrypt every transaction field individually.

That would make:

```text
SUM
GROUP BY
date filtering
merchant analysis
category analysis
```

extremely difficult.

Instead:

```text
Plaid credentials → application-encrypted
financial records → D1 access controls + platform encryption
```

and minimize the data you store.

Do not store unnecessary:

```text
bank usernames
bank passwords
routing numbers
full card numbers
SIN
authentication credentials
```

The system does not need them.

---

# 40. Logging policy

Application logs must redact:

```text
Plaid access_token
Plaid public_token
Plaid secret
OAuth secrets
Authorization headers
raw webhook JWTs
full financial payloads
```

Safe log:

```text
sync completed
item=a43f...
added=7
modified=1
removed=0
duration=...
```

Unsafe log:

```text
full Plaid API response
```

---

# 41. Audit log

### `audit_events`

```text
id
timestamp
actor_type
actor_id
event_type
resource_type
resource_id
metadata_json
```

Examples:

```text
PLAID_ITEM_CONNECTED
PLAID_ITEM_REAUTHENTICATED
SYNC_COMPLETED
MANUAL_CATEGORY_CHANGED
BUDGET_CHANGED
MCP_TOOL_CALLED
REPORT_GENERATED
DATA_EXPORT_REQUESTED
ITEM_DISCONNECTED
```

For MCP calls, log:

```text
tool
time
authenticated client
parameter summary
success/failure
```

Do not log the complete financial output.

---

# 42. Dashboard

The web UI should remain intentionally compact.

Navigation:

```text
Overview
Transactions
Spending
Recurring
Budget
Reports
Connections
Data Health
Settings
```

## Overview

```text
Cash
Credit owed
Monthly income
Monthly spending
Net cash flow
Budget status
Recurring monthly costs
Recent anomalies
```

## Transactions

Searchable table with:

```text
date
merchant
amount
account
category
status
```

Allow manual:

```text
category override
merchant rename
exclude transaction
note
```

## Recurring

```text
merchant
amount
frequency
last charged
next expected
change
```

## Connections

```text
TD                 Healthy
RBC Visa           Healthy
Wealthsimple       Reauthentication required
```

Never show provider secrets.

---

# 43. Institution reauthentication

When Plaid reports an Item problem:

```text
ITEM_LOGIN_REQUIRED
```

the application should not delete the Item.

It should show:

```text
Reconnect institution
```

and launch Plaid Link in update mode.

This is particularly important under Plaid Trial because deleting an Item does not restore one of the ten Production Item allocations.

---

# 44. Disconnect versus delete

These must be separate actions.

### Disconnect

```text
revoke Plaid connection
stop future syncing
retain historical finance data
```

### Delete financial data

```text
revoke Plaid connection
delete associated transactions
delete balances
delete annotations
delete aggregates
delete reports
```

Require an explicit confirmation for the second operation.

---

# 45. Data-quality engine

### `data_health_events`

Possible issues:

```text
institution stale
Plaid login required
sync failed
transaction history incomplete
unknown currency
large unmatched transfer
duplicate candidate
account disappeared
aggregate mismatch
```

Reports consult this table before presenting conclusions.

A report containing incomplete financial data should say so.

---

# 46. Integrity tests

Run deterministic reconciliation.

Example:

```text
SUM(category spending)
≈
SUM(eligible spending transactions)
```

```text
income - spending
=
net cash flow
```

```text
transfer pair amount A
=
transfer pair amount B
```

```text
derived daily totals
=
underlying normalized transactions
```

If these checks fail, mark reports degraded rather than silently presenting incorrect totals.

---

# 47. Report persistence

### `report_runs`

```text
id
report_type
period_start
period_end
schema_version
metrics_json
data_health_json
generated_at
calculation_version
```

Store the deterministic report object.

Do not require storing AI-written prose.

That means you can regenerate different narratives from exactly the same factual report.

---

# 48. Calculation versioning

Every report stores:

```text
calculation_version: "1.3.0"
```

Why?

Imagine that six months later you improve transfer detection.

A report from September might otherwise disagree with a newly calculated September report with no explanation.

Versioning lets you distinguish:

```text
data changed
vs
calculation methodology changed
```

This is a small architectural decision with a large long-term payoff.

---

# 49. Multi-currency policy

Do not fake currency conversion.

V1 rule:

```text
CAD totals stay CAD.
USD totals stay USD.
```

If a report contains both:

```text
CAD spending: $1,300 CAD
USD spending: $180 USD
```

Do not produce a combined value unless an FX rate exists.

Future table:

### `fx_rates`

```text
date
base_currency
quote_currency
rate
source
```

Then conversion becomes deterministic and historically reproducible.

---

# 50. Privacy-conscious AI interface

Do not automatically send every transaction to an LLM.

For:

> How am I doing this month?

MCP should return aggregates.

For:

> What did I spend at Uber Eats?

Return only matching transactions.

For:

> Find that $87 charge I made last week.

Return the relevant candidate set.

The principle is:

```text
minimum financial data
needed to answer the question
```

rather than:

```text
dump entire financial history
into model context
```

---

# 51. Failure behaviour

## Plaid unavailable

Return cached data with:

```text
status: stale
last_successful_sync: ...
```

Do not return zero.

## D1 unavailable

Return an explicit service error.

Do not fabricate a financial summary.

## One institution fails

Continue using healthy institutions but label the report:

```text
coverage incomplete
```

## Queue failure

Retry.

Cron reconciliation catches missed work.

## Duplicate webhook

Idempotent sync means no duplication.

## Transaction removed by Plaid

Soft-delete source record and rebuild affected aggregates.

## Transaction modified

Update source fields while preserving user annotations.

---

# 52. Cost architecture

At one-user scale, this should generally fit comfortably within free infrastructure limits.

Current relevant limits include:

| Component        | Free allowance            |
| ---------------- | ------------------------- |
| Plaid Trial      | Up to 10 Production Items |
| Workers          | 100,000 requests/day      |
| D1 reads         | 5M rows/day               |
| D1 writes        | 100k rows/day             |
| D1 individual DB | 500 MB                    |
| D1 total storage | 5 GB                      |
| Queues           | 10,000 operations/day     |

The main Free Worker constraint worth monitoring is CPU time, currently 10 ms per request. Heavy synchronization work belongs in Queue consumers rather than interactive request handlers.

If the project eventually outgrows Workers Free, Cloudflare's Workers Paid plan currently starts at $5 USD/month.

---

# 53. Environments

Maintain three environments.

```text
local
sandbox
production
```

### Local

```text
local D1
Plaid Sandbox
.dev.vars
```

### Sandbox deployment

```text
Cloudflare Worker
Plaid Sandbox
separate D1
```

### Production

```text
Production Plaid
Production D1
Production OAuth
production secrets
```

Never allow production Plaid tokens into test fixtures.

---

# 54. Database migrations

Migrations are append-only.

```text
0001_connections.sql
0002_accounts.sql
0003_transactions.sql
0004_annotations.sql
0005_classification.sql
0006_budgets.sql
0007_recurring.sql
0008_aggregates.sql
0009_reports.sql
0010_audit.sql
```

Deployment pipeline:

```text
test
 ↓
migration validation
 ↓
deploy Worker
 ↓
apply production migration
 ↓
health check
```

---

# 55. Testing strategy

The test hierarchy should be:

| Test layer     | What it proves                     |
| -------------- | ---------------------------------- |
| Unit           | Financial math is correct          |
| Fixture        | Plaid payload normalization        |
| Integration    | D1 queries and migrations          |
| Sandbox        | Real Plaid API behaviour           |
| Webhook        | Signature + duplicate handling     |
| Security       | Unauthorized MCP requests rejected |
| MCP eval       | Models choose the right tool       |
| Reconciliation | Derived totals match transactions  |

Particularly aggressive tests should exist for:

```text
credit-card payments
refunds
pending → posted changes
duplicate transactions
transfers
multi-account transfers
negative amounts
month boundaries
year boundaries
currency differences
removed transactions
institution reconnects
```

---

# 56. MCP evaluations

Don't test MCP only with:

```text
call get_spending_summary
```

Test realistic prompts:

```text
"Why did I spend so much this month?"

"Did I spend more eating out than last month?"

"What's costing me the most repeatedly?"

"Can I see all Uber transactions from August?"

"How much did I actually save last month?"

"Why is my credit card higher?"

"Is my bank data current?"
```

Verify that the agent:

```text
selects the correct tool
uses correct date ranges
doesn't count transfers as spending
doesn't infer stale data as current
doesn't claim unsupported certainty
```

Cloudflare specifically recommends evals for MCP tool usage as part of good MCP design.

---

# 57. Production health endpoint

`GET /health`

returns only infrastructure state:

```json
{
  "status": "healthy",
  "database": "healthy",
  "queue": "healthy",
  "version": "1.0.0"
}
```

Do not expose financial information through health endpoints.

---

# 58. Primary HTTP surface

```text
GET  /health

GET  /
GET  /transactions
GET  /budget
GET  /recurring
GET  /reports
GET  /connections

POST /api/plaid/link-token
POST /api/plaid/exchange
POST /api/plaid/items/:id/update-link-token
POST /api/plaid/items/:id/disconnect

POST /webhooks/plaid

GET  /api/overview
GET  /api/transactions
GET  /api/budget
GET  /api/recurring
GET  /api/reports
GET  /api/data-health

PATCH /api/transactions/:id/annotation
PUT   /api/budgets/:id

GET  /authorize
POST /token
POST /register
GET  /callback

POST /mcp
```

Dashboard write APIs and MCP are logically separate.

MCP V1 stays read-only even though the dashboard can change metadata.

---

# 59. V1 report intelligence

The AI should receive an instruction equivalent to:

```text
Treat all monetary values supplied by the finance tools as
authoritative calculations.

Do not recalculate totals unless explicitly needed.

Distinguish settled spending from pending transactions.

Do not treat transfers as spending or income.

State data freshness when it materially affects the answer.

When recommending changes, distinguish observed facts from
recommendations.

Do not claim a transaction is fraudulent.

Do not make claims about affordability that ignore known obligations.
```

That prompt belongs on the client side or as an MCP prompt/resource.

---

# 60. What V1 should feel like

Once running, you should be able to ask:

> Give me my financial overview.

And receive:

```text
Cash available:            $2,431
Credit-card balance:         $482

September income:          $1,820
September spending:        $1,163
Net cash flow:              +$657

Largest categories:
Dining                       $224
Shopping                     $191
Transportation               $144

Recurring expenses:          $186/month

Dining is running 21% above your recent monthly pace.

One recurring charge increased:
Spotify $12.42 → $13.99.

Your financial data was last synchronized 3 hours ago.
```

Then:

> Why is dining high?

The AI calls:

```text
get_category_breakdown
get_merchant_breakdown
compare_periods
```

and explains the cause.

Then:

> Show me the transactions causing it.

Only then does it request transaction-level data.

That is the privacy and intelligence model.

---

# 61. Recommended implementation order

The dependency chain should be:

```text
FOUNDATION
Cloudflare Worker
D1
migrations
auth
       ↓
PLAID
Link
token exchange
encrypted storage
accounts
transactions/sync
webhooks
queue
       ↓
NORMALIZATION
amount semantics
categories
merchant normalization
transfers
refunds
pending handling
       ↓
ANALYTICS
spending
income
cash flow
comparisons
balances
       ↓
PERSONAL FINANCE
recurring
budgets
anomalies
goals
       ↓
REPORTS
snapshot
weekly
monthly
data health
       ↓
MCP
OAuth
tools
scopes
evals
       ↓
DASHBOARD
overview
transactions
budget
reports
connections
       ↓
HARDENING
audit
reconciliation
failure tests
token rotation
backups
```

Do not build the dashboard first.

The real product is the financial data model.

---

# 62. V1 acceptance criteria

I would call V1 complete only when all of the following are true.

| Area         | Required outcome                                                |
| ------------ | --------------------------------------------------------------- |
| Connection   | A real Canadian institution can be connected through Plaid Link |
| Security     | Plaid access token never exists plaintext in D1                 |
| Sync         | New/modified/removed transactions synchronize correctly         |
| Recovery     | A broken institution can be reauthenticated                     |
| Transfers    | Own-account transfers do not count as spending                  |
| Cards        | Credit-card payments do not double-count spending               |
| Refunds      | Refunds offset spending correctly                               |
| Pending      | Pending and settled transactions are separated                  |
| Categories   | User can permanently override classifications                   |
| Recurring    | Common subscriptions are detected                               |
| Budget       | Monthly category limits and pace work                           |
| Analytics    | Month/week comparisons are deterministic                        |
| Reports      | Weekly and monthly structured reports exist                     |
| Freshness    | Reports identify stale or incomplete data                       |
| MCP          | Authenticated AI can query all core analytics                   |
| MCP security | No money movement or arbitrary SQL exists                       |
| Audit        | Important changes and tool access are recorded                  |
| Tests        | Financial reconciliation suite passes                           |
| Cost         | Personal usage remains within intended infrastructure limits    |

---

# 63. V1.1

Once the cash-flow system is trustworthy:

```text
Investments
Liabilities
credit utilization
debt payoff tracking
historical FX rates
better recurring detection
user-defined financial rules
CSV export
financial notifications
```

---

# 64. V2

Only after V1 has accumulated reliable history would I add predictive intelligence:

```text
cash-flow forecasting
expected month-end balance
safe-to-spend estimates
subscription cancellation suggestions
goal simulations
scenario analysis

"If I cut dining by $100/month,
how does that affect my summer savings target?"

"Based on recurring obligations and typical spending,
how much discretionary cash do I have until payday?"
```

This prediction layer should consume the deterministic financial model rather than raw Plaid data.

---

# 65. V3

Eventually the platform can become provider-independent:

```text
                  ┌─ Plaid
                  ├─ CSV imports
                  ├─ Wealthsimple export
                  ├─ credit-card statements
                  ├─ brokerage APIs
                  └─ manual accounts
                         │
                         ▼
               Normalized finance model
                         │
            ┌────────────┼─────────────┐
            ▼            ▼             ▼
       Dashboard       Reports        MCP
```

At that point Plaid is just one adapter.

---

# 66. Final architecture decision

The V1 should **not** be:

```text
ChatGPT
   ↓
Plaid API
   ↓
random bank transactions
```

It should be:

```text
                 YOUR FINANCIAL DATA PLATFORM

Bank
 │
 ▼
Plaid
 │
 ▼
Secure ingestion
 │
 ▼
Normalized transaction store
 │
 ├────► User annotations
 │
 ▼
Financial rules engine
 │
 ├────► Transfer detection
 ├────► Refund handling
 ├────► Merchant normalization
 ├────► Categorization
 └────► Recurring detection
 │
 ▼
Deterministic analytics
 │
 ├────► Spending
 ├────► Income
 ├────► Cash flow
 ├────► Budgets
 ├────► Net worth
 ├────► Comparisons
 └────► Anomalies
 │
 ▼
Structured financial reports
 │
 ├──────────────► Dashboard
 │
 └──────────────► Secure MCP
                        │
                        ▼
             ChatGPT / Claude / Codex
                        │
                        ▼
                  Interpretation
                  Recommendations
                  Conversation
```

That distinction is what turns the project from a **Plaid MCP experiment** into a durable personal-finance system.

The most valuable asset you're building is ultimately not the MCP server.

It is the **clean, longitudinal, provider-independent financial model underneath it**.

MCP is simply the interface that makes that model useful to AI.
