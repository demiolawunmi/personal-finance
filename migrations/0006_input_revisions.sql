-- Reports must be regenerated when any calculation input changes, including budgets and balances.
CREATE TRIGGER balances_insert_revision AFTER INSERT ON balance_snapshots BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER balances_delete_revision AFTER DELETE ON balance_snapshots BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER budgets_insert_revision AFTER INSERT ON budgets BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER budgets_update_revision AFTER UPDATE ON budgets BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER budget_lines_insert_revision AFTER INSERT ON budget_lines BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER budget_lines_delete_revision AFTER DELETE ON budget_lines BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER goals_insert_revision AFTER INSERT ON goals BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER goals_update_revision AFTER UPDATE ON goals BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER aliases_insert_revision AFTER INSERT ON merchant_aliases BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER aliases_update_revision AFTER UPDATE ON merchant_aliases BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE INDEX transaction_currency_date ON transactions(currency,date);
CREATE INDEX accounts_item ON accounts(plaid_item_id);
