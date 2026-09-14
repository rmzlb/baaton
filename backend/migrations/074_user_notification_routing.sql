-- 074: route notifications to people instead of to one hardcoded room.
--
-- ## The flaw this closes
--
-- The destination was `NOTIFYD_TELEGRAM_CHAT_ID`, an environment variable of the
-- API. One address for the whole instance. Adding a second user changed nothing,
-- because there was no field anywhere saying where to reach them: the feature was
-- a single-user prototype wearing the clothes of an integration.
--
-- Migration 073 put the *filter* on the project, which is right for "which
-- transitions matter" and wrong for "who hears about them". A chat id on a
-- project would mean the project decides where each person gets notified.
--
-- Three separate questions, previously collapsed into one env var:
--
--   where to reach someone  -> the user   (a chat id belongs to a person, and is
--                                          the same in every org they belong to)
--   what they want to hear  -> user x project subscription
--   which statuses exist    -> the project (already in 073)
--
-- ## Why per project and not per org
--
-- Subscribing per project is the finer grain, and "all of this org" derives from
-- it by subscribing to each project. The reverse does not: an org-level row
-- cannot express "Wnohe only". Nothing stops a later UI from offering an
-- org-wide toggle that writes N rows.

-- ── Where to reach a person ──
--
-- One row per (user, channel). `address` is the channel's own identifier: a
-- Telegram chat id, a Slack member or channel id, an email. notifyd already
-- routes eight channels and takes the recipient per message, so nothing here is
-- Telegram-specific.
--
-- `verified_at` separates an address we watched arrive from one that was typed.
-- A wrong chat id fails silently forever (Telegram answers "chat not found" to a
-- server nobody is watching), so the UI must be able to say "not verified" out
-- loud rather than let someone believe they are covered.
CREATE TABLE IF NOT EXISTS user_notification_channels (
  user_id     TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('telegram', 'slack', 'discord', 'email')),
  address     TEXT NOT NULL CHECK (length(trim(address)) > 0),
  -- Set when the address proved itself: the deep-link flow saw the user's own
  -- `/start`. NULL means it was entered by hand and never confirmed.
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel)
);

-- ── What a person wants to hear, per project ──
--
-- The three `notify_*` columns are nullable on purpose: NULL means "inherit the
-- project's setting from 073". A subscriber who never expresses an opinion keeps
-- following the project's defaults as they evolve, and only an explicit choice
-- pins the behaviour. Storing a copy of the project default at subscribe time
-- would silently freeze it.
--
-- `channels` is empty by default, meaning "every channel this user has
-- configured". Naming channels here is for the case where someone wants Slack
-- for one project and Telegram for another.
CREATE TABLE IF NOT EXISTS project_notification_subscriptions (
  user_id              TEXT NOT NULL,
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  enabled              BOOLEAN NOT NULL DEFAULT true,
  notify_statuses      JSONB,
  notify_comments      BOOLEAN,
  notify_issue_created BOOLEAN,
  channels             TEXT[] NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

-- Guard the shape only. Postgres forbids subqueries in CHECK (learned the hard
-- way in 073, where a subquery silently rolled back the whole migration), so
-- "every element is a string" is enforced by the route that writes it, which
-- validates each key against the project's own workflow.
ALTER TABLE project_notification_subscriptions
  DROP CONSTRAINT IF EXISTS subs_notify_statuses_is_array;
ALTER TABLE project_notification_subscriptions
  ADD CONSTRAINT subs_notify_statuses_is_array CHECK (
    notify_statuses IS NULL OR jsonb_typeof(notify_statuses) = 'array'
  );

-- The send path asks "who subscribes to this project", so the index follows that
-- question and not the primary key's order.
CREATE INDEX IF NOT EXISTS idx_project_subs_project
  ON project_notification_subscriptions (project_id)
  WHERE enabled;

-- ── Proving a chat id belongs to the person claiming it ──
--
-- Telegram never tells a server who a user is; it only reveals a chat id when
-- that chat sends a message. So the user starts the bot with a one-time token
-- and the bot's update carries both the token and the chat id.
--
-- The token is the credential: anyone holding it becomes the notification target
-- for that account. Hence single use (`used_at`), short lived (`expires_at`), and
-- unguessable (generated as 32 random bytes, base64url, well inside Telegram's
-- 64-character deep-link limit and its `[A-Za-z0-9_-]` alphabet).
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expired and consumed tokens are kept, not deleted: "this link was already
-- used" is a different message from "this link never existed", and telling them
-- apart is what makes a failed link diagnosable instead of mysterious.
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user
  ON telegram_link_tokens (user_id, created_at DESC);
