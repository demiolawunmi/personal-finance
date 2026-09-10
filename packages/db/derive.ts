import { all, first, stmt, insert, revision, auditStatement, type Database } from './repository';
import { classify } from '../classification/engine';
import { detectRecurring } from '../classification/recurring';
import { detectAnomalies } from '../analytics/anomalies';
import {
  CALCULATION_VERSION,
  type Transaction,
  type Annotation,
  type Rule,
  type Category,
  type Alias,
  type EffectiveTransaction,
} from '../domain/transactions';
import { today } from '../domain/periods';
export async function rebuild(db: Database, timezone = 'America/Toronto') {
  const before = await revision(db);
  const [transactions, annotations, rules, categories, aliases] = await Promise.all([
    all<Transaction>(db, 'SELECT * FROM transactions WHERE is_removed=0'),
    all<Annotation>(db, 'SELECT * FROM transaction_annotations'),
    all<Rule>(db, 'SELECT * FROM classification_rules WHERE active=1'),
    all<Category>(db, 'SELECT * FROM categories'),
    all<Alias>(db, 'SELECT * FROM merchant_aliases ORDER BY length(raw_pattern) DESC,id'),
  ]);
  const { facts, pairs } = classify(transactions, annotations, rules, categories, aliases);
  const fs = new Map(facts.map((f) => [f.transaction_id, f]));
  const an = new Map(annotations.map((a) => [a.transaction_id, a]));
  const effective = transactions.map((t) => ({
    ...t,
    ...fs.get(t.id)!,
    excluded: an.get(t.id)?.exclude_from_spending ?? 0,
    note: an.get(t.id)?.note ?? null,
  })) as EffectiveTransaction[];
  const recurring = detectRecurring(effective, today(timezone));
  const anomalies = detectAnomalies(effective, {
    recurringMerchants: new Set(recurring.map((r) => r.canonical_merchant)),
  });
  const fence = crypto.randomUUID();
  // All derived tables and their generation marker become visible together. A racing sync rolls this batch back.
  await db.batch([
    stmt(
      db,
      'INSERT INTO write_fences SELECT ?,CASE WHEN data_revision=? THEN 1 ELSE 0 END FROM system_state WHERE id=1',
      fence,
      before.data_revision,
    ),
    ...[
      'transaction_facts',
      'transfer_pairs',
      'recurring_series',
      'anomalies',
      'daily_category_totals',
      'daily_merchant_totals',
      'monthly_financial_metrics',
    ].map((t) => stmt(db, `DELETE FROM ${t}`)),
    ...facts.map((f) =>
      insert(db, 'transaction_facts', { ...f, calculation_version: CALCULATION_VERSION }),
    ),
    ...pairs.map((p) => insert(db, 'transfer_pairs', p)),
    ...recurring.map((r) => insert(db, 'recurring_series', r)),
    ...anomalies.map((a) => insert(db, 'anomalies', a)),
    stmt(
      db,
      `INSERT INTO daily_category_totals SELECT date,category_id,currency,SUM(CASE WHEN kind IN ('spending','refund') AND excluded=0 THEN -cashflow_amount_micros ELSE 0 END),SUM(CASE WHEN kind='income' THEN cashflow_amount_micros ELSE 0 END),COUNT(*) FROM effective_transactions WHERE pending=0 GROUP BY date,category_id,currency`,
    ),
    stmt(
      db,
      `INSERT INTO daily_merchant_totals SELECT date,merchant,currency,SUM(-cashflow_amount_micros),COUNT(*) FROM effective_transactions WHERE pending=0 AND excluded=0 AND kind IN ('spending','refund') GROUP BY date,merchant,currency`,
    ),
    stmt(
      db,
      `INSERT INTO monthly_financial_metrics SELECT substr(date,1,7),currency,SUM(income_micros),SUM(spending_micros),SUM(income_micros)-SUM(spending_micros),CASE WHEN SUM(income_micros)>0 THEN 1.0*(SUM(income_micros)-SUM(spending_micros))/SUM(income_micros) ELSE NULL END FROM daily_category_totals GROUP BY substr(date,1,7),currency`,
    ),
    stmt(db, 'UPDATE system_state SET derived_revision=? WHERE id=1', before.data_revision),
    stmt(db, 'DELETE FROM write_fences WHERE id=?', fence),
    auditStatement(db, 'AGGREGATES_REBUILT', 'system', null, 'system', {
      revision: before.data_revision,
    }),
  ]);
  return { revision: before.data_revision, transactions: transactions.length };
}
export async function ensureDerived(db: Database) {
  const r = await revision(db);
  if (r.data_revision !== r.derived_revision) throw new Error('DERIVED_DATA_REBUILDING');
  return r.data_revision;
}
export async function reconcile(db: Database) {
  const rows = await all<{ currency: string; source: number; derived: number }>(
    db,
    `SELECT c.currency,COALESCE((SELECT SUM(CASE WHEN t.kind IN ('spending','refund') AND t.excluded=0 THEN -t.cashflow_amount_micros ELSE 0 END) FROM effective_transactions t WHERE t.currency=c.currency AND t.pending=0),0) source,COALESCE((SELECT SUM(spending_micros) FROM daily_category_totals d WHERE d.currency=c.currency),0) derived FROM (SELECT DISTINCT currency FROM transactions) c`,
  );
  const invalid = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) n FROM transfer_pairs p JOIN transactions a ON a.id=p.outgoing_transaction_id JOIN transactions b ON b.id=p.incoming_transaction_id WHERE a.cashflow_amount_micros<>-b.cashflow_amount_micros OR a.currency<>b.currency OR a.account_id=b.account_id`,
  );
  const rev = await revision(db);
  return {
    ok:
      rows.every((r) => r.source === r.derived) &&
      !invalid?.n &&
      rev.data_revision === rev.derived_revision,
    currencies: rows.map((r) => ({ currency: r.currency, matches: r.source === r.derived })),
    invalid_transfer_pairs: invalid?.n ?? 0,
    ...rev,
  };
}
