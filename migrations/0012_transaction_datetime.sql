-- Preserve the transaction time-of-day when the institution provides it. Plaid
-- sends `datetime` / `authorized_datetime` (ISO 8601) for many institutions but
-- not all, so both columns are nullable. The UI falls back to the calendar date.
ALTER TABLE transactions ADD COLUMN datetime TEXT;
ALTER TABLE transactions ADD COLUMN authorized_datetime TEXT;
