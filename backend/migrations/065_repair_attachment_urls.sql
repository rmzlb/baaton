-- 065_repair_attachment_urls.sql
--
-- Repair inline `issues.attachments` URLs that were persisted as short-lived S3
-- presigned URLs instead of stable `s3://baaton-uploads/<key>` markers.
--
-- Root cause (fixed in backend/src/routes/issues.rs by s3::collapse_json_value):
--   GET /issues/{id} presigns markers for the client, the client echoed the whole
--   attachments array back on the next mutation, and the write path bound it raw.
--   The stored URL then 403s once the SigV4 window (7d) closes and the attachment
--   looks "removed" in the UI even though the object is still in S3.
--
-- This migration is idempotent: it only rewrites elements whose `url` still points
-- at the baaton-uploads bucket over https. `data:` URIs and foreign https URLs
-- (e.g. legacy airtableusercontent.com imports) are left untouched.

UPDATE issues i
SET attachments = (
  SELECT jsonb_agg(
    CASE
      WHEN a->>'url' ~ '^https://(baaton-uploads\.s3([.][a-z0-9-]+)?\.amazonaws\.com/|s3([.][a-z0-9-]+)?\.amazonaws\.com/baaton-uploads/)'
        THEN jsonb_set(
               a,
               '{url}',
               to_jsonb(
                 's3://baaton-uploads/' || regexp_replace(
                   regexp_replace(
                     a->>'url',
                     '^https://(baaton-uploads\.s3([.][a-z0-9-]+)?\.amazonaws\.com/|s3([.][a-z0-9-]+)?\.amazonaws\.com/baaton-uploads/)',
                     ''
                   ),
                   '\?.*$',
                   ''
                 )
               )
             )
      ELSE a
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(i.attachments) WITH ORDINALITY AS t(a, ord)
)
WHERE jsonb_typeof(i.attachments) = 'array'
  AND jsonb_array_length(i.attachments) > 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(i.attachments) AS a
    WHERE a->>'url' ~ '^https://(baaton-uploads\.s3([.][a-z0-9-]+)?\.amazonaws\.com/|s3([.][a-z0-9-]+)?\.amazonaws\.com/baaton-uploads/)'
  );
