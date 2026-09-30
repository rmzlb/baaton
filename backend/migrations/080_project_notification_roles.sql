-- Notification roles per project.
--
-- A role is a named notification rule owned by the project ("Reviewer" hears
-- In Review, "Dev" hears Not OK and Backlog). A project editor assigns roles to
-- members, so a requester follows every ticket reaching review without having
-- to configure anything.
--
-- Precedence, field by field: the member's own subscription value, else their
-- role's, else the project default. Roles are read at send time, never copied,
-- so editing a role changes it for everyone holding it.
--
-- The assignment lives in its own table rather than on the subscription row:
-- clearing a role must not destroy a subscription the member created
-- themselves, and a member's own unsubscribe (`enabled = false`) must still
-- mute a role.
--
-- `notify_statuses` may contain "*": every status, including ones added later.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS notification_roles JSONB NOT NULL DEFAULT '[
    {"key": "reviewer", "label": "Reviewer", "notify_statuses": ["in_review"], "notify_comments": false, "notify_issue_created": false},
    {"key": "dev", "label": "Dev", "notify_statuses": ["not_ok", "backlog"], "notify_comments": false, "notify_issue_created": false},
    {"key": "everything", "label": "Everything", "notify_statuses": ["*"], "notify_comments": true, "notify_issue_created": true}
  ]'::jsonb;

ALTER TABLE projects
  ADD CONSTRAINT projects_notification_roles_is_array
    CHECK (jsonb_typeof(notification_roles) = 'array');

CREATE TABLE IF NOT EXISTS project_member_roles (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (length(trim(role)) > 0),
  assigned_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
