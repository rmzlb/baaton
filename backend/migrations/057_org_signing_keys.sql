-- 057: Per-org Ed25519 signing keys for verifiable agent run receipts.
-- Auto-generated on first publish. Public key surfaced via JWKS endpoint;
-- private key stored as raw 32 bytes in v1 (DB is access-controlled).
--
-- TODO(security): encrypt private_key at rest with APP_SIGNING_MASTER_KEY env (AES-GCM).
-- v1 stores raw bytes; the DB itself is access-controlled, but a leaked dump leaks the keys.

CREATE TABLE IF NOT EXISTS org_signing_keys (
    org_id        TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    kid           TEXT NOT NULL UNIQUE,                -- key ID for JWKS lookup
    public_key    BYTEA NOT NULL,                      -- 32 bytes Ed25519 public
    private_key   BYTEA NOT NULL,                      -- 32 bytes Ed25519 private (UNENCRYPTED in v1)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
