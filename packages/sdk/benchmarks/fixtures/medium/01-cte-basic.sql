WITH active_users AS (
  SELECT id, email, created_at
  FROM users
  WHERE active = true AND deleted_at IS NULL
)
SELECT a.id, a.email, count(o.id) AS order_count
FROM active_users a
LEFT JOIN orders o ON o.user_id = a.id
GROUP BY a.id, a.email
ORDER BY order_count DESC
LIMIT 50
