SELECT u.id, u.email, u.created_at
FROM users u
WHERE EXISTS (
  SELECT 1
  FROM orders o
  WHERE o.user_id = u.id
    AND o.status = 'completed'
    AND o.created_at >= now() - interval '7 days'
)
AND NOT EXISTS (
  SELECT 1
  FROM banned_users b
  WHERE b.user_id = u.id
    AND b.expires_at > now()
)
ORDER BY u.created_at DESC
