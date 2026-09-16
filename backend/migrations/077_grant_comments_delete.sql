-- Grant comments:delete to all existing API keys that don't already have it.
-- Needed so key holders can delete their own comments via the API.
UPDATE api_keys
SET permissions = array_append(permissions, 'comments:delete')
WHERE NOT ('comments:delete' = ANY(permissions));
