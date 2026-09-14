-- Owner preference: reconstruct pre-snapshot net worth from monthly cash flow.
-- Off by default because the reconstructed points are estimates.
ALTER TABLE system_state ADD COLUMN estimate_net_worth INTEGER NOT NULL DEFAULT 0;
