-- "PRES/" is the acquirer descriptor for PRESTO, the Ontario transit card, so
-- normalize it to a single merchant and classify those charges as Transportation.
-- Correction inflows then reconcile against the transit charges because the
-- engine treats a "correction" inflow as a refund and links it to the original.
INSERT INTO merchant_aliases (id, raw_pattern, canonical_merchant, confidence, source, created_at)
VALUES ('pres-to-presto', 'PRES/', 'PRESTO', 0.99, 'manual', '2026-09-10T00:00:00.000Z');

INSERT INTO classification_rules (id, field, operator, pattern, category_id, priority, version, active, updated_at)
VALUES ('presto-transportation', 'merchant', 'equals', 'PRESTO', 'transportation', 20, 1, 1, '2026-09-10T00:00:00.000Z');

-- The inserts above bump data_revision via triggers. Keep a freshly migrated,
-- empty database consistent; a populated database rebuilds the derived tables.
UPDATE system_state
SET derived_revision=data_revision
WHERE id=1 AND NOT EXISTS(SELECT 1 FROM transactions WHERE is_removed=0);
