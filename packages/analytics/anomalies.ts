import type { EffectiveTransaction } from '../domain/transactions';

/** Anomaly detection.
 *
 *  Design principles borrowed from conservative production detectors
 *  (Banksync, YNAB's detect_anomalies, Refund Radar): every finding cites the
 *  numbers behind it, findings are severity-tagged, low-value daily habits are
 *  suppressed, known recurring merchants are exempt from amount spikes, and a
 *  single transaction yields at most one alert (highest severity wins). The
 *  detector never asserts fraud — it surfaces "unusual" and lets the owner
 *  triage. */
export type Severity = 'low' | 'medium' | 'high';
export type DetectedAnomaly = {
  id: string;
  transaction_id: string;
  kind: string;
  severity: Severity;
  currency: string;
  amount_micros: number;
  date: string;
  description: string;
  evidence: string;
  score: number;
  rules: string;
};

const DOLLAR = 1_000_000;
const WINDOW_48H = 48 * 3600 * 1000;
const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };
const LOW_VALUE_CATEGORIES = new Set(['restaurants', 'transport', 'entertainment']);

export type AnomalyOptions = {
  /** First-charge high-dollar trigger per currency, in micros. */
  thresholds?: Record<string, number>;
  /** Merchants recognised as recurring; exempt from amount-spike alerts. */
  recurringMerchants?: Set<string>;
};

export function detectAnomalies(
  rows: EffectiveTransaction[],
  options: AnomalyOptions = {},
): DetectedAnomaly[] {
  const thresholds = options.thresholds ?? { CAD: 500 * DOLLAR, USD: 500 * DOLLAR };
  const recurring = options.recurringMerchants ?? new Set<string>();
  const settled = rows
    .filter((t) => !t.pending && !t.is_removed && !t.excluded)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const history = new Map<string, number[]>();
  const lastSeen = new Map<string, number>();
  // A pair (merchant, account, amount) seen more than twice is a habit, not a
  // duplicate. Pre-count so daily routines never flood the feed.
  const occurrences = new Map<string, number>();
  for (const t of settled) {
    if (t.kind !== 'spending') continue;
    const amount = -t.cashflow_amount_micros;
    if (amount <= 0) continue;
    const key = `${t.currency}|${t.merchant}|${t.account_id}|${amount}`;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const out: DetectedAnomaly[] = [];

  for (const t of settled) {
    const merchantKey = `${t.currency}|${t.merchant}`;
    const prior = history.get(merchantKey) ?? [];
    const amount = -t.cashflow_amount_micros;
    const candidates: {
      kind: string;
      severity: Severity;
      score: number;
      description: string;
      evidence: string;
      rules: string;
    }[] = [];

    if (t.kind === 'spending' && amount > 0) {
      const at = Date.parse(t.date + 'T12:00:00Z');
      const duplicateKey = `${merchantKey}|${t.account_id}|${amount}`;
      const previous = lastSeen.get(duplicateKey);
      const habit = (occurrences.get(duplicateKey) ?? 0) > 2;
      const lowValue = LOW_VALUE_CATEGORIES.has(t.category_id) && amount < 30 * DOLLAR;
      if (
        previous !== undefined &&
        at - previous > 0 &&
        at - previous <= WINDOW_48H &&
        !habit &&
        !lowValue
      ) {
        const severity: Severity = amount >= 200 * DOLLAR ? 'high' : 'medium';
        candidates.push({
          kind: 'duplicate_candidate',
          severity,
          score: amount + (severity === 'high' ? 5e8 : 2e8),
          description: `Possible duplicate at ${t.merchant}; the same amount posted twice within 48 hours.`,
          evidence: `${money(amount, t.currency)} matched an identical charge ${hoursBetween(previous, at)}h earlier on the same account.`,
          rules: 'duplicate_48h',
        });
      }
      lastSeen.set(duplicateKey, at);

      if (prior.length >= 5 && !recurring.has(t.merchant)) {
        const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
        const variance = prior.reduce((a, b) => a + (b - mean) ** 2, 0) / prior.length;
        const scale = Math.max(Math.sqrt(variance), Math.max(mean * 0.1, 5 * DOLLAR));
        const z = (amount - mean) / scale;
        if (z > 3 && amount - mean >= 50 * DOLLAR) {
          const severity: Severity = z > 5 || amount > mean * 4 ? 'high' : 'medium';
          candidates.push({
            kind: 'unusual_amount',
            severity,
            score: amount + z * 1e7,
            description: `${t.merchant} charge is far above this merchant's typical amount.`,
            evidence: `${money(amount, t.currency)} is ${z.toFixed(1)}σ above a ${money(Math.round(mean), t.currency)} average across ${prior.length} prior charges.`,
            rules: 'amount_spike_3sigma',
          });
        }
      }

      if (prior.length === 0) {
        const threshold = thresholds[t.currency];
        if (threshold !== undefined && amount >= threshold) {
          const severity: Severity = amount >= 2000 * DOLLAR ? 'high' : 'medium';
          candidates.push({
            kind: 'large_new_merchant',
            severity,
            score: amount,
            description: `First charge ever from ${t.merchant}.`,
            evidence: `${money(amount, t.currency)} from ${t.merchant} with no prior history, above the ${money(threshold, t.currency)} new-merchant threshold.`,
            rules: 'new_merchant_high_dollar',
          });
        }
      }

      const haystack = `${t.merchant} ${t.name}`;
      if (
        /\b(FEE|ATM|OVERDRAFT|INTEREST|SERVICE CHARGE|LATE)\b/i.test(haystack) &&
        amount >= 3 * DOLLAR
      ) {
        const hard = /\b(OVERDRAFT|LATE)\b/i.test(haystack);
        const severity: Severity = hard ? 'high' : amount >= 10 * DOLLAR ? 'medium' : 'low';
        candidates.push({
          kind: 'fee',
          severity,
          score: amount + 1e8,
          description: `Possible fee: ${t.merchant}.`,
          evidence: `${money(amount, t.currency)} labelled "${t.name}".`,
          rules: 'fee_like',
        });
      }
    }

    if (candidates.length) {
      candidates.sort(
        (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.score - a.score,
      );
      const best = candidates[0];
      const matched = candidates.map((c) => c.rules);
      out.push({
        id: `${best.kind}:${t.id}`,
        transaction_id: t.id,
        kind: best.kind,
        severity: best.severity,
        currency: t.currency,
        amount_micros: amount,
        date: t.date,
        description: best.description,
        evidence:
          best.evidence +
          (matched.length > 1 ? ` Also matched ${matched.slice(1).join(', ')}.` : ''),
        score: best.score,
        rules: matched.join(','),
      });
    }

    prior.push(amount);
    history.set(merchantKey, prior);
  }

  return out.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.date.localeCompare(a.date) ||
      a.kind.localeCompare(b.kind),
  );
}

const formatters: Record<string, Intl.NumberFormat> = {};
function money(micros: number, currency: string): string {
  if (!formatters[currency])
    formatters[currency] = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return formatters[currency].format(micros / DOLLAR);
}
function hoursBetween(from: number, to: number): number {
  return Math.max(1, Math.round((to - from) / 3600000));
}
