-- Google sign-in: accounts created via Google have no password, so
-- password_hash becomes nullable. google_id stores Google's stable "sub"
-- identifier (emails can change on Google's side; sub never does).
ALTER TABLE users ADD COLUMN google_id text UNIQUE;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
