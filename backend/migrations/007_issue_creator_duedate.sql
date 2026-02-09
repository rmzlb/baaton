-- 007: Add creator info and due date to issues

-- Creator (who created the ticket — Clerk user_id + display name)
ALTER TABLE issues ADD COLUMN IF NOT EXISTS created_by_id TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS created_by_name TEXT;

-- Due date (optional deadline)
ALTER TABLE issues ADD COLUMN IF NOT EXISTS due_date DATE;
