PRAGMA foreign_keys = ON;
CREATE TABLE plaid_items (
 id TEXT PRIMARY KEY, plaid_item_id TEXT NOT NULL UNIQUE, institution_id TEXT, institution_name TEXT NOT NULL,
 access_token_ciphertext TEXT, access_token_iv TEXT, key_version TEXT,
 sync_cursor TEXT, status TEXT NOT NULL DEFAULT 'healthy' CHECK(status IN ('healthy','error','reauth_required','disconnected')),
 last_successful_sync_at TEXT, last_webhook_at TEXT, history_complete INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, disconnected_at TEXT,
 CHECK((access_token_ciphertext IS NULL) = (access_token_iv IS NULL))
);
CREATE TABLE accounts (
 id TEXT PRIMARY KEY, plaid_account_id TEXT NOT NULL UNIQUE, plaid_item_id TEXT NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
 name TEXT NOT NULL, official_name TEXT, type TEXT NOT NULL, subtype TEXT, currency TEXT NOT NULL,
 mask TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE balance_snapshots (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 current_amount_micros INTEGER, available_amount_micros INTEGER, limit_amount_micros INTEGER,
 currency TEXT NOT NULL, observed_at TEXT NOT NULL, source_updated_at TEXT,
 UNIQUE(account_id,observed_at)
);
CREATE INDEX balance_account_date ON balance_snapshots(account_id,observed_at);
CREATE TABLE transactions (
 id TEXT PRIMARY KEY, plaid_transaction_id TEXT NOT NULL UNIQUE,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 plaid_amount_micros INTEGER NOT NULL CHECK(abs(plaid_amount_micros) <= 9007199254740991),
 cashflow_amount_micros INTEGER NOT NULL CHECK(cashflow_amount_micros = -plaid_amount_micros),
 currency TEXT NOT NULL, date TEXT NOT NULL, authorized_date TEXT,
 name TEXT NOT NULL, merchant_name TEXT, original_description TEXT,
 plaid_primary_category TEXT, plaid_detailed_category TEXT,
 pending INTEGER NOT NULL CHECK(pending IN (0,1)), pending_transaction_id TEXT,
 payment_channel TEXT, is_removed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX transactions_account_date ON transactions(account_id,date);
CREATE INDEX transactions_date ON transactions(date);
CREATE INDEX transactions_merchant_date ON transactions(merchant_name,date);
CREATE INDEX transactions_pending_date ON transactions(pending,date);
CREATE INDEX transactions_pending_id ON transactions(pending_transaction_id);
CREATE TABLE sync_runs (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
 started_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL, added INTEGER DEFAULT 0, modified INTEGER DEFAULT 0, removed INTEGER DEFAULT 0, error_code TEXT
);
-- Expiring lease plus a transactional write fence protects against overlapping deliveries.
CREATE TABLE sync_leases (item_id TEXT PRIMARY KEY REFERENCES plaid_items(id) ON DELETE CASCADE, owner TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE write_fences (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid = 1));
CREATE TABLE system_state (id INTEGER PRIMARY KEY CHECK(id=1), data_revision INTEGER NOT NULL DEFAULT 0, derived_revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO system_state(id) VALUES(1);
CREATE TRIGGER transactions_insert_revision AFTER INSERT ON transactions BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER transactions_update_revision AFTER UPDATE ON transactions BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER transactions_delete_revision AFTER DELETE ON transactions BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
