-- SLA as an accumulated clock instead of wall-clock since creation.
--
-- Problem: the SLA was computed as `created_at + budget(priority)` and only
-- stopped on done/cancelled. Two consequences:
--   1. `in_review` kept burning budget, even though the work is finished and
--      the ball is in the requester's court (307 issues in that state in prod).
--   2. Reopening (in_review -> not_ok) could never recover: the anchor stayed
--      on created_at, so the issue was breached forever.
--
-- Model: the SLA measures time where the ball is in OUR court, not calendar
-- time. Same semantics as Zendesk's "requester wait time" (pauses on Pending,
-- and on reopen reactivates the same target with the elapsed time preserved)
-- and Linear's SLA behaviour on "needs info" states.
--
-- Three status regimes:
--   running : backlog, todo, in_progress, not_ok  -> clock ticks
--   paused  : in_review                           -> clock frozen
--   stopped : status_category completed/canceled  -> clock final
--
-- Storage: an accumulator + an open-segment marker, so a reopen resumes where
-- it stopped instead of resetting or staying breached.
--   sla_elapsed_ms       = budget consumed during all CLOSED running segments
--   sla_clock_started_at = start of the current OPEN running segment (NULL when
--                          paused/stopped). Live elapsed = sla_elapsed_ms +
--                          (now() - sla_clock_started_at).
--
-- `sla_deadline` keeps its meaning (absolute timestamp to compare against
-- now()) but is now derived from the remaining budget and is NULL while the
-- clock is not running. `sla_breached` becomes sticky: once failed, always
-- failed, like Linear's Failed state.

ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS sla_elapsed_ms       BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sla_clock_started_at TIMESTAMPTZ;

-- ── Backfill: replay status history from activity_log ─────
--
-- activity_log holds every status_changed event with old_value/new_value, so
-- the real per-status durations are recoverable exactly rather than estimated.
-- Status labels are normalized (old rows may hold 'In Review' instead of
-- 'in_review' since migrations 066/067 renamed labels).
WITH sc AS (
    SELECT
        issue_id,
        created_at AS at,
        old_value,
        new_value,
        lead(created_at) OVER (PARTITION BY issue_id ORDER BY created_at, id) AS next_at,
        row_number() OVER (PARTITION BY issue_id ORDER BY created_at, id)     AS rn
    FROM activity_log
    WHERE action = 'status_changed'
      AND issue_id IS NOT NULL
      AND new_value IS NOT NULL
      AND new_value <> ''
),
segs AS (
    -- Segment from issue creation up to the first recorded status change,
    -- spent in that change's old_value.
    SELECT s.issue_id, COALESCE(s.old_value, 'backlog') AS status,
           i.created_at AS from_ts, s.at AS to_ts
    FROM sc s
    JOIN issues i ON i.id = s.issue_id
    WHERE s.rn = 1
    UNION ALL
    -- One segment per status change, ending at the next change (or now()).
    SELECT s.issue_id, s.new_value AS status,
           s.at AS from_ts, COALESCE(s.next_at, now()) AS to_ts
    FROM sc s
),
acc AS (
    SELECT
        g.issue_id,
        COALESCE(sum(
            GREATEST(0, EXTRACT(EPOCH FROM (LEAST(g.to_ts, now()) - g.from_ts)) * 1000)
        ), 0)::bigint AS elapsed_ms
    FROM segs g
    JOIN issues i ON i.id = g.issue_id
    WHERE lower(replace(btrim(g.status), ' ', '_')) NOT IN
              ('in_review', 'done', 'cancelled', 'canceled')
      -- Exclude the still-open segment: it is represented by
      -- sla_clock_started_at, counting it here would double it.
      AND g.to_ts <= COALESCE(i.status_changed_at, i.created_at) + interval '1 second'
    GROUP BY g.issue_id
)
UPDATE issues i
SET sla_elapsed_ms = a.elapsed_ms
FROM acc a
WHERE i.id = a.issue_id;

-- Open the clock for issues currently in a running status. Issues with no
-- status_changed history keep elapsed = 0 and start from created_at, which is
-- correct: they never left their initial status.
UPDATE issues
SET sla_clock_started_at = CASE
        WHEN COALESCE(status_category, '') IN ('completed', 'canceled') THEN NULL
        WHEN lower(replace(btrim(status), ' ', '_')) IN
             ('in_review', 'done', 'cancelled', 'canceled') THEN NULL
        ELSE COALESCE(status_changed_at, created_at)
    END;

-- ── Derive sla_deadline / sla_breached from the accumulator ──
-- Default budgets mirror the values the frontend has been using (urgent 24h,
-- high 48h, everything else 120h); per-project sla_rules override them when
-- present. Kept in sync by recompute_sla() in the backend from now on.
WITH budget AS (
    SELECT
        i.id,
        i.sla_elapsed_ms,
        i.sla_clock_started_at,
        COALESCE(
            r.deadline_hours,
            CASE i.priority
                WHEN 'urgent' THEN 24
                WHEN 'high'   THEN 48
                ELSE 120
            END
        )::bigint * 3600000 AS budget_ms
    FROM issues i
    LEFT JOIN sla_rules r
           ON r.project_id = i.project_id
          AND r.priority = i.priority
    WHERE i.priority IS NOT NULL
)
UPDATE issues i
SET sla_deadline = CASE
        WHEN b.sla_clock_started_at IS NULL THEN NULL
        ELSE b.sla_clock_started_at
             + (interval '1 millisecond' * GREATEST(0, b.budget_ms - b.sla_elapsed_ms))
    END,
    sla_breached = (b.sla_elapsed_ms > b.budget_ms)
FROM budget b
WHERE i.id = b.id;

-- Issues without a priority carry no SLA commitment.
UPDATE issues
SET sla_deadline = NULL,
    sla_breached = false
WHERE priority IS NULL;

-- ── Indexes ──────────────────────────────────────────────
-- "what is about to breach" (dashboards, at-risk queries): only rows with a
-- live clock can breach, so the partial index stays small.
CREATE INDEX IF NOT EXISTS idx_issues_sla_deadline_live
    ON issues(sla_deadline)
    WHERE sla_deadline IS NOT NULL AND archived = false;

CREATE INDEX IF NOT EXISTS idx_issues_sla_breached
    ON issues(project_id)
    WHERE sla_breached = true;
