SELECT u.id, u.email, u.created_at
FROM users u
WHERE u.id IN (
  SELECT user_id
  FROM orders
  WHERE status = 'completed'
    AND amount > 100
    AND created_at >= now() - interval '30 days'
)
AND u.active = true
ORDER BY u.created_at DESC
