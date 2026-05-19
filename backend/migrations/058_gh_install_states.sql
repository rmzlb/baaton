-- 058: short-lived OAuth state tokens for GitHub App install flow
-- RFC 9700 §4.7: one-time-use CSRF tokens bound to user agent.

CREATE TABLE IF NOT EXISTS gh_install_states (
    state       CHAR(43) PRIMARY KEY,
    org_id      TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gh_install_states_expires
  ON gh_install_states(expires_at);
