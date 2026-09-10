import type { EffectiveTransaction } from '../domain/transactions';
import { dayDiff, addDays } from '../domain/periods';
import { safe } from '../domain/money';
export function median(ns: number[]) {
  const a = [...ns].sort((x, y) => x - y);
  if (!a.length) return 0;
  const middle = Math.floor(a.length / 2);
  return a.length % 2 ? a[middle] : safe((BigInt(a[middle - 1]) + BigInt(a[middle])) / 2n);
}
/** Groups charges of a similar size so a stable subscription is not hidden by a
 *  merchant's one-off purchases (e.g. an Amazon Prime charge among Amazon orders). */
function amountClusters(rows: EffectiveTransaction[]) {
  const sorted = [...rows].sort(
    (a, b) => Math.abs(a.cashflow_amount_micros) - Math.abs(b.cashflow_amount_micros),
  );
  const clusters: EffectiveTransaction[][] = [];
  let current: EffectiveTransaction[] = [];
  for (const t of sorted) {
    const amount = Math.abs(t.cashflow_amount_micros);
    const ref = current.length ? Math.abs(current[0].cashflow_amount_micros) : 0;
    if (!current.length) current = [t];
    else if (ref && Math.abs(amount - ref) / ref <= 0.1) current.push(t);
    else {
      clusters.push(current);
      current = [t];
    }
  }
  if (current.length) clusters.push(current);
  return clusters;
}
// Household bills recur on a schedule but their amounts move with usage and
// season (hydro, gas, insurance). Cadence still proves recurrence; the amount
// tolerance must not reject them.
const BILL_CATEGORIES = new Set([
  'housing',
  'utilities',
  'insurance',
  'subscriptions',
  'financial_fees',
  'taxes',
]);
function matchSeries(rows: EffectiveTransaction[], asOf: string, id: string) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;
  const last = sorted.at(-1)!;
  const billLike = BILL_CATEGORIES.has(last.category_id);
  const gaps = sorted.slice(1).map((r, i) => dayDiff(sorted[i].date, r.date));
  const options = [
    ['weekly', 6, 8, 7, 52],
    ['biweekly', 12, 16, 14, 26],
    ['monthly', 25, 35, 30, 12],
    ['annual', 350, 380, 365, 1],
  ] as const;
  const threshold = billLike ? 0.6 : 0.8;
  const match = options.find(
    ([, min, max]) => gaps.filter((g) => g >= min && g <= max).length / gaps.length >= threshold,
  );
  if (!match) return null;
  const [frequency, , , days, perYear] = match;
  const amounts = sorted.map((t) => -t.cashflow_amount_micros);
  const typical = median(amounts);
  const variance = typical ? Math.max(...amounts.map((a) => Math.abs(a - typical) / typical)) : 0;
  if (variance > (billLike ? 2.5 : 0.6)) return null;
  // Two observations are only accepted when the amounts are close; otherwise a
  // repeated pair of purchases would masquerade as a subscription. They are
  // marked 'possible' so they do not inflate the committed monthly total.
  if (sorted.length < 3 && variance > 0.35) return null;
  let next = addDays(last.date, days);
  if (frequency === 'monthly' || frequency === 'annual') {
    const d = new Date(last.date);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (frequency === 'monthly' ? 1 : 12));
    const end = new Date(d);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    d.setUTCDate(Math.min(day, end.getUTCDate()));
    next = d.toISOString().slice(0, 10);
  }
  return {
    id,
    canonical_merchant: last.merchant,
    account_id: last.account_id,
    category_id: last.category_id,
    currency: last.currency,
    frequency,
    typical_amount_micros: amounts.at(-1)!,
    previous_amount_micros: amounts.at(-2)!,
    monthly_amount_micros: safe((BigInt(amounts.at(-1)!) * BigInt(perYear) + 6n) / 12n),
    amount_variance: variance,
    next_expected_date: next,
    confidence:
      sorted.length < 3 ? 0.55 : billLike && variance > 0.6 ? 0.6 : variance < 0.15 ? 0.9 : 0.7,
    status:
      sorted.length < 3 ? 'possible' : dayDiff(last.date, asOf) > days * 2 ? 'inactive' : 'active',
    first_seen: sorted[0].date,
    last_seen: last.date,
    observations: sorted.length,
  };
}
export function detectRecurring(ts: EffectiveTransaction[], asOf: string) {
  const groups = new Map<string, EffectiveTransaction[]>();
  for (const t of ts.filter(
    (t) => !t.pending && !t.is_removed && !t.excluded && t.kind === 'spending',
  )) {
    const key = JSON.stringify([t.account_id, t.currency, t.merchant]);
    const group = groups.get(key) ?? [];
    group.push(t);
    groups.set(key, group);
  }
  const series = [];
  for (const [id, rows] of groups) {
    const whole = matchSeries(rows, asOf, id);
    if (whole) {
      series.push(whole);
      continue;
    }
    // The merchant mixes purchases with a stable charge: isolate the amount
    // clusters so the subscription still surfaces.
    for (const cluster of amountClusters(rows)) {
      if (cluster.length < 2) continue;
      const matched = matchSeries(
        cluster,
        asOf,
        id + ':amount:' + Math.abs(cluster[0].cashflow_amount_micros),
      );
      if (matched) series.push(matched);
    }
  }
  return series;
}
