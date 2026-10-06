-- Sign in with Google: accounts may have a Google identity instead of (or as well as) a password.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) UNIQUE;
ALTER TABLE users ADD CONSTRAINT users_has_credential
  CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL);
