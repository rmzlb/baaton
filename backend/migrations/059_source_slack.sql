-- 059: Allow Slack as an issue source

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_source_check;
ALTER TABLE issues ADD CONSTRAINT issues_source_check
CHECK (source IN ('web', 'api', 'form', 'email', 'github', 'ai', 'slack'));
