-- 073: per-project chat notification settings.
--
-- ## Why this is a table and not an env var
--
-- `issue_created` and the status-change notice added alongside it announced
-- *every* event: creating a ticket, and every transition including
-- `todo -> in_progress` on a ticket you just opened. A room that fires on
-- everything gets muted within days, and a muted room is worse than no
-- integration because it looks like coverage while delivering none.
--
-- The filter therefore has to be tunable by the person reading the room, at the
-- moment they notice the noise. Putting it in the environment means editing
-- Dokploy and redeploying the API to change one's mind about a status, so in
-- practice nobody tunes it and the room stays noisy. It lives in the DB so the
-- project settings UI can own it.
--
-- ## Shape
--
-- `notify_statuses` holds status *keys* (`projects.statuses[].key`), not labels:
-- labels are renameable free text, keys are the stable identifier issues are
-- stored against. Renaming "Not OK" to "Rejeté" must not silently disable the
-- notification.
--
-- Default `["backlog","not_ok"]`: the two transitions that mean work came back
-- and needs a human. `done` is deliberately absent — completion is pleasant but
-- not actionable, and every non-actionable line spends the room's attention.
-- Projects that disagree change it in their settings.
--
-- An empty array is a valid, meaningful value: it means "no status
-- notifications", so the column is NOT NULL and the code must not treat empty
-- as unset-and-fall-back-to-default.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS notify_statuses JSONB NOT NULL DEFAULT '["backlog","not_ok"]',
  -- Comment notifications are opt-in per project and default on: a comment is
  -- someone talking to you, which is the most actionable event of the three.
  -- Self-authored comments are filtered in code, not here, because that depends
  -- on the caller's identity rather than on project config.
  ADD COLUMN IF NOT EXISTS notify_comments BOOLEAN NOT NULL DEFAULT true,
  -- Creation notices predate this table and were unconditional. Keep them on so
  -- this migration changes no existing behaviour, but make them switchable for
  -- the same reason as the rest.
  ADD COLUMN IF NOT EXISTS notify_issue_created BOOLEAN NOT NULL DEFAULT true;

-- Guard the shape at the storage layer: a malformed value here silently kills
-- notifications for a project, which is a failure nobody notices until they
-- needed the alert.
--
-- Only the outer type is checked. Postgres forbids subqueries in CHECK, so
-- "every element is a string" cannot be expressed here without a function, and
-- an immutable helper function for one column is more machinery than the risk
-- deserves: the only writer is `update_notification_settings`, which validates
-- each key against the project's own workflow and rejects unknown ones with a
-- 400. This constraint exists to stop a hand-written UPDATE from storing an
-- object or a bare string, which is the mistake that would break reads.
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_notify_statuses_is_string_array;
ALTER TABLE projects
  ADD CONSTRAINT projects_notify_statuses_is_array CHECK (
    jsonb_typeof(notify_statuses) = 'array'
  );
