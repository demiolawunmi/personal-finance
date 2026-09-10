import type { EffectiveTransaction } from '../domain/transactions';
import { money, sum, ratio } from '../domain/money';
import { validatePeriod, type Period } from '../domain/periods';
export function summarize(rows: EffectiveTransaction[], p: Period) {
  validatePeriod(p);
  const all = rows.filter(
    (t) =>
      !t.is_removed && t.currency === p.currency && t.date >= p.start_date && t.date <= p.end_date,
  );
  const settled = all.filter((t) => !t.pending);
  const eligible = settled.filter((t) => !t.excluded && ['spending', 'refund'].includes(t.kind));
  const spending = sum(eligible.map((t) => -t.cashflow_amount_micros));
  const income = sum(
    settled.filter((t) => t.kind === 'income').map((t) => t.cashflow_amount_micros),
  );
  return {
    period: { start: p.start_date, end: p.end_date },
    currency: p.currency,
    income: money(income, p.currency),
    spending: money(spending, p.currency),
    net_cashflow: money(sum([income, -spending]), p.currency),
    savings_rate: ratio(income - spending, income),
    pending: money(
      sum(
        all
          .filter((t) => t.pending && !t.excluded && t.kind === 'spending')
          .map((t) => -t.cashflow_amount_micros),
      ),
      p.currency,
    ),
    transaction_count: eligible.length,
    transfers_excluded: settled.filter((t) => t.kind === 'transfer').length,
    refunds_netted: eligible.filter((t) => t.kind === 'refund').length,
    unclassified_inflows: money(
      sum(
        settled
          .filter((t) => t.kind === 'unclassified_inflow')
          .map((t) => t.cashflow_amount_micros),
      ),
      p.currency,
    ),
  };
}
export function breakdown(
  rows: EffectiveTransaction[],
  p: Period,
  field: 'category_id' | 'merchant',
) {
  validatePeriod(p);
  const groups = new Map<string, number[]>();
  for (const t of rows.filter(
    (t) =>
      !t.is_removed &&
      !t.pending &&
      !t.excluded &&
      t.currency === p.currency &&
      t.date >= p.start_date &&
      t.date <= p.end_date &&
      ['spending', 'refund'].includes(t.kind),
  )) {
    const key = t[field];
    groups.set(key, [...(groups.get(key) ?? []), -t.cashflow_amount_micros]);
  }
  return [...groups]
    .map(([name, values]) => ({
      name,
      spending: money(sum(values), p.currency),
      transaction_count: values.length,
    }))
    .sort((a, b) => Number(b.spending.amount) - Number(a.spending.amount));
}
