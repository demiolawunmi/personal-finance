import {
  spending,
  breakdown,
  balances,
  recurring,
  budget,
  anomalies,
  envelope,
  goals,
  periodAttention,
  largestTransactions,
  balanceAttention,
} from '../analytics/service';
import { reconcile } from '../db/derive';
import { insert, revision, first, audit, type Database } from '../db/repository';
import { previousPeriod, monthPeriod, addDays, today, type Period } from '../domain/periods';
import { CALCULATION_VERSION } from '../domain/transactions';
import { money, micros } from '../domain/money';
export async function compare(db: Database, p: Period, previous: Period = previousPeriod(p)) {
  if (p.currency !== previous.currency) throw new Error('CURRENCY_MISMATCH');
  const [current, prior] = await Promise.all([spending(db, p), spending(db, previous)]);
  const a = micros(current.spending.amount),
    b = micros(prior.spending.amount);
  return {
    current: { period: p, ...current },
    previous: { period: previous, ...prior },
    spending_change: money(a - b, p.currency),
    spending_change_ratio: b > 0 ? (a - b) / b : null,
  };
}
export async function report(
  db: Database,
  p: Period,
  type: 'weekly' | 'monthly' | 'snapshot',
  persist = false,
) {
  const previous =
    type === 'monthly' ? monthPeriod(addDays(p.start_date, -1), p.currency) : previousPeriod(p);
  const before = await revision(db);
  const [
    meta,
    headline,
    categories,
    merchants,
    position,
    streams,
    budgetStatus,
    signals,
    targets,
    changes,
    integrity,
  ] = await Promise.all([
    envelope(db, p),
    spending(db, p),
    breakdown(db, p, 'category'),
    breakdown(db, p, 'merchant'),
    balances(db, p.currency, type === 'snapshot' ? undefined : p.end_date + 'T23:59:59.999Z'),
    recurring(db, p.currency),
    budget(db, p, p.end_date < today() ? p.end_date : today()),
    anomalies(db, p),
    goals(db, p.currency),
    compare(db, p, previous),
    reconcile(db),
  ]);
  const [
    previousCategories,
    previousMerchants,
    largest,
    attention,
    previousPosition,
    balanceSignals,
  ] = await Promise.all([
    breakdown(db, previous, 'category'),
    breakdown(db, previous, 'merchant'),
    largestTransactions(db, p),
    periodAttention(db, p),
    balances(db, p.currency, previous.end_date + 'T23:59:59.999Z'),
    balanceAttention(db, p),
  ]);
  const delta = (current: typeof categories, prior: typeof categories) =>
    [...new Set([...current, ...prior].map((r) => r.name))].map((name) => ({
      name,
      change: money(
        micros(current.find((r) => r.name === name)?.spending.amount ?? '0') -
          micros(prior.find((r) => r.name === name)?.spending.amount ?? '0'),
        p.currency,
      ),
    }));
  const after = await revision(db);
  if (
    before.data_revision !== after.data_revision ||
    after.data_revision !== after.derived_revision
  )
    throw new Error('DATA_CHANGED_RETRY');
  const caveats: string[] = [];
  if (p.end_date > today())
    caveats.push(
      'This period is still open. Comparisons with a completed previous period are not like-for-like.',
    );
  if (!meta.data_freshness.coverage_complete)
    caveats.push('Institution coverage is incomplete or stale.');
  if (!integrity.ok) caveats.push('Reconciliation failed; report is degraded.');
  if (!position.coverage_complete)
    caveats.push('Balance coverage is incomplete; totals include only known balances.');
  caveats.push(
    'Recurring and goal status reflect generation time. Budget limits reflect the current saved budget.',
    'Cash flow means income minus consumption spending; it is not a bank-balance reconciliation.',
  );
  const result = {
    schema_version: '1.0',
    calculation_version: CALCULATION_VERSION,
    report_type: type,
    ...meta,
    data_revision: after.data_revision,
    data_health: { ...meta.data_freshness, integrity },
    headline: { ...headline, ending_cash: position.cash },
    position,
    spending: { categories, merchants, largest_transactions: largest },
    changes: {
      ...changes,
      category_changes: delta(categories, previousCategories),
      merchant_changes: delta(merchants, previousMerchants),
      net_worth_change:
        position.coverage_complete && previousPosition.coverage_complete
          ? money(
              micros(position.net_worth.amount) - micros(previousPosition.net_worth.amount),
              p.currency,
            )
          : null,
    },
    recurring: {
      ...streams,
      new: streams.series.filter((s) => s.first_seen >= p.start_date && s.first_seen <= p.end_date),
      increased: streams.series.filter((s) => micros(s.price_change.amount) > 0),
      upcoming: streams.series.filter(
        (s) => s.next_expected_date > p.end_date && s.next_expected_date <= addDays(p.end_date, 7),
      ),
    },
    budget: budgetStatus,
    anomalies: signals,
    category_attention: attention.category_signals,
    balance_attention: balanceSignals,
    goals: targets,
    action_candidates: [
      ...(!meta.data_freshness.coverage_complete ? ['Review connections and data health.'] : []),
      ...budgetStatus.categories
        .filter((c) => c.status === 'over_budget')
        .map((c) => `Review ${c.category} spending.`),
      ...streams.series
        .filter((s) => micros(s.price_change.amount) > 0)
        .map((s) => `Review the price increase at ${s.merchant}.`),
    ].slice(0, 3),
    caveats,
  };
  if (persist) {
    await insert(
      db,
      'report_runs',
      {
        id: crypto.randomUUID(),
        report_type: type,
        period_start: p.start_date,
        period_end: p.end_date,
        currency: p.currency,
        schema_version: '1.0',
        metrics_json: JSON.stringify(result),
        data_health_json: JSON.stringify(result.data_health),
        generated_at: result.as_of,
        calculation_version: CALCULATION_VERSION,
        data_revision: after.data_revision,
      },
      'ON CONFLICT DO NOTHING',
    ).run();
    await audit(db, 'REPORT_GENERATED', 'report', null, 'system', {
      type,
      start: p.start_date,
      end: p.end_date,
      currency: p.currency,
    });
  }
  return result;
}
