-- Soft delete: binned groups keep deleted_at set and are hidden everywhere;
-- a periodic sweep permanently deletes them after the retention window.
ALTER TABLE groups ADD COLUMN deleted_at timestamptz;
CREATE INDEX groups_deleted_idx ON groups (deleted_at) WHERE deleted_at IS NOT NULL;
