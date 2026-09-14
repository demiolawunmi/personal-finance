-- Institution branding pulled from Plaid's optional institution metadata.
ALTER TABLE plaid_items ADD COLUMN logo TEXT;
ALTER TABLE plaid_items ADD COLUMN primary_color TEXT;

-- Owner-managed visibility: closed accounts can be hidden from the dashboard.
ALTER TABLE accounts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
