# Financial definitions — calculation version 1.0.0

## Money and dates

D1 amounts are signed integer micros: one currency unit is 1,000,000 micros. Each input and result must fit the JavaScript safe-integer range; unsupported sub-micro precision and overflow fail explicitly. Arithmetic uses BigInt at conversion and summation boundaries. API money objects are `{ "amount": "12.340000", "currency": "CAD" }`, never bare numbers. Display rounding is separate from calculation.

Plaid's outflow-positive amount is preserved. `cashflow_amount_micros = -plaid_amount_micros`. Transaction dates are provider calendar dates. Request periods are inclusive, valid ISO dates, and at most 366 days. User-facing schedules use America/Toronto. CAD and USD never combine. Missing currency becomes `UNKNOWN`, is excluded from ISO-currency queries, and degrades health.

## Classification

A manual category wins, then a versioned user rule, specific provider categories and deterministic unique transfer matching, provider fallback, then Other. Merchant aliases and Uber Eats normalization run before merchant rules. User merchant overrides win. Rules use literal equals/contains, not arbitrary executable expressions or unbounded regular expressions.

Own-account pair candidates require distinct accounts, equal opposite signed amounts, identical currencies, transfer/payment descriptions and at most three days separation. Both sides must uniquely match each other. Explicit category overrides and user rules prevent automatic pairing. Specific provider categories such as credit-card payments and account transfers are excluded even when one side is not connected. A generic transfer-in/out classification alone does not establish that the counterparty belongs to the owner.

Positive credits with a refund signal are refunds. Otherwise a prior same-merchant, same-currency purchase within 120 days can establish a refund, with a cap on cumulative matched refunds. Unknown inflows do not silently become salary. A manual spending category on a credit explicitly treats it as a refund; a manual Income category treats it as income.

Refunds reduce spending in the **refund posting period**, without restating the purchase month. Over-refunds are not silently linked beyond the purchase amount. An unmatched refund keeps its inferred category. Net category spending can be negative.

## Totals

- Spending = negative of settled, nonremoved consumption cashflows, net of refunds and explicit spending exclusions.
- Income = qualified settled income cashflows; transfers, refunds and unknown credits are excluded.
- Net cash flow = income − spending. This is economic surplus, not cash-account movement; it excludes transfers and investment contributions.
- Savings rate = net cash flow / income when income > 0; otherwise null.
- Pending commitments = pending eligible purchase outflows, kept separate from settled history.
- Net worth = known asset balances − known credit/loan balances. Negative credit balances naturally represent a credit owed to the owner. Missing balances remain null, with incomplete coverage.
- Available cash = sum of known depository available balances; missing available balances are not inferred from current balances.

## Budgets, recurrence and comparisons

One active monthly budget per currency. Limits are nonnegative. No rollover. Usage nets refunds; utilization is null when the limit is zero. Pace compares utilization with elapsed calendar days, clamped to 0–1. A budget applies starting with a month boundary. Saved report JSON preserves the budget at generation; querying an old period uses currently saved limits.

Recurring detection groups settled consumption by account, merchant and currency. At least three observations are required; 80% of intervals must match a supported cadence. Weekly: 6–8 days; biweekly: 12–16; monthly: 25–35; annual: 350–380. Amount deviation over 60% rejects a stream. Monthly equivalents use 52/12, 26/12, 1, or 1/12 with nearest-micro rounding. Calendar month/year prediction clamps to the target month's last day. Streams become inactive after two expected intervals without a charge.

Default custom-period comparison uses the immediately preceding period of equal duration. Explicit comparison periods must use one currency. Percentage changes are null when the previous denominator is nonpositive. Interpret comparisons with coverage/freshness caveats.

## Attention signals

Duplicate candidates have the same merchant/account/currency/amount/date. Unusual amounts exceed both three times the merchant's prior median and the configured CAD/USD 300 threshold. New large merchants, recurring price increases, category spending pace above a three-month baseline, and unexplained balance movement are also surfaced. Balance movement signals explicitly caution that transaction dates and observation timestamps may not align. Thresholds for other currencies must be explicitly configured; no implicit FX conversion.

Reports are immutable factual snapshots stamped with schema, calculation version and source revision. Their recurring and goal sections reflect generation time. Older reports are not silently rewritten when methodology or input data changes.
