SELECT
  o.id,
  o.user_id,
  o.amount,
  o.created_at,
  row_number() OVER (PARTITION BY o.user_id ORDER BY o.created_at DESC) AS rn,
  count(*) OVER (PARTITION BY o.user_id) AS user_total_orders,
  sum(o.amount) OVER (PARTITION BY o.user_id ORDER BY o.created_at) AS running_total
FROM orders o
WHERE o.status = 'completed'
  AND o.created_at >= now() - interval '90 days'
ORDER BY o.user_id, o.created_at DESC
