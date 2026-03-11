-- Add GitHub repo URL and cached metadata to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_metadata JSONB;
-- github_metadata stores: { language, stars, forks, open_issues, description, default_branch, topics, is_private, updated_at, fetched_at }
