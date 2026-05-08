SELECT
  u.id,
  u.email,
  recent.order_count,
  recent.last_order_amount
FROM users u
LEFT JOIN LATERAL (
  SELECT
    count(*) AS order_count,
    max(amount) AS last_order_amount
  FROM orders o
  WHERE o.user_id = u.id
    AND o.created_at >= now() - interval '30 days'
) recent ON true
WHERE u.active = true
ORDER BY recent.order_count DESC NULLS LAST
LIMIT 50
