export const SCOPES = [
  'finance:summary',
  'finance:transactions',
  'finance:reports',
  'finance:balances',
];
export type AuthProps = { userId: string; scopes: string[]; clientId: string };
export const TOOL_SCOPES: Record<string, string> = {
  get_financial_snapshot: 'finance:summary',
  get_spending_summary: 'finance:summary',
  get_category_breakdown: 'finance:summary',
  get_merchant_breakdown: 'finance:summary',
  search_transactions: 'finance:transactions',
  compare_periods: 'finance:summary',
  get_cashflow: 'finance:summary',
  get_recurring_expenses: 'finance:summary',
  get_budget_status: 'finance:summary',
  get_net_worth: 'finance:balances',
  get_anomalies: 'finance:transactions',
  get_financial_report: 'finance:reports',
  get_data_health: 'finance:summary',
};
