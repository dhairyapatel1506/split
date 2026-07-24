-- Set whenever an expense is edited after creation; null = never edited.
-- Surfaced in the UI so edits are visible to the whole group.
ALTER TABLE expenses ADD COLUMN updated_at timestamptz;
