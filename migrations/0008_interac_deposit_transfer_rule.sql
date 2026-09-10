-- Incoming Interac e-transfers arrive from external parties and cannot be paired
-- to an internal leg, so they were surfacing as unclassified inflows. Treat the
-- deposit leg as a transfer so it is excluded from cash-flow totals. The pattern
-- is direction-specific: it matches "DEPOSIT FREE INTERAC E-TRANSFER" but not the
-- outgoing "WITHDRAWAL FREE INTERAC E-TRANSFER".
INSERT INTO classification_rules (id, field, operator, pattern, category_id, priority, version, active, updated_at)
VALUES ('interac-deposit-transfer', 'merchant', 'contains', 'DEPOSIT FREE INTERAC', 'transfers', 10, 1, 1, '2026-09-10T00:00:00.000Z');

-- The insert above bumps data_revision via a trigger. On a freshly migrated,
-- empty database the derived tables are legitimately empty, so mark them
-- current. A database with source rows is left stale on purpose: the queued
-- rebuild recomputes derived facts (see docs/runbook.md).
UPDATE system_state
SET derived_revision=data_revision
WHERE id=1 AND NOT EXISTS(SELECT 1 FROM transactions WHERE is_removed=0);

