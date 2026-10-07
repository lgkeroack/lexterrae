-- Who may use the backend (document management) and who may manage that list. Keyed by account,
-- not email, so access follows the account and goes away when the account is deleted.

CREATE TABLE backend_access (
  user_id    UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  role       VARCHAR(10) NOT NULL CHECK (role IN ('admin', 'member')),
  granted_by UUID REFERENCES users (id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The first admin. If the account doesn't exist yet it is granted on its first sign-in instead
-- (BOOTSTRAP_ADMIN_EMAIL, while there are no admins).
INSERT INTO backend_access (user_id, role)
SELECT id, 'admin' FROM users WHERE lower(email) = 'lgkeroack@lgkeroack.com'
ON CONFLICT (user_id) DO NOTHING;
