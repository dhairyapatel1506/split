-- Bug reports with optional screenshots. Image bytes live in Postgres:
-- volume is tiny (rate-limited to 5 reports/user/day, 3 images of ≤2MB
-- each) and rows are purged after 90 days, so object storage would be
-- overkill here. ON DELETE CASCADE from users: reports are internal
-- telemetry, fine to drop with a hard-deleted account.
CREATE TABLE bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bug_reports_created_idx ON bug_reports (created_at);

CREATE TABLE bug_report_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  bytes bytea NOT NULL
);
