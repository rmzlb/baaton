-- Migration 043: Backfill gamification data from activity_log
-- Populates user_daily_activity from existing activity entries so the
-- heatmap and velocity show historical data (not just post-deploy).

INSERT INTO user_daily_activity (user_id, org_id, activity_date, issues_created, issues_closed, comments_posted, tldrs_posted, status_changes, assignments, updates, tags_added, github_actions, total_actions)
SELECT
    a.user_id,
    a.org_id,
    DATE(a.created_at) AS activity_date,
    COUNT(*) FILTER (WHERE a.action IN ('created', 'issue_created'))   AS issues_created,
    COUNT(*) FILTER (WHERE a.action IN ('issue_closed', 'issue_archived')) AS issues_closed,
    COUNT(*) FILTER (WHERE a.action = 'commented')                     AS comments_posted,
    COUNT(*) FILTER (WHERE a.action = 'tldr')                          AS tldrs_posted,
    COUNT(*) FILTER (WHERE a.action = 'status_changed')                AS status_changes,
    COUNT(*) FILTER (WHERE a.action IN ('assigned', 'assignee_changed')) AS assignments,
    COUNT(*) FILTER (WHERE a.action IN ('updated', 'priority_changed', 'estimate_changed')) AS updates,
    COUNT(*) FILTER (WHERE a.action IN ('tagged', 'tag_added', 'tag_removed')) AS tags_added,
    0 AS github_actions,
    COUNT(*) AS total_actions
FROM activity_log a
WHERE a.user_id IS NOT NULL
  AND a.user_id != ''
  AND a.org_id IS NOT NULL
  AND a.org_id != ''
GROUP BY a.user_id, a.org_id, DATE(a.created_at)
ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
    issues_created = user_daily_activity.issues_created + EXCLUDED.issues_created,
    issues_closed  = user_daily_activity.issues_closed  + EXCLUDED.issues_closed,
    comments_posted = user_daily_activity.comments_posted + EXCLUDED.comments_posted,
    tldrs_posted   = user_daily_activity.tldrs_posted   + EXCLUDED.tldrs_posted,
    status_changes = user_daily_activity.status_changes + EXCLUDED.status_changes,
    assignments    = user_daily_activity.assignments    + EXCLUDED.assignments,
    updates        = user_daily_activity.updates        + EXCLUDED.updates,
    tags_added     = user_daily_activity.tags_added     + EXCLUDED.tags_added,
    total_actions  = user_daily_activity.total_actions  + EXCLUDED.total_actions;

-- Also backfill user_activity (streaks) — set basic data for users with activity
INSERT INTO user_activity (user_id, org_id, current_streak, longest_streak, last_active_date, best_day_count, best_week_count, updated_at)
SELECT
    user_id,
    org_id,
    1 AS current_streak,
    1 AS longest_streak,
    MAX(activity_date) AS last_active_date,
    MAX(total_actions) AS best_day_count,
    MAX(total_actions) AS best_week_count,
    now() AS updated_at
FROM user_daily_activity
GROUP BY user_id, org_id
ON CONFLICT (user_id, org_id) DO UPDATE SET
    last_active_date = EXCLUDED.last_active_date,
    best_day_count   = GREATEST(user_activity.best_day_count, EXCLUDED.best_day_count),
    best_week_count  = GREATEST(user_activity.best_week_count, EXCLUDED.best_week_count),
    updated_at       = now();
