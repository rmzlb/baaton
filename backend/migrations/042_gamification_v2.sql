-- Migration 042: Gamification v2 — unified activity tracking
-- Adds new action-type counters so ALL actions (not just issue_close) count toward velocity.

ALTER TABLE user_daily_activity
  ADD COLUMN IF NOT EXISTS status_changes INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assignments    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updates        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags_added     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS github_actions INT NOT NULL DEFAULT 0;
