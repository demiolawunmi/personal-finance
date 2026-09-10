import type { Transaction, EffectiveTransaction } from '../../packages/domain/transactions';
export function tx(id: string, amount: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    plaid_transaction_id: 'provider-' + id,
    account_id: 'checking',
    plaid_amount_micros: -amount,
    cashflow_amount_micros: amount,
    currency: 'CAD',
    date: '2026-09-08',
    authorized_date: null,
    name: 'Shop',
    merchant_name: 'Shop',
    original_description: null,
    plaid_primary_category: 'GENERAL_MERCHANDISE',
    plaid_detailed_category: 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
    pending: 0,
    pending_transaction_id: null,
    payment_channel: 'online',
    is_removed: 0,
    created_at: '2026-09-08T16:00:00.000Z',
    updated_at: '2026-09-08T16:00:00.000Z',
    ...overrides,
  };
}
export function effective(
  id: string,
  amount: number,
  overrides: Partial<EffectiveTransaction> = {},
): EffectiveTransaction {
  return {
    ...tx(id, amount),
    transaction_id: id,
    category_id: 'shopping',
    merchant: 'Shop',
    kind: 'spending',
    classification_source: 'provider',
    refund_of: null,
    excluded: 0,
    note: null,
    ...overrides,
  };
}
