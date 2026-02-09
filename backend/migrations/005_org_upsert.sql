-- Allow org_id to be any string (remove FK constraint if it causes issues with Clerk org IDs)
-- Instead, ensure orgs are auto-created when referenced

-- Create a function to auto-insert orgs
CREATE OR REPLACE FUNCTION ensure_org_exists(p_org_id TEXT)
RETURNS VOID AS $$
BEGIN
    INSERT INTO organizations (id, name, slug)
    VALUES (p_org_id, p_org_id, p_org_id)
    ON CONFLICT (id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
