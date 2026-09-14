-- 075: the bot itself belongs in the database, not in the environment.
--
-- ## The mistake this repairs
--
-- Migration 074 moved the *recipient* out of `NOTIFYD_TELEGRAM_CHAT_ID`, which
-- was the real scaling flaw. But the code written alongside it then read three
-- new environment variables — bot token, bot username, webhook secret — and that
-- was a reflex, not a requirement:
--
--   git show f6f6eab:backend/src/notifyd.rs | grep -c TELEGRAM_BOT_TOKEN  ->  0
--
-- Baaton had never held the bot token. notifyd holds it, and Baaton already
-- reaches notifyd through `/v1/send`, which is what has been announcing into the
-- Telegram General topic all along. So every one of those three variables was
-- inventing a need that the running system had already met.
--
-- Storing them in the environment also fixed the product to exactly one bot,
-- owned by whoever deploys the instance. That is the wrong shape for an
-- integration: a bot is something a person creates in @BotFather, and a team that
-- wants notifications under its own name cannot get there through a deploy
-- variable.
--
-- ## What lives here
--
-- One row per bot. `owner_user_id NULL` is the instance-wide bot — the one
-- already serving General today — so the shared, zero-setup path survives as a
-- row rather than as configuration. A non-null owner is somebody's own bot,
-- pasted once from @BotFather.
CREATE TABLE IF NOT EXISTS telegram_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = the instance bot, available to anyone who does not bring their own.
  owner_user_id TEXT,
  -- Public name, needed to build `t.me/<username>?start=<token>`. Read from
  -- `getMe` when the bot is registered, so it can never drift from the token.
  bot_username TEXT NOT NULL CHECK (length(trim(bot_username)) > 0),
  -- The bot's credential. Plaintext, matching `slack_integrations.bot_token`
  -- (migration 036): the project has no encryption-at-rest helper, so pretending
  -- otherwise here would be theatre. Named as a known debt, not as a decision:
  -- this is now the second table holding a third-party credential in clear, and
  -- the pair should move together the day a sealing helper exists.
  bot_token TEXT NOT NULL CHECK (length(trim(bot_token)) > 0),
  -- Shared with Telegram at `setWebhook` time and presented back on every
  -- update. Per bot, never global: one leaked secret must not let anyone forge
  -- updates for every other bot on the instance.
  webhook_secret TEXT NOT NULL,
  -- Set once Telegram confirmed the registration. NULL means the bot exists but
  -- no update will ever arrive, which is the difference between "configured" and
  -- "working" — the exact gap that made this feature look broken for a day.
  webhook_registered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One bot per person. Bringing a second would leave "which one sends" undefined,
-- and the answer would be decided by row order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_bots_owner
  ON telegram_bots (owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- At most one instance bot, for the same reason.
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_bots_instance
  ON telegram_bots ((owner_user_id IS NULL))
  WHERE owner_user_id IS NULL;

-- ── A chat id is meaningless without its bot ──
--
-- This is the correctness detail that makes the whole per-user model work, and
-- the one that would have failed silently: a Telegram chat id is scoped to the
-- bot that obtained it. If someone presses Start on their own bot, the instance
-- bot cannot write to that chat — Telegram answers "chat not found", to a server
-- nobody is watching.
--
-- So the address and the bot travel together. NULL means the address predates
-- this migration, and therefore belongs to the instance bot.
ALTER TABLE user_notification_channels
  ADD COLUMN IF NOT EXISTS telegram_bot_id UUID REFERENCES telegram_bots(id) ON DELETE SET NULL;

-- The send path asks "which bot do I use for this address", so the lookup is by
-- the pair rather than by the channel alone.
CREATE INDEX IF NOT EXISTS idx_user_channels_bot
  ON user_notification_channels (telegram_bot_id)
  WHERE telegram_bot_id IS NOT NULL;

-- ── Link tokens name their bot too ──
--
-- The deep link is built for one specific bot, and the update comes back from
-- that same bot's webhook. Recording which one was minted lets the webhook
-- refuse a token redeemed through a different bot, so a link cannot be replayed
-- somewhere it was never meant to work.
ALTER TABLE telegram_link_tokens
  ADD COLUMN IF NOT EXISTS telegram_bot_id UUID REFERENCES telegram_bots(id) ON DELETE CASCADE;
