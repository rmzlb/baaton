-- Add 'ai' as a valid issue source (used by backend agent orchestration)
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_source_check;
ALTER TABLE issues ADD CONSTRAINT issues_source_check 
    CHECK (source IN ('web', 'api', 'form', 'email', 'github', 'ai'));
