import type { EffectiveTransaction } from '../domain/transactions';
import { dayDiff, addDays } from '../domain/periods';
import { safe } from '../domain/money';
export function median(ns: number[]) {
  const a = [...ns].sort((a, b) => a - b);
  if (!a.length) return 0;
  const middle = Math.floor(a.length / 2);
  return a.length % 2 ? a[middle] : safe((BigInt(a[middle - 1]) + BigInt(a[middle])) / 2n);
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
  return [...groups].flatMap(([id, rows]) => {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 3) return [];
    const gaps = rows.slice(1).map((r, i) => dayDiff(rows[i].date, r.date));
    const options = [
      ['weekly', 6, 8, 7, 52],
      ['biweekly', 12, 16, 14, 26],
      ['monthly', 25, 35, 30, 12],
      ['annual', 350, 380, 365, 1],
    ] as const;
    const match = options.find(
      ([, min, max]) => gaps.filter((g) => g >= min && g <= max).length / gaps.length >= 0.8,
    );
    if (!match) return [];
    const [frequency, , , days, perYear] = match;
    const amounts = rows.map((t) => -t.cashflow_amount_micros);
    const typical = median(amounts);
    const variance = typical ? Math.max(...amounts.map((a) => Math.abs(a - typical) / typical)) : 0;
    if (variance > 0.6) return [];
    const last = rows.at(-1)!;
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
    return [
      {
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
        confidence: variance < 0.15 ? 0.9 : 0.7,
        status: dayDiff(last.date, asOf) > days * 2 ? 'inactive' : 'active',
        first_seen: rows[0].date,
        last_seen: last.date,
        observations: rows.length,
      },
    ];
  });
}
