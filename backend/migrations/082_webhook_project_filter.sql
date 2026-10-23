-- 082: optional project filter on webhooks (BAA-36).
--
-- A webhook belonged to its organization only, so its endpoint received the
-- events of every project. `project_ids` narrows delivery to the listed
-- projects; empty (the default, and every existing row) keeps the previous
-- behavior: the whole organization.
--
-- Additive and instant (constant default, no table rewrite). The previous API
-- version ignores the column, so a rollback of the code needs no SQL. To remove
-- the column entirely:
--   ALTER TABLE webhooks DROP COLUMN IF EXISTS project_ids;
ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}';
