import type { Transaction, Annotation, Category, Rule, Alias, Fact } from '../domain/transactions';
import { dayDiff } from '../domain/periods';
export function normalizeMerchant(t: Transaction, aliases: Alias[] = []) {
  const raw = (t.merchant_name || t.name).trim();
  const alias = aliases.find((a) => raw.toLowerCase().includes(a.raw_pattern.toLowerCase()));
  if (alias) return alias.canonical_merchant;
  // Plaid reports both Uber Eats and Uber rides as merchant "Uber"; the raw
  // descriptor ("...UBEREATSTORON" vs "...UBERTRIPTORON") is the only signal.
  const descriptor = [t.merchant_name, t.name, t.original_description]
    .filter(Boolean)
    .join(' ');
  if (/uber\s*\*?\s*eats|ubereats/i.test(descriptor)) return 'Uber Eats';
  return raw
    .replace(/\s+\d{2}\/\d{2}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const primary: Record<string, string> = {
  INCOME: 'income',
  FOOD_AND_DRINK: 'dining',
  TRANSPORTATION: 'transportation',
  TRAVEL: 'travel',
  GENERAL_MERCHANDISE: 'shopping',
  ENTERTAINMENT: 'entertainment',
  MEDICAL: 'health',
  PERSONAL_CARE: 'personal_care',
  RENT_AND_UTILITIES: 'housing',
  BANK_FEES: 'financial_fees',
  HOME_IMPROVEMENT: 'housing',
  GENERAL_SERVICES: 'other',
  GOVERNMENT_AND_NON_PROFIT: 'other',
};
function providerCategory(t: Transaction) {
  const d = t.plaid_detailed_category ?? '';
  if (/GROCERIES/.test(d)) return 'groceries';
  if (/UTILITIES|ELECTRICITY|INTERNET|TELEPHONE|WATER|NATURAL_GAS/.test(d)) return 'utilities';
  if (/EDUCATION/.test(d)) return 'education';
  if (/INSURANCE/.test(d)) return 'insurance';
  if (/DONATIONS/.test(d)) return 'charity';
  if (/TAX_PAYMENT|TAXES/.test(d)) return 'taxes';
  if (/INVESTMENT|BROKERAGE/.test(d) && /TRANSFER/.test(t.plaid_primary_category ?? ''))
    return 'investments';
  // Generic external transfers are ambiguous; only specific money-movement evidence excludes them.
  if (/ACCOUNT_TRANSFER|SAVINGS|CREDIT_CARD_PAYMENT/.test(d)) return 'transfers';
  if (/CASH_ADVANCES_AND_LOANS/.test(d)) return 'transfers';
  if (/CASH_WITHDRAWAL|ATM/.test(d)) return 'cash';
  return primary[t.plaid_primary_category ?? ''] ?? 'other';
}
export function classify(
  transactions: Transaction[],
  annotations: Annotation[],
  rules: Rule[],
  categories: Category[],
  aliases: Alias[] = [],
) {
  const ann = new Map(annotations.map((a) => [a.transaction_id, a]));
  const cats = new Map(categories.map((c) => [c.id, c.type]));
  const sortedRules = [...rules].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
  const facts: Fact[] = transactions.map((t) => {
    const a = ann.get(t.id);
    const merchant = a?.merchant_override || normalizeMerchant(t, aliases);
    const r = sortedRules.find((r) => {
      const text = (
        r.field === 'merchant' ? merchant : t.original_description || t.name
      ).toLowerCase();
      const pattern = r.pattern.toLowerCase();
      return r.operator === 'equals' ? text === pattern : text.includes(pattern);
    });
    const category_id = a?.category_override_id || r?.category_id || providerCategory(t);
    const source = a?.category_override_id
      ? 'manual'
      : r
        ? `rule:${r.id}:v${r.version}`
        : 'provider';
    const type = cats.get(category_id) ?? 'spending';
    const refundSignal =
      /refund|reversal|return\b|reimburse|reimbursement|\bclaims?\b|correction/i.test(
        t.name + ' ' + (t.original_description ?? ''),
      ) || /REFUND/.test(t.plaid_detailed_category ?? '');
    const kind: Fact['kind'] =
      type === 'transfer'
        ? 'transfer'
        : type === 'income'
          ? 'income'
          : t.cashflow_amount_micros < 0
            ? 'spending'
            : refundSignal || a?.category_override_id
              ? 'refund'
              : 'unclassified_inflow';
    return {
      transaction_id: t.id,
      category_id,
      merchant,
      kind,
      classification_source: source,
      refund_of: null,
    };
  });
  const byId = new Map(facts.map((f) => [f.transaction_id, f]));
  const eligible = transactions.filter((t) => !t.pending && !t.is_removed);
  const transferSignal = (t: Transaction) =>
    /transfer|payment|autopay|savings/i.test(
      [t.name, t.original_description, t.plaid_primary_category, t.plaid_detailed_category].join(
        ' ',
      ),
    );
  const candidates = new Map<string, Transaction[]>();
  const buckets = new Map<string, Transaction[]>();
  const transferEligible = eligible.filter(
    (t) =>
      transferSignal(t) &&
      t.cashflow_amount_micros !== 0 &&
      !ann.get(t.id)?.category_override_id &&
      !byId.get(t.id)!.classification_source.startsWith('rule:'),
  );
  for (const t of transferEligible) {
    const key = JSON.stringify([t.currency, t.cashflow_amount_micros]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(t);
    buckets.set(key, bucket);
  }
  for (const t of transferEligible) {
    const opposite = buckets.get(JSON.stringify([t.currency, -t.cashflow_amount_micros])) ?? [];
    candidates.set(
      t.id,
      opposite.filter(
        (o) => o.account_id !== t.account_id && Math.abs(dayDiff(t.date, o.date)) <= 3,
      ),
    );
  }
  const pairs: {
    id: string;
    outgoing_transaction_id: string;
    incoming_transaction_id: string;
    confidence: number;
    detection_method: string;
    confirmed: number;
  }[] = [];
  for (const t of eligible.filter((t) => t.cashflow_amount_micros < 0)) {
    const matches = candidates.get(t.id) ?? [];
    if (matches.length !== 1) continue;
    const other = matches[0];
    if (candidates.get(other.id)?.length !== 1) continue;
    for (const id of [t.id, other.id])
      Object.assign(byId.get(id)!, {
        kind: 'transfer',
        category_id: 'transfers',
        classification_source: 'system:paired_transfer',
      });
    pairs.push({
      id: `${t.id}:${other.id}`,
      outgoing_transaction_id: t.id,
      incoming_transaction_id: other.id,
      confidence: 0.95,
      detection_method: 'unique_same_currency_opposite_amount_3d',
      confirmed: 0,
    });
  }
  const refunded = new Map<string, number>();
  const purchases = new Map<string, Transaction[]>();
  for (const t of eligible) {
    const f = byId.get(t.id)!;
    if (f.kind !== 'spending') continue;
    const key = JSON.stringify([t.currency, f.merchant.toLowerCase()]);
    const group = purchases.get(key) ?? [];
    group.push(t);
    purchases.set(key, group);
  }

  for (const t of [...eligible].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  )) {
    const f = byId.get(t.id)!;
    if (t.cashflow_amount_micros <= 0 || f.kind === 'transfer' || f.kind === 'income') continue;
    const matches = (purchases.get(JSON.stringify([t.currency, f.merchant.toLowerCase()])) ?? [])
      .filter((o) => {
        const of = byId.get(o.id)!;
        const elapsed = dayDiff(o.date, t.date);
        return (
          of.kind === 'spending' &&
          of.merchant.toLowerCase() === f.merchant.toLowerCase() &&
          o.currency === t.currency &&
          elapsed >= 0 &&
          elapsed <= 120 &&
          -o.cashflow_amount_micros - (refunded.get(o.id) ?? 0) >= t.cashflow_amount_micros
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    if (matches.length) {
      const original = matches[0];
      f.kind = 'refund';
      f.refund_of = original.id;
      if (!ann.get(t.id)?.category_override_id && !f.classification_source.startsWith('rule:'))
        f.category_id = byId.get(original.id)!.category_id;
      refunded.set(original.id, (refunded.get(original.id) ?? 0) + t.cashflow_amount_micros);
    }
  }
  // A reimbursement claim usually arrives from the insurer or benefits
  // administrator rather than the original provider, so it cannot match on
  // merchant. Link it to the most recent prior spending in a reimbursable
  // category that can still cover the amount.
  const reimbursable = new Set(['health', 'insurance']);
  const claimText = /reimburse|reimbursement|\bclaims?\b/i;
  for (const t of eligible.filter((t) => t.cashflow_amount_micros > 0)) {
    const f = byId.get(t.id)!;
    if (f.kind !== 'refund' || f.refund_of) continue;
    if (!claimText.test(t.name + ' ' + (t.original_description ?? ''))) continue;
    const matches = eligible
      .filter((o) => {
        const of = byId.get(o.id)!;
        const elapsed = dayDiff(o.date, t.date);
        return (
          of.kind === 'spending' &&
          reimbursable.has(of.category_id) &&
          o.currency === t.currency &&
          elapsed >= 0 &&
          elapsed <= 120 &&
          -o.cashflow_amount_micros - (refunded.get(o.id) ?? 0) >= t.cashflow_amount_micros
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    if (matches.length) {
      const original = matches[0];
      f.refund_of = original.id;
      if (!ann.get(t.id)?.category_override_id && !f.classification_source.startsWith('rule:'))
        f.category_id = byId.get(original.id)!.category_id;
      refunded.set(original.id, (refunded.get(original.id) ?? 0) + t.cashflow_amount_micros);
    }
  }
  return { facts, pairs };
}
