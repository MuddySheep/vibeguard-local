SELECT *
FROM (
  SELECT u.id, u.email,
    (SELECT count(*)
     FROM orders o
     WHERE o.user_id = u.id
       AND o.status IN (
         SELECT status_code
         FROM (
           SELECT status_code
           FROM order_statuses
           WHERE archived = false
             AND status_code IN (
               SELECT child_code
               FROM (
                 SELECT child_code, parent_code
                 FROM status_hierarchy
                 WHERE parent_code IN (
                   SELECT root_code
                   FROM (
                     SELECT root_code
                     FROM status_roots
                     WHERE active = true
                       AND created_at >= now() - interval '1 year'
                   ) AS active_roots
                 )
               ) AS hierarchy
             )
         ) AS effective_statuses
       )
    ) AS qualifying_orders,
    (SELECT max(created_at)
     FROM logins
     WHERE logins.user_id = u.id
       AND logins.region IN (
         SELECT region_code
         FROM allowed_regions
         WHERE tier IN (
           SELECT tier_id FROM user_tiers WHERE user_id = u.id
         )
       )
    ) AS last_qualifying_login
  FROM users u
  WHERE u.deleted_at IS NULL
    AND u.created_at >= now() - interval '2 years'
) AS user_summary
WHERE qualifying_orders > 0
ORDER BY qualifying_orders DESC, last_qualifying_login DESC
LIMIT 100
