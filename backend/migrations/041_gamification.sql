-- Migration 041: Activity tracking — streaks, daily activity heatmap, personal bests

CREATE TABLE IF NOT EXISTS user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    current_streak INT NOT NULL DEFAULT 0,
    longest_streak INT NOT NULL DEFAULT 0,
    last_active_date DATE,
    best_day_count INT NOT NULL DEFAULT 0,
    best_week_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_activity_user_org ON user_activity(user_id, org_id);

-- Daily activity counts for heatmap (GitHub contribution graph style)
CREATE TABLE IF NOT EXISTS user_daily_activity (
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    activity_date DATE NOT NULL,
    issues_created INT NOT NULL DEFAULT 0,
    issues_closed INT NOT NULL DEFAULT 0,
    comments_posted INT NOT NULL DEFAULT 0,
    tldrs_posted INT NOT NULL DEFAULT 0,
    total_actions INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, org_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_activity_date ON user_daily_activity(user_id, org_id, activity_date DESC);
