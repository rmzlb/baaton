-- 056: Allow `post_run_comment` job_type in github_sync_jobs.
-- The runner consumes this to upsert a PR comment for completed public agent runs.

DO $$
BEGIN
  ALTER TABLE github_sync_jobs DROP CONSTRAINT IF EXISTS github_sync_jobs_job_type_check;
  ALTER TABLE github_sync_jobs
    ADD CONSTRAINT github_sync_jobs_job_type_check
    CHECK (job_type IN (
        'sync_issue_to_github',
        'sync_issue_from_github',
        'sync_pr',
        'sync_comment_to_github',
        'sync_comment_from_github',
        'sync_status',
        'initial_import',
        'full_resync',
        'post_run_comment'
    ));
END $$;
