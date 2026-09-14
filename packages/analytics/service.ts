import { all, first, type Database, revision } from '../db/repository';
import { ensureDerived, reconcile } from '../db/derive';
import { money, safe, sum, ratio } from '../domain/money';
import { validatePeriod, type Period, dayDiff, monthPeriod, today } from '../domain/periods';
const moneyFmt: Record<string, Intl.NumberFormat> = {};
function fmtMicros(micros: number, currency: string): string {
  if (!moneyFmt[currency])
    moneyFmt[currency] = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return moneyFmt[currency].format(micros / 1_000_000);
}
export async function dataHealth(db: Database) {
  const institutions = await all<{
    id: string;
    institution_name: string;
    status: string;
    last_successful_sync_at: string | null;
    history_complete: number;
    disconnected_at: string | null;
  }>(
    db,
    'SELECT id,institution_name,status,last_successful_sync_at,history_complete,disconnected_at FROM plaid_items',
  );
  const now = Date.now();
  const sources = institutions.map((i) => {
    const age = i.last_successful_sync_at
      ? (now - Date.parse(i.last_successful_sync_at)) / 3600000
      : Infinity;
    return {
      id: i.id,
      institution: i.institution_name,
      last_successful_sync: i.last_successful_sync_at,
      history_complete: !!i.history_complete,
      connection_status: i.status,
      status: i.disconnected_at
        ? 'disconnected'
        : i.status !== 'healthy'
          ? 'error'
          : age > 72
            ? 'stale'
            : age >= 24
              ? 'degraded'
              : 'fresh',
    };
  });
  const events = await all(
    db,
    'SELECT kind,severity,message,created_at FROM data_health_events WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 30',
  );
  const rev = await revision(db);
  const unknown = await first<{ n: number }>(
    db,
    "SELECT COUNT(*) n FROM transactions WHERE currency='UNKNOWN' AND is_removed=0",
  );
  const review = await first<{
    unknown_inflows: number;
    duplicate_candidates: number;
    disappeared_accounts: number;
  }>(
    db,
    `SELECT (SELECT COUNT(*) FROM effective_transactions WHERE kind='unclassified_inflow' AND pending=0) unknown_inflows,(SELECT COUNT(*) FROM anomalies a LEFT JOIN anomaly_reviews r ON r.anomaly_id=a.id WHERE a.kind='duplicate_candidate' AND (r.status IS NULL OR r.status='open')) duplicate_candidates,(SELECT COUNT(*) FROM accounts a JOIN plaid_items i ON i.id=a.plaid_item_id WHERE a.is_active=0 AND a.hidden=0 AND i.disconnected_at IS NULL) disappeared_accounts`,
  );
  const mismatch = rev.data_revision !== rev.derived_revision;
  const status =
    sources.length === 0
      ? 'empty'
      : sources.some((s) => s.status === 'error')
        ? 'error'
        : sources.some((s) => s.status === 'stale' || s.status === 'disconnected')
          ? 'stale'
          : mismatch ||
              unknown?.n ||
              review?.disappeared_accounts ||
              review?.unknown_inflows ||
              sources.some((s) => s.status === 'degraded' || !s.history_complete)
            ? 'degraded'
            : 'fresh';
  const ago = (iso: string) => {
    const h = Math.round((now - Date.parse(iso)) / 3600000);
    if (h < 1) return 'moments ago';
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };
  type Notice = {
    id: string;
    severity: 'error' | 'warning' | 'info' | 'success';
    scope: string;
    title: string;
    body: string;
    view?: string;
    action_label?: string;
    created_at?: string;
  };
  const notices: Notice[] = [];
  for (const s of sources) {
    if (s.status === 'disconnected')
      notices.push({
        id: `disconnected:${s.id}`,
        severity: 'warning',
        scope: 'sync',
        title: `${s.institution} is disconnected`,
        body: 'History is kept, but new transactions are not being imported.',
        view: 'accounts',
        action_label: 'Reconnect',
      });
    else if (s.status === 'error')
      notices.push({
        id: `error:${s.id}`,
        severity: 'error',
        scope: 'sync',
        title: `${s.institution} needs attention`,
        body: `Last successful sync ${ago(s.last_successful_sync || '')}. Re-authentication is likely required.`,
        view: 'accounts',
        action_label: 'Review connection',
      });
    else if (s.status === 'stale')
      notices.push({
        id: `stale:${s.id}`,
        severity: 'warning',
        scope: 'sync',
        title: `${s.institution} is out of date`,
        body: `Last successful sync ${ago(s.last_successful_sync || '')}. Balances and totals may be understated.`,
        view: 'health',
        action_label: 'Open data health',
      });
    else if (s.status === 'degraded')
      notices.push({
        id: `degraded:${s.id}`,
        severity: 'info',
        scope: 'sync',
        title: `${s.institution} is syncing slowly`,
        body: `Last successful sync ${ago(s.last_successful_sync || '')}.`,
        view: 'health',
        action_label: 'Open data health',
      });
    if (!s.history_complete)
      notices.push({
        id: `history:${s.id}`,
        severity: 'warning',
        scope: 'coverage',
        title: `${s.institution} history is incomplete`,
        body: 'Older transactions may be missing, so trend comparisons are partial.',
        view: 'health',
        action_label: 'Open data health',
      });
  }
  if (mismatch)
    notices.push({
      id: 'recalculating',
      severity: 'warning',
      scope: 'data',
      title: 'Totals are recalculating',
      body: 'A sync changed the source data; derived figures refresh after the current rebuild.',
    });
  if (unknown?.n)
    notices.push({
      id: 'unknown-currency',
      severity: 'warning',
      scope: 'data',
      title: `${unknown.n} transaction(s) in an unknown currency`,
      body: 'They are held out of totals until the currency is identified.',
      view: 'transactions',
      action_label: 'Review',
    });
  if (review?.unknown_inflows)
    notices.push({
      id: 'unknown-inflows',
      severity: 'info',
      scope: 'review',
      title: `${review.unknown_inflows} unmatched deposit(s)`,
      body: 'Inflows without a category are not counted as income.',
      view: 'transactions',
      action_label: 'Classify',
    });
  if (review?.duplicate_candidates)
    notices.push({
      id: 'duplicate-candidates',
      severity: 'warning',
      scope: 'review',
      title: `${review.duplicate_candidates} possible duplicate charge(s)`,
      body: 'Identical charges within 48 hours are flagged for review.',
      view: 'insights',
      action_label: 'Review signals',
    });
  if (review?.disappeared_accounts)
    notices.push({
      id: 'disappeared-accounts',
      severity: 'warning',
      scope: 'coverage',
      title: `${review.disappeared_accounts} account(s) stopped syncing`,
      body: 'A previously active account is missing from recent syncs.',
      view: 'health',
      action_label: 'Open data health',
    });
  for (const e of events.slice(0, 3)) {
    const ev = e as { kind: string; severity: string; message: string; created_at: string };
    notices.push({
      id: `event:${ev.created_at}:${ev.kind}`,
      severity: ev.severity === 'error' ? 'error' : 'warning',
      scope: 'sync',
      title: ev.kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      body: ev.message,
      created_at: ev.created_at,
      view: 'health',
      action_label: 'Open data health',
    });
  }
  if (!notices.length)
    notices.push({
      id: 'all-clear',
      severity: 'success',
      scope: 'data',
      title: 'All connected institutions are current',
      body: 'History is complete and totals are up to date.',
    });
  const order = { error: 0, warning: 1, info: 2, success: 3 };
  notices.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    status,
    institutions: sources,
    coverage_complete:
      sources.length > 0 &&
      sources.every((s) => s.status === 'fresh' && s.history_complete) &&
      !unknown?.n &&
      !review?.disappeared_accounts &&
      !mismatch,
    classification_complete: !review?.unknown_inflows,
    review_counts: review,
    derived_data_current: !mismatch,
    unknown_currency_transactions: unknown?.n ?? 0,
    events,
    notices: notices.slice(0, 6),
  };
}
export async function envelope(db: Database, p: Period) {
  return {
    period: { start: p.start_date, end: p.end_date },
    currency: p.currency,
    as_of: new Date().toISOString(),
    data_freshness: await dataHealth(db),
    exclusions: [
      'Pending transactions are separate.',
      'Own-account transfers and investment contributions are excluded.',
      'Refunds reduce spending on their posting date.',
      'Currencies are never combined.',
    ],
  };
}
export async function spending(db: Database, p: Period) {
  validatePeriod(p);
  await ensureDerived(db);
  const totals = await first<{ income: number; spending: number }>(
    db,
    'SELECT COALESCE(SUM(income_micros),0) income,COALESCE(SUM(spending_micros),0) spending FROM daily_category_totals WHERE date BETWEEN ? AND ? AND currency=?',
    p.start_date,
    p.end_date,
    p.currency,
  );
  const counts = await first<{
    pending: number;
    transfers: number;
    refunds: number;
    count: number;
    unclassified: number;
  }>(
    db,
    `SELECT COALESCE(SUM(CASE WHEN pending=1 AND kind='spending' AND excluded=0 THEN -cashflow_amount_micros ELSE 0 END),0) pending,SUM(CASE WHEN pending=0 AND kind='transfer' THEN 1 ELSE 0 END) transfers,SUM(CASE WHEN pending=0 AND kind='refund' AND excluded=0 THEN 1 ELSE 0 END) refunds,SUM(CASE WHEN pending=0 AND kind IN ('spending','refund') AND excluded=0 THEN 1 ELSE 0 END) count,COALESCE(SUM(CASE WHEN pending=0 AND kind='unclassified_inflow' THEN cashflow_amount_micros ELSE 0 END),0) unclassified FROM effective_transactions WHERE date BETWEEN ? AND ? AND currency=?`,
    p.start_date,
    p.end_date,
    p.currency,
  );
  const income = safe(totals!.income),
    expense = safe(totals!.spending);
  return {
    income: money(income, p.currency),
    spending: money(expense, p.currency),
    net_cashflow: money(sum([income, -expense]), p.currency),
    savings_rate: ratio(income - expense, income),
    pending: money(counts?.pending ?? 0, p.currency),
    transaction_count: counts?.count ?? 0,
    transfers_excluded: counts?.transfers ?? 0,
    refunds_netted: counts?.refunds ?? 0,
    unclassified_inflows: money(counts?.unclassified ?? 0, p.currency),
  };
}
export async function breakdown(db: Database, p: Period, type: 'category' | 'merchant') {
  validatePeriod(p);
  await ensureDerived(db);
  const table = type === 'category' ? 'daily_category_totals' : 'daily_merchant_totals';
  const key = type === 'category' ? 'category_id' : 'merchant_id';
  const rows = await all<{ name: string; amount: number; count: number }>(
    db,
    `SELECT ${key} name,SUM(spending_micros) amount,SUM(transaction_count) count FROM ${table} WHERE date BETWEEN ? AND ? AND currency=? GROUP BY ${key} HAVING SUM(spending_micros)<>0 ORDER BY amount DESC LIMIT 100`,
    p.start_date,
    p.end_date,
    p.currency,
  );
  return rows.map((r) => ({
    name: r.name,
    spending: money(r.amount, p.currency),
    transaction_count: r.count,
  }));
}
export type Search = {
  query?: string;
  account_id?: string;
  category_id?: string;
  kind?: string;
  pending?: boolean;
  excluded?: boolean;
  limit?: number;
  cursor?: string;
};
export async function transactions(db: Database, p: Period, s: Search = {}) {
  validatePeriod(p);
  await ensureDerived(db);
  const limit = Math.min(100, Math.max(1, s.limit ?? 50));
  const clauses = ['t.date BETWEEN ? AND ?', 't.currency=?'];
  const params: unknown[] = [p.start_date, p.end_date, p.currency];
  if (s.query) {
    clauses.push("(t.merchant LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\')");
    const pattern = '%' + s.query.replace(/[\\%_]/g, '\\$&') + '%';
    params.push(pattern, pattern);
  }
  if (s.account_id) {
    clauses.push('t.account_id=?');
    params.push(s.account_id);
  }
  if (s.category_id) {
    clauses.push('t.category_id=?');
    params.push(s.category_id);
  }
  if (s.kind) {
    clauses.push('t.kind=?');
    params.push(s.kind);
  }
  if (s.pending !== undefined) {
    clauses.push('t.pending=?');
    params.push(Number(s.pending));
  }
  if (s.excluded !== undefined) {
    clauses.push('t.excluded=?');
    params.push(Number(s.excluded));
  }
  if (s.cursor) {
    const parts = s.cursor.split('|');
    if (parts.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0]))
      throw new Error('INVALID_CURSOR');
    const [cursorDate, cursorTime, cursorId] = parts;
    clauses.push(
      "(t.date<? OR (t.date=? AND COALESCE(t.datetime,'')<?) OR (t.date=? AND COALESCE(t.datetime,'')=? AND t.id<?))",
    );
    params.push(cursorDate, cursorDate, cursorTime, cursorDate, cursorTime, cursorId);
  }
  const rows = await all<{
    id: string;
    date: string;
    datetime: string | null;
    authorized_datetime: string | null;
    merchant: string;
    name: string;
    cashflow_amount_micros: number;
    currency: string;
    account_id: string;
    account_name: string | null;
    category_id: string;
    kind: string;
    pending: number;
    excluded: number;
    classification_source: string;
  }>(
    db,
    `SELECT t.id,t.date,t.datetime,t.authorized_datetime,t.merchant,t.name,t.cashflow_amount_micros,t.currency,t.account_id,COALESCE(a.custom_name,a.name) account_name,t.category_id,t.kind,t.pending,t.excluded,t.classification_source FROM effective_transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE ${clauses.join(' AND ')} ORDER BY t.date DESC,COALESCE(t.datetime,'') DESC,t.id DESC LIMIT ?`,
    ...params,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    transactions: page.map(({ cashflow_amount_micros, ...t }) => ({
      ...t,
      amount: money(cashflow_amount_micros, t.currency),
      pending: !!t.pending,
      excluded: !!t.excluded,
    })),
    next_cursor: rows.length > limit && last ? `${last.date}|${last.datetime ?? ''}|${last.id}` : null,
  };
}
export async function balances(db: Database, currency: string, asOf = new Date().toISOString()) {
  const rows = await all<{
    id: string;
    name: string;
    type: string;
    is_active: number;
    current_amount_micros: number | null;
    available_amount_micros: number | null;
    observed_at: string | null;
    institution_name: string | null;
    logo: string | null;
  }>(
    db,
    `SELECT a.id,COALESCE(a.custom_name,a.name) AS name,a.type,a.is_active,i.institution_name,i.logo,b.current_amount_micros,b.available_amount_micros,b.observed_at FROM accounts a LEFT JOIN plaid_items i ON i.id=a.plaid_item_id LEFT JOIN balance_snapshots b ON b.id=(SELECT id FROM balance_snapshots WHERE account_id=a.id AND currency=? AND observed_at<=? ORDER BY observed_at DESC LIMIT 1) WHERE a.currency=? AND a.hidden=0`,
    currency,
    asOf,
    currency,
  );
  const known = rows.filter((r) => r.current_amount_micros !== null);
  const asset = sum(
    known.filter((r) => !['credit', 'loan'].includes(r.type)).map((r) => r.current_amount_micros!),
  );
  const liability = sum(
    known.filter((r) => ['credit', 'loan'].includes(r.type)).map((r) => r.current_amount_micros!),
  );
  return {
    assets: money(asset, currency),
    liabilities: money(liability, currency),
    net_worth: money(sum([asset, -liability]), currency),
    cash: money(
      sum(known.filter((r) => r.type === 'depository').map((r) => r.current_amount_micros!)),
      currency,
    ),
    available_cash: money(
      sum(
        rows
          .filter((r) => r.type === 'depository' && r.available_amount_micros !== null)
          .map((r) => r.available_amount_micros!),
      ),
      currency,
    ),
    coverage_complete:
      rows.length > 0 && rows.every((r) => r.current_amount_micros !== null && r.is_active),
    accounts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      active: !!r.is_active,
      institution_name: r.institution_name,
      logo: r.logo,
      current: r.current_amount_micros === null ? null : money(r.current_amount_micros, currency),
      available:
        r.available_amount_micros === null ? null : money(r.available_amount_micros, currency),
      observed_at: r.observed_at,
    })),
  };
}
/** Every account, including ones the owner has hidden, for the management screen. */
export async function accounts(db: Database, currency: string, asOf = new Date().toISOString()) {
  const rows = await all<{
    id: string;
    name: string;
    type: string;
    subtype: string | null;
    is_active: number;
    hidden: number;
    institution_name: string | null;
    logo: string | null;
    current_amount_micros: number | null;
    available_amount_micros: number | null;
    observed_at: string | null;
  }>(
    db,
    `SELECT a.id,COALESCE(a.custom_name,a.name) AS name,a.type,a.subtype,a.is_active,a.hidden,i.institution_name,i.logo,b.current_amount_micros,b.available_amount_micros,b.observed_at FROM accounts a LEFT JOIN plaid_items i ON i.id=a.plaid_item_id LEFT JOIN balance_snapshots b ON b.id=(SELECT id FROM balance_snapshots WHERE account_id=a.id AND currency=? AND observed_at<=? ORDER BY observed_at DESC LIMIT 1) WHERE a.currency=? ORDER BY a.type,COALESCE(a.custom_name,a.name)`,
    currency,
    asOf,
    currency,
  );
  return {
    accounts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      subtype: r.subtype,
      active: !!r.is_active,
      hidden: !!r.hidden,
      institution_name: r.institution_name,
      logo: r.logo,
      current: r.current_amount_micros === null ? null : money(r.current_amount_micros, currency),
      available:
        r.available_amount_micros === null ? null : money(r.available_amount_micros, currency),
      observed_at: r.observed_at,
    })),
  };
}
export async function recurring(db: Database, currency: string) {
  await ensureDerived(db);
  const shape = (r: {
    id: string;
    canonical_merchant: string;
    frequency: string;
    typical_amount_micros: number;
    previous_amount_micros: number;
    next_expected_date: string;
    confidence: number;
    first_seen: string;
    last_seen: string;
  }) => ({
    id: r.id,
    merchant: r.canonical_merchant,
    frequency: r.frequency,
    amount: money(r.typical_amount_micros, currency),
    previous_amount: money(r.previous_amount_micros, currency),
    price_change: money(r.typical_amount_micros - r.previous_amount_micros, currency),
    next_expected_date: r.next_expected_date,
    confidence: r.confidence,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
  });
  const active = await all<Parameters<typeof shape>[0] & { monthly_amount_micros: number }>(
    db,
    'SELECT * FROM recurring_series WHERE currency=? AND status=? ORDER BY next_expected_date LIMIT 100',
    currency,
    'active',
  );
  // Two-observation candidates: useful to surface but not yet a commitment.
  const possible = await all<Parameters<typeof shape>[0]>(
    db,
    'SELECT * FROM recurring_series WHERE currency=? AND status=? ORDER BY last_seen DESC LIMIT 100',
    currency,
    'possible',
  );
  return {
    monthly_total: money(sum(active.map((r) => r.monthly_amount_micros)), currency),
    series: active.map(shape),
    possible: possible.map(shape),
  };
}
export async function budget(db: Database, p: Period, asOf = today()) {
  await ensureDerived(db);
  const month = monthPeriod(p.end_date, p.currency);
  const rows = await all<{
    name: string;
    category_id: string;
    limit_micros: number;
    actual: number;
  }>(
    db,
    `SELECT b.name,l.category_id,l.limit_micros,COALESCE((SELECT SUM(spending_micros) FROM daily_category_totals d WHERE d.category_id=l.category_id AND d.currency=b.currency AND d.date BETWEEN ? AND ?),0) actual FROM budgets b JOIN budget_lines l ON l.budget_id=b.id WHERE b.active=1 AND b.currency=? AND b.start_date<=?`,
    month.start_date,
    month.end_date,
    p.currency,
    month.start_date,
  );
  const elapsed = Math.min(
    1,
    Math.max(
      0,
      (dayDiff(month.start_date, asOf) + 1) / (dayDiff(month.start_date, month.end_date) + 1),
    ),
  );
  return {
    month: month.start_date.slice(0, 7),
    elapsed_fraction: elapsed,
    overall: {
      limit: money(sum(rows.map((r) => r.limit_micros)), p.currency),
      actual: money(sum(rows.map((r) => r.actual)), p.currency),
    },
    categories: rows.map((r) => ({
      category: r.category_id,
      limit: money(r.limit_micros, p.currency),
      actual: money(r.actual, p.currency),
      variance: money(r.actual - r.limit_micros, p.currency),
      utilization: ratio(r.actual, r.limit_micros),
      status:
        r.actual > r.limit_micros
          ? 'over_budget'
          : r.limit_micros > 0 && r.actual / r.limit_micros > elapsed
            ? 'ahead_of_pace'
            : 'on_track',
    })),
  };
}
export async function anomalies(db: Database, p: Period) {
  await ensureDerived(db);
  const rows = await all<{
    id: string;
    kind: string;
    severity: string;
    currency: string;
    amount_micros: number;
    date: string;
    description: string;
    evidence: string | null;
    rules: string | null;
    transaction_id: string;
    review_status: string | null;
    reviewed_at: string | null;
  }>(
    db,
    `SELECT a.*,r.status review_status,r.reviewed_at FROM anomalies a
       LEFT JOIN anomaly_reviews r ON r.anomaly_id=a.id
      WHERE a.date BETWEEN ? AND ? AND a.currency=?
      ORDER BY CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,a.date DESC
      LIMIT 100`,
    p.start_date,
    p.end_date,
    p.currency,
  );
  return rows.map(({ amount_micros, ...r }) => ({
    ...r,
    amount: money(amount_micros, p.currency),
    review_status: r.review_status ?? 'open',
  }));
}
/** Open triage signals across all time.
 *
 *  Anomalies are events, not period reports: a June duplicate still needs a
 *  decision in September. This feed ignores the selected period so nothing
 *  silently disappears when the calendar moves on. Pace signals stay
 *  period-scoped (they are forecasts) and travel with `periodAttention`. */
export async function openSignals(db: Database, currency: string) {
  await ensureDerived(db);
  const [rows, increases] = await Promise.all([
    all<{
      id: string;
      kind: string;
      severity: string;
      amount_micros: number;
      date: string;
      description: string;
      evidence: string | null;
      transaction_id: string;
    }>(
      db,
      `SELECT a.id,a.kind,a.severity,a.amount_micros,a.date,a.description,a.evidence,a.transaction_id
         FROM anomalies a LEFT JOIN anomaly_reviews r ON r.anomaly_id=a.id
        WHERE a.currency=? AND (r.status IS NULL OR r.status='open')
        ORDER BY CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,a.date DESC
        LIMIT 200`,
      currency,
    ),
    all<{
      id: string;
      canonical_merchant: string;
      typical_amount_micros: number;
      previous_amount_micros: number | null;
      last_seen: string;
    }>(
      db,
      `SELECT id,canonical_merchant,typical_amount_micros,previous_amount_micros,last_seen FROM recurring_series
        WHERE currency=? AND status='active' AND amount_variance<0.15 AND typical_amount_micros>COALESCE(previous_amount_micros,typical_amount_micros)
        ORDER BY (typical_amount_micros-COALESCE(previous_amount_micros,typical_amount_micros)) DESC LIMIT 50`,
      currency,
    ),
  ]);
  const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const signals = [
    ...rows.map((a) => ({
      type: 'anomaly',
      id: a.id,
      kind: a.kind,
      severity: a.severity,
      title: a.kind,
      detail: a.evidence || a.description,
      amount: money(a.amount_micros, currency),
      date: a.date,
      transaction_id: a.transaction_id,
    })),
    ...increases.map((r) => ({
      type: 'recurring',
      id: `price:${r.id}`,
      kind: 'price_increase',
      severity: 'medium',
      title: r.canonical_merchant,
      detail: `Now ${fmtMicros(r.typical_amount_micros, currency)} per month, up from ${fmtMicros(r.previous_amount_micros ?? r.typical_amount_micros, currency)}.`,
      amount: money(
        r.typical_amount_micros - (r.previous_amount_micros ?? r.typical_amount_micros),
        currency,
      ),
      date: r.last_seen,
      merchant: r.canonical_merchant,
    })),
  ];
  return signals.sort(
    (a, b) =>
      (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3) ||
      b.date.localeCompare(a.date),
  );
}
export async function goals(db: Database, currency: string) {
  const rows = await all<{
    id: string;
    name: string;
    type: string;
    target_amount_micros: number;
    current_amount_micros: number;
    target_date: string | null;
    status: string;
  }>(db, 'SELECT * FROM goals WHERE currency=? ORDER BY target_date LIMIT 100', currency);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    target: money(r.target_amount_micros, currency),
    current: money(r.current_amount_micros, currency),
    progress: ratio(r.current_amount_micros, r.target_amount_micros),
    target_date: r.target_date,
    status: r.status,
  }));
}
export { reconcile };
export async function periodAttention(db: Database, p: Period, asOf = today()) {
  await ensureDerived(db);
  const month = monthPeriod(p.end_date, p.currency);
  const previousEnd = new Date(month.start_date);
  previousEnd.setUTCDate(0);
  const baselineStart = new Date(month.start_date);
  baselineStart.setUTCMonth(baselineStart.getUTCMonth() - 3);
  const daysInMonth = dayDiff(month.start_date, month.end_date) + 1;
  // A selected period that ends in the future (the current month's default range
  // does) must project from the days actually elapsed, not the whole month.
  const elapsedTo = [p.end_date, asOf, month.end_date].sort()[0];
  const daysElapsed = Math.min(daysInMonth, Math.max(1, dayDiff(month.start_date, elapsedTo) + 1));
  const [rows, current, totals] = await Promise.all([
    all<{ category_id: string; month: string; total: number }>(
      db,
      'SELECT category_id,substr(date,1,7) month,SUM(spending_micros) total FROM daily_category_totals WHERE currency=? AND date BETWEEN ? AND ? GROUP BY category_id,substr(date,1,7)',
      p.currency,
      baselineStart.toISOString().slice(0, 10),
      previousEnd.toISOString().slice(0, 10),
    ),
    all<{ category_id: string; total: number }>(
      db,
      'SELECT category_id,SUM(spending_micros) total FROM daily_category_totals WHERE currency=? AND date BETWEEN ? AND ? GROUP BY category_id',
      p.currency,
      month.start_date,
      elapsedTo,
    ),
    first<{ total: number }>(
      db,
      'SELECT COALESCE(SUM(spending_micros),0) total FROM daily_category_totals WHERE currency=? AND date BETWEEN ? AND ?',
      p.currency,
      month.start_date,
      elapsedTo,
    ),
  ]);
  const elapsedFraction = daysElapsed / daysInMonth;
  const confidence: 'low' | 'high' = daysElapsed < 5 ? 'low' : 'high';
  const threshold = p.currency === 'CAD' || p.currency === 'USD' ? 300_000_000 : undefined;
  const median = (values: number[]) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor((sorted.length - 1) / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid] + sorted[mid + 1]) / 2);
  };
  const category_signals =
    threshold === undefined
      ? []
      : current
          .flatMap((c) => {
            const history = rows.filter((r) => r.category_id === c.category_id).map((r) => r.total);
            const baseline = median(history);
            if (baseline === null) return [];
            const projected = safe((BigInt(c.total) * BigInt(daysInMonth)) / BigInt(daysElapsed));
            if (projected <= Math.max((baseline ?? 0) * 1.5, threshold)) return [];
            const ratio = baseline && baseline > 0 ? projected / baseline : null;
            const severity =
              ratio && ratio >= 2 ? 'high' : ratio && ratio >= 1.5 ? 'medium' : 'low';
            return [
              {
                kind: 'category_pace',
                category: c.category_id,
                projected_month_spending: money(projected, p.currency),
                historical_median: baseline === null ? null : money(baseline, p.currency),
                ratio_to_median: ratio,
                severity,
                confidence,
                elapsed_fraction: elapsedFraction,
                days_elapsed: daysElapsed,
                days_in_month: daysInMonth,
                spent_to_date: money(c.total, p.currency),
              },
            ];
          })
          .sort((a, b) => (b.ratio_to_median ?? 0) - (a.ratio_to_median ?? 0))
          .slice(0, 5);
  return {
    category_signals,
    pace: {
      month: month.start_date.slice(0, 7),
      total_spent: money(totals?.total ?? 0, p.currency),
      elapsed_fraction: elapsedFraction,
      days_elapsed: daysElapsed,
      days_in_month: daysInMonth,
      confidence,
    },
  };
}
export async function largestTransactions(db: Database, p: Period) {
  const rows = await all<{
    id: string;
    date: string;
    datetime: string | null;
    authorized_datetime: string | null;
    merchant: string;
    name: string;
    cashflow_amount_micros: number;
    currency: string;
    account_id: string;
    account_name: string | null;
    category_id: string;
    kind: string;
    pending: number;
    excluded: number;
    classification_source: string;
  }>(
    db,
    `SELECT t.id,t.date,t.datetime,t.authorized_datetime,t.merchant,t.name,t.cashflow_amount_micros,t.currency,t.account_id,COALESCE(a.custom_name,a.name) account_name,t.category_id,t.kind,t.pending,t.excluded,t.classification_source
       FROM effective_transactions t LEFT JOIN accounts a ON a.id=t.account_id
      WHERE t.date BETWEEN ? AND ? AND t.currency=? AND t.pending=0 AND t.excluded=0 AND t.kind='spending'
      ORDER BY t.cashflow_amount_micros LIMIT 10`,
    p.start_date,
    p.end_date,
    p.currency,
  );
  return rows.map(({ cashflow_amount_micros, ...r }) => ({
    ...r,
    amount: money(cashflow_amount_micros, p.currency),
    pending: !!r.pending,
    excluded: !!r.excluded,
  }));
}

export async function categoryDeltas(db: Database, p: Period) {
  const month = monthPeriod(p.end_date, p.currency);
  const baselineStart = new Date(month.start_date);
  baselineStart.setUTCMonth(baselineStart.getUTCMonth() - 3);
  const previousEnd = new Date(month.start_date);
  previousEnd.setUTCDate(0);
  const [history, current] = await Promise.all([
    all<{ category_id: string; month: string; total: number }>(
      db,
      'SELECT category_id,substr(date,1,7) month,SUM(spending_micros) total FROM daily_category_totals WHERE currency=? AND date BETWEEN ? AND ? GROUP BY category_id,substr(date,1,7)',
      p.currency,
      baselineStart.toISOString().slice(0, 10),
      previousEnd.toISOString().slice(0, 10),
    ),
    all<{ category_id: string; total: number }>(
      db,
      'SELECT category_id,SUM(spending_micros) total FROM daily_category_totals WHERE currency=? AND date BETWEEN ? AND ? GROUP BY category_id',
      p.currency,
      month.start_date,
      p.end_date,
    ),
  ]);
  const deltas: Record<string, number | null> = {};
  for (const row of current) {
    const totals = history
      .filter((r) => r.category_id === row.category_id)
      .map((r) => r.total)
      .sort((a, b) => a - b);
    const baseline = totals.length >= 3 ? totals[Math.floor((totals.length - 1) / 2)] : null;
    deltas[row.category_id] = baseline && baseline > 0 ? (row.total - baseline) / baseline : null;
  }
  return deltas;
}
export async function trends(db: Database, p: Period, months = 6, estimate = false) {
  const endMonth = p.end_date.slice(0, 7);
  const [financials, netWorthRows] = await Promise.all([
    all<{ month: string; income: number; spending: number; net: number }>(
      db,
      'SELECT month,income_micros income,spending_micros spending,net_cashflow_micros net FROM monthly_financial_metrics WHERE currency=? AND month<=? ORDER BY month DESC LIMIT ?',
      p.currency,
      endMonth,
      months,
    ),
    all<{ month: string; net_worth: number }>(
      db,
      `SELECT month,SUM(CASE WHEN type IN ('credit','loan') THEN -current ELSE current END) net_worth FROM (SELECT substr(b.observed_at,1,7) month,b.current_amount_micros current,a.type,ROW_NUMBER() OVER (PARTITION BY b.account_id,substr(b.observed_at,1,7) ORDER BY b.observed_at DESC) rn FROM balance_snapshots b JOIN accounts a ON a.id=b.account_id WHERE b.currency=? AND b.current_amount_micros IS NOT NULL) WHERE rn=1 GROUP BY month`,
      p.currency,
    ),
  ]);
  const netWorth = new Map(netWorthRows.map((r) => [r.month, r.net_worth]));
  const rows = financials
    .slice()
    .reverse()
    .map((m) => {
      const snap = netWorth.has(m.month);
      if (snap) return { ...m, net_worth: netWorth.get(m.month)! as number | null, estimated: false };
      // Between snapshots carry the last known value by cash flow; before the
      // first snapshot it is unknown unless the estimate is requested.
      return { ...m, net_worth: null as number | null, estimated: false };
    });
  let carried: number | null = null;
  for (const row of rows) {
    if (row.net_worth !== null) carried = row.net_worth;
    else if (carried !== null) {
      carried += row.net;
      row.net_worth = carried;
      row.estimated = true;
    }
  }
  if (estimate) {
    // Work backward from the first real snapshot: end-of-month net worth minus
    // that month's net cash flow approximates the prior month's value.
    const first = rows.findIndex((r) => r.net_worth !== null && !r.estimated);
    if (first > 0)
      for (let i = first - 1; i >= 0; i--) {
        rows[i].net_worth = (rows[i + 1].net_worth as number) - rows[i + 1].net;
        rows[i].estimated = true;
      }
  }
  return {
    months: rows.map((m) => ({
      month: m.month,
      income: m.income / 1_000_000,
      spending: m.spending / 1_000_000,
      net: m.net / 1_000_000,
      net_worth: m.net_worth === null ? null : m.net_worth / 1_000_000,
      estimated: m.estimated,
    })),
  };
}
export async function getSettings(db: Database) {
  const r = await first<{ estimate_net_worth: number }>(
    db,
    'SELECT estimate_net_worth FROM system_state WHERE id=1',
  );
  return { estimate_net_worth: !!r?.estimate_net_worth };
}
export async function balanceAttention(db: Database, p: Period) {
  const threshold = p.currency === 'CAD' || p.currency === 'USD' ? 300_000_000 : undefined;
  if (threshold === undefined) return [];
  const pairs = await all<{
    id: string;
    name: string;
    type: string;
    current: number;
    previous: number;
    observed_at: string;
    previous_at: string;
  }>(
    db,
    `SELECT a.id,COALESCE(a.custom_name,a.name) AS name,a.type,n.current_amount_micros current,b.current_amount_micros previous,n.observed_at,b.observed_at previous_at FROM accounts a JOIN balance_snapshots n ON n.id=(SELECT id FROM balance_snapshots WHERE account_id=a.id AND currency=? AND observed_at<=? ORDER BY observed_at DESC LIMIT 1) JOIN balance_snapshots b ON b.id=(SELECT id FROM balance_snapshots WHERE account_id=a.id AND currency=? AND observed_at<n.observed_at ORDER BY observed_at DESC LIMIT 1) WHERE a.currency=? AND n.current_amount_micros IS NOT NULL AND b.current_amount_micros IS NOT NULL AND substr(n.observed_at,1,10)>=?`,
    p.currency,
    p.end_date + 'T23:59:59.999Z',
    p.currency,
    p.currency,
    p.start_date,
  );
  const signals = [];
  for (const pair of pairs) {
    const source = await first<{ n: number }>(
      db,
      'SELECT COALESCE(SUM(cashflow_amount_micros),0) n FROM transactions WHERE account_id=? AND currency=? AND pending=0 AND is_removed=0 AND date BETWEEN ? AND ?',
      pair.id,
      p.currency,
      pair.previous_at.slice(0, 10),
      pair.observed_at.slice(0, 10),
    );
    const movement = safe(
      (pair.current - pair.previous) * (['credit', 'loan'].includes(pair.type) ? -1 : 1),
    );
    const unexplained = sum([movement, -(source?.n ?? 0)]);
    if (Math.abs(unexplained) > threshold)
      signals.push({
        kind: 'balance_movement',
        account_id: pair.id,
        account: pair.name,
        unexplained_movement: money(unexplained, p.currency),
        from: pair.previous_at,
        to: pair.observed_at,
        caveat:
          'Transaction dates and balance observation times may not align. Review source completeness before interpreting this signal.',
      });
  }
  return signals;
}
