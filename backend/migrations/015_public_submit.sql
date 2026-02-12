-- Public issue intake settings
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS public_submit_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS public_submit_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS projects_public_submit_token_key
  ON projects(public_submit_token)
  WHERE public_submit_token IS NOT NULL;
