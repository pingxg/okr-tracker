-- Key results now carry `lastProgressAt` (set by the progress roll-up) for
-- status tags and "to update" lists. Fill it in once for key results that
-- already have progress values.
UPDATE documents AS kr
SET data = kr.data || jsonb_build_object('lastProgressAt', latest.ts)
FROM (
  SELECT DISTINCT ON (parent) parent, data -> 'timestamp' AS ts
  FROM documents
  WHERE collection_group = 'progress'
    AND parent LIKE 'keyResults/%'
    AND data ? 'timestamp'
  ORDER BY parent, data -> 'timestamp' ->> '__ts' DESC
) AS latest
WHERE kr.path = latest.parent
  AND NOT (kr.data ? 'lastProgressAt');
