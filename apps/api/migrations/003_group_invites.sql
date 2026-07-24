-- Pending invitations for people without an account yet. Redeemed (and
-- deleted) automatically when someone signs up with the invited email.
CREATE TABLE group_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, email)
);

-- Signup looks invites up by email.
CREATE INDEX group_invites_email_idx ON group_invites (email);
