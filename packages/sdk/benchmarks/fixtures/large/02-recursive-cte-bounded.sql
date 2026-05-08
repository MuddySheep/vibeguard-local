WITH RECURSIVE org_tree AS (
  SELECT id, name, parent_id, 0 AS depth, ARRAY[id] AS path
  FROM organizations
  WHERE parent_id IS NULL
    AND deleted_at IS NULL
    AND verified = true

  UNION ALL

  SELECT o.id, o.name, o.parent_id, t.depth + 1, t.path || o.id
  FROM organizations o
  JOIN org_tree t ON o.parent_id = t.id
  WHERE t.depth < 10
    AND o.deleted_at IS NULL
    AND o.archived = false
    AND NOT (o.id = ANY(t.path))
),
descendant_counts AS (
  SELECT
    parent.id AS parent_id,
    count(child.id) AS direct_children,
    count(DISTINCT child.path[2]) AS distinct_levels
  FROM org_tree parent
  LEFT JOIN org_tree child ON child.parent_id = parent.id
  GROUP BY parent.id
)
SELECT
  t.id,
  t.name,
  t.depth,
  array_length(t.path, 1) AS path_length,
  dc.direct_children,
  dc.distinct_levels,
  CASE
    WHEN t.depth = 0 THEN 'root'
    WHEN dc.direct_children = 0 THEN 'leaf'
    ELSE 'branch'
  END AS node_type
FROM org_tree t
JOIN descendant_counts dc ON dc.parent_id = t.id
WHERE t.depth <= 5
ORDER BY t.path
