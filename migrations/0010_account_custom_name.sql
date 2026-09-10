-- Owner-facing account labels. Plaid refreshes `name` on every sync, so a custom
-- label lives in its own column and is never overwritten by ingestion.
ALTER TABLE accounts ADD COLUMN custom_name TEXT;
