CREATE TABLE categories (
 id TEXT PRIMARY KEY, parent_id TEXT REFERENCES categories(id), slug TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('spending','income','transfer')), is_spending INTEGER NOT NULL, is_income INTEGER NOT NULL, is_transfer INTEGER NOT NULL,
 CHECK(is_spending+is_income+is_transfer=1)
);
CREATE TABLE transaction_annotations (
 transaction_id TEXT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
 merchant_override TEXT, category_override_id TEXT REFERENCES categories(id), essentiality_override TEXT CHECK(essentiality_override IN ('essential','discretionary')),
 exclude_from_spending INTEGER NOT NULL DEFAULT 0, exclude_reason TEXT, note TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE classification_rules (
 id TEXT PRIMARY KEY, field TEXT NOT NULL CHECK(field IN ('merchant','description')), operator TEXT NOT NULL CHECK(operator IN ('equals','contains')),
 pattern TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), priority INTEGER NOT NULL DEFAULT 100,
 version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE merchant_aliases (id TEXT PRIMARY KEY, raw_pattern TEXT NOT NULL, canonical_merchant TEXT NOT NULL, confidence REAL NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE transaction_facts (
 transaction_id TEXT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE, category_id TEXT NOT NULL REFERENCES categories(id),
 merchant TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('spending','income','transfer','refund','unclassified_inflow')),
 classification_source TEXT NOT NULL, refund_of TEXT REFERENCES transactions(id) ON DELETE SET NULL, calculation_version TEXT NOT NULL
);
CREATE INDEX facts_category ON transaction_facts(category_id);
CREATE TABLE transfer_pairs (
 id TEXT PRIMARY KEY, outgoing_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
 incoming_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
 confidence REAL NOT NULL, detection_method TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0,
 CHECK(outgoing_transaction_id<>incoming_transaction_id)
);
CREATE TRIGGER annotations_insert_revision AFTER INSERT ON transaction_annotations BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER annotations_update_revision AFTER UPDATE ON transaction_annotations BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER annotations_delete_revision AFTER DELETE ON transaction_annotations BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER rules_insert_revision AFTER INSERT ON classification_rules BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
CREATE TRIGGER rules_update_revision AFTER UPDATE ON classification_rules BEGIN UPDATE system_state SET data_revision=data_revision+1 WHERE id=1; END;
INSERT INTO categories(id,slug,display_name,type,is_spending,is_income,is_transfer) VALUES
('income','income','Income','income',0,1,0),('housing','housing','Housing','spending',1,0,0),('utilities','utilities','Utilities','spending',1,0,0),
('groceries','groceries','Groceries','spending',1,0,0),('dining','dining','Dining','spending',1,0,0),('transportation','transportation','Transportation','spending',1,0,0),
('shopping','shopping','Shopping','spending',1,0,0),('entertainment','entertainment','Entertainment','spending',1,0,0),('travel','travel','Travel','spending',1,0,0),
('education','education','Education','spending',1,0,0),('health','health','Health','spending',1,0,0),('personal_care','personal_care','Personal care','spending',1,0,0),
('subscriptions','subscriptions','Subscriptions','spending',1,0,0),('financial_fees','financial_fees','Financial fees','spending',1,0,0),('insurance','insurance','Insurance','spending',1,0,0),
('gifts','gifts','Gifts','spending',1,0,0),('charity','charity','Charity','spending',1,0,0),('taxes','taxes','Taxes','spending',1,0,0),('cash','cash','Cash withdrawals','spending',1,0,0),
('transfers','transfers','Transfers','transfer',0,0,1),('investments','investments','Investment contributions','transfer',0,0,1),('other','other','Other','spending',1,0,0);
