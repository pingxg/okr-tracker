-- The group (root) node exists from 2000-01-01 (services/org.js GROUP_SINCE),
-- so companies and teams can be entered with the dates they really started.
-- Groups created before this rule started on the day of the first login.
UPDATE org_node_version v
SET valid_from = DATE '2000-01-01'
WHERE v.id IN (
    SELECT DISTINCT ON (node_id) id
    FROM org_node_version
    WHERE parent_id IS NULL
    ORDER BY node_id, valid_from
  )
  AND v.valid_from > DATE '2000-01-01';
