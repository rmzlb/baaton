ALTER TABLE issues ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_issues_search ON issues USING gin(search_vector);

CREATE OR REPLACE FUNCTION issues_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_issues_search ON issues;
CREATE TRIGGER trg_issues_search BEFORE INSERT OR UPDATE OF title, description ON issues
  FOR EACH ROW EXECUTE FUNCTION issues_search_update();

-- Backfill existing issues
UPDATE issues SET search_vector = to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(description,''));
