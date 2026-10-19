-- 081: Allow recurring rules as an issue source.
-- recurring::trigger inserts issues with source = 'recurring', which the
-- check constraint from 059 rejected, so every manual trigger answered 500.
-- NOT VALID: new rows are checked, existing rows are not rescanned, so a
-- legacy value elsewhere cannot make this migration fail at startup.

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_source_check;
ALTER TABLE issues ADD CONSTRAINT issues_source_check
CHECK (source IN ('web', 'api', 'form', 'email', 'github', 'ai', 'slack', 'recurring')) NOT VALID;
