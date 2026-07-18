-- Money is stored as integer minor units (cents/paise), never floats:
-- 0.1 + 0.2 !== 0.3 in binary floating point, and expense math must be exact.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  paid_by uuid NOT NULL REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  spent_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_group_idx ON expenses (group_id, created_at DESC);

-- Who owes what share of each expense. Shares must sum to the expense
-- amount; enforced in application code where the split is computed.
CREATE TABLE expense_shares (
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  share_cents bigint NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);
CREATE INDEX expense_shares_user_idx ON expense_shares (user_id);

-- A recorded repayment between two members ("I paid you back ₹500").
CREATE TABLE settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user uuid NOT NULL REFERENCES users(id),
  to_user uuid NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user <> to_user)
);
CREATE INDEX settlements_group_idx ON settlements (group_id, created_at DESC);
