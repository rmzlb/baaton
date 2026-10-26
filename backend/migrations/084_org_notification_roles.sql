-- Notification roles defined once for the organization (BAA-39).
--
-- 080 stored roles on each project, so the same "Reviewer" could mean two
-- things on two projects of one org, and a new project started from defaults.
-- Now:
--
-- - `organizations.notification_roles` holds the org's role definitions;
-- - `org_member_roles` gives a member a role on every project of the org;
-- - `projects.custom_notification_roles` is NULL while the project follows the
--   org's definitions, and holds its own roles once someone customises it;
-- - `project_member_role_overrides` gives a member another role on one project
--   (`role` NULL meaning "no role on this project").
--
-- Recipient resolution (`notification_prefs::member_rules_sql`) reads all of
-- this at send time: the project's assignment, else the org's; the project's
-- definitions, else the org's. Nothing is copied, so editing an org role
-- changes every project that inherits it, including projects created later.
--
-- Deploy safety: additive only. The 080 layout (`projects.notification_roles`,
-- `project_member_roles`) is left exactly as it is, because the revision still
-- serving during the rolling deploy reads it and would lose every role if it
-- were emptied. The new revision no longer reads or writes it; a later
-- migration drops it once this release is live.
--
-- No behaviour change: the backfill below keeps, for every (project, member),
-- the same role key resolved against the same definition
-- (`notification_roles/migration_tests.rs` proves it on PostgreSQL).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS notification_roles JSONB NOT NULL DEFAULT '[
    {"key": "reviewer", "label": "Reviewer", "notify_statuses": ["in_review"], "notify_comments": true, "notify_issue_created": false},
    {"key": "dev", "label": "Dev", "notify_statuses": ["not_ok", "backlog"], "notify_comments": false, "notify_issue_created": false},
    {"key": "everything", "label": "Everything", "notify_statuses": ["*"], "notify_comments": true, "notify_issue_created": true}
  ]'::jsonb;

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_notification_roles_is_array;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_notification_roles_is_array
    CHECK (jsonb_typeof(notification_roles) = 'array');

ALTER TABLE projects ADD COLUMN IF NOT EXISTS custom_notification_roles JSONB;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_custom_notification_roles_is_array;
ALTER TABLE projects
  ADD CONSTRAINT projects_custom_notification_roles_is_array
    CHECK (custom_notification_roles IS NULL OR jsonb_typeof(custom_notification_roles) = 'array');

CREATE TABLE IF NOT EXISTS org_member_roles (
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (length(trim(role)) > 0),
  assigned_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_member_role_overrides (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  role        TEXT CHECK (role IS NULL OR length(trim(role)) > 0),
  assigned_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- ── Backfill from the 080 layout ──

-- 1. The org's definitions: the roles of its projects when they all agree,
--    else the defaults above. An org without projects keeps the defaults.
UPDATE organizations o
   SET notification_roles = agreed.roles
  FROM (
    SELECT org_id, min(notification_roles::text)::jsonb AS roles
      FROM projects
     GROUP BY org_id
    HAVING count(DISTINCT notification_roles) = 1
  ) agreed
 WHERE agreed.org_id = o.id;

-- 2. A project whose roles differ from its org's keeps them as its own.
UPDATE projects p
   SET custom_notification_roles = p.notification_roles
  FROM organizations o
 WHERE o.id = p.org_id
   AND p.custom_notification_roles IS NULL
   AND p.notification_roles IS DISTINCT FROM o.notification_roles;

-- 3. A member holding the same role on every project of the org holds it for
--    the org. Same key on every project, so resolving it against each
--    project's (unchanged) definitions gives what it gave before.
INSERT INTO org_member_roles (org_id, user_id, role, assigned_by, created_at, updated_at)
SELECT p.org_id, mr.user_id, min(mr.role), min(mr.assigned_by), min(mr.created_at), max(mr.updated_at)
  FROM project_member_roles mr
  JOIN projects p ON p.id = mr.project_id
 GROUP BY p.org_id, mr.user_id
HAVING count(DISTINCT mr.role) = 1
   AND count(*) = (SELECT count(*) FROM projects q WHERE q.org_id = p.org_id)
ON CONFLICT (org_id, user_id) DO NOTHING;

-- 4. Every other assignment stays on its project.
INSERT INTO project_member_role_overrides (project_id, user_id, role, assigned_by, created_at, updated_at)
SELECT mr.project_id, mr.user_id, mr.role, mr.assigned_by, mr.created_at, mr.updated_at
  FROM project_member_roles mr
  JOIN projects p ON p.id = mr.project_id
 WHERE NOT EXISTS (
         SELECT 1 FROM org_member_roles omr
          WHERE omr.org_id = p.org_id AND omr.user_id = mr.user_id)
ON CONFLICT (project_id, user_id) DO NOTHING;

COMMENT ON COLUMN projects.notification_roles IS
  'Legacy (080), frozen by 084 for the revision serving during the deploy. Read custom_notification_roles / organizations.notification_roles instead.';
COMMENT ON TABLE project_member_roles IS
  'Legacy (080), frozen by 084 for the revision serving during the deploy. Read org_member_roles / project_member_role_overrides instead.';
