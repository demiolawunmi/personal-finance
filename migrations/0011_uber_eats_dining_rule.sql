-- Plaid reports Uber Eats and Uber rides under the same merchant with the same
-- Plaid category, so the ride-share default (Transportation) would swallow food
-- delivery. The classifier normalises the delivery descriptor to "Uber Eats";
-- route it to Dining.
INSERT INTO classification_rules (id, field, operator, pattern, category_id, priority, version, active, updated_at)
VALUES ('uber-eats-dining', 'merchant', 'equals', 'Uber Eats', 'dining', 15, 1, 1, '2026-09-10T00:00:00.000Z');

-- Keep a freshly migrated, empty database consistent; a populated database
-- rebuilds the derived tables (see docs/runbook.md).
UPDATE system_state
SET derived_revision=data_revision
WHERE id=1 AND NOT EXISTS(SELECT 1 FROM transactions WHERE is_removed=0);
