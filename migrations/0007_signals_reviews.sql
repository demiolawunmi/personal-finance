-- Anomaly detection gains severity, evidence and a stable dedupe key.
-- The anomalies table itself is fully rebuilt on every derive; review state
-- therefore lives in a separate table keyed by the deterministic anomaly id
-- so that a rebuild does not erase a user's triage decisions.
ALTER TABLE anomalies ADD COLUMN severity TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE anomalies ADD COLUMN evidence TEXT;
ALTER TABLE anomalies ADD COLUMN score REAL;
ALTER TABLE anomalies ADD COLUMN rules TEXT;

CREATE TABLE anomaly_reviews (
  anomaly_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('reviewed', 'dismissed', 'open')),
  note TEXT,
  reviewed_at TEXT NOT NULL
);

CREATE INDEX anomalies_kind_date ON anomalies(kind, date);
CREATE INDEX anomalies_transaction ON anomalies(transaction_id);
