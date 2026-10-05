-- Lex Terrae initial schema (Postgres 16 / Neon).
-- Applied by db/migrate.ts, which records each file in schema_migrations.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Jurisdictions (federal → provincial/territorial → municipal) ─────────────
CREATE TABLE jurisdictions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  code         VARCHAR(50) NOT NULL UNIQUE,
  level        VARCHAR(20) NOT NULL,
  parent_id    UUID REFERENCES jurisdictions (id) ON DELETE SET NULL,
  legal_system VARCHAR(20) NOT NULL,
  geo_code     VARCHAR(20),
  population   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX jurisdictions_level_idx ON jurisdictions (level);
CREATE INDEX jurisdictions_parent_id_idx ON jurisdictions (parent_id);

-- ─── Documents ────────────────────────────────────────────────────────────────
CREATE TABLE documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  file_key          VARCHAR(500) NOT NULL,
  file_type         VARCHAR(10) NOT NULL,
  file_size_bytes   INTEGER NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  content_text      TEXT,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft delete: rows are purged (with their stored file) 30 days after this is set
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX documents_user_id_uploaded_at_idx ON documents (user_id, uploaded_at DESC);
CREATE INDEX documents_deleted_at_idx ON documents (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE document_jurisdictions (
  document_id     UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  jurisdiction_id UUID NOT NULL REFERENCES jurisdictions (id) ON DELETE RESTRICT,
  PRIMARY KEY (document_id, jurisdiction_id)
);
CREATE INDEX document_jurisdictions_jurisdiction_id_idx ON document_jurisdictions (jurisdiction_id);

-- ─── Audit log (append-only; kept when the acting user is deleted) ────────────
CREATE TABLE audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id  UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_ip_hash  TEXT NOT NULL,
  action         TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  resource_id    UUID NOT NULL,
  changes        JSONB,
  request_id     TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  failure_reason TEXT
);
CREATE INDEX audit_logs_timestamp_idx ON audit_logs (timestamp DESC);
CREATE INDEX audit_logs_actor_user_id_timestamp_idx ON audit_logs (actor_user_id, timestamp DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id, timestamp DESC);
CREATE INDEX audit_logs_action_timestamp_idx ON audit_logs (action, timestamp DESC);

-- ─── Sessions: used (rotated) or revoked refresh tokens ───────────────────────
CREATE TABLE revoked_tokens (
  jti        VARCHAR(64) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX revoked_tokens_expires_at_idx ON revoked_tokens (expires_at);

-- ─── Long-window rate limit counters (per-minute limits use Workers Rate Limiting) ──
CREATE TABLE rate_limit_buckets (
  key          VARCHAR(200) PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX rate_limit_buckets_window_start_idx ON rate_limit_buckets (window_start);
