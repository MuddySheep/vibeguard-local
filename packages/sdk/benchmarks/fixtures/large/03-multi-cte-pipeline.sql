WITH active_users AS (
  SELECT id, email, created_at, subscription_tier
  FROM users
  WHERE active = true AND deleted_at IS NULL
),
recent_orders AS (
  SELECT
    user_id,
    count(*) AS order_count,
    sum(amount) AS total_amount,
    max(created_at) AS last_order_at,
    array_agg(DISTINCT status) AS statuses
  FROM orders
  WHERE created_at >= now() - interval '90 days'
  GROUP BY user_id
),
qualifying_users AS (
  SELECT
    a.id, a.email, a.subscription_tier,
    coalesce(r.order_count, 0) AS order_count,
    coalesce(r.total_amount, 0) AS total_amount,
    r.last_order_at,
    r.statuses
  FROM active_users a
  LEFT JOIN recent_orders r ON r.user_id = a.id
  WHERE coalesce(r.total_amount, 0) > 100
     OR a.subscription_tier IN ('pro', 'enterprise')
),
ranked AS (
  SELECT
    q.*,
    rank() OVER (PARTITION BY q.subscription_tier ORDER BY q.total_amount DESC) AS tier_rank,
    percent_rank() OVER (ORDER BY q.total_amount) AS overall_pct
  FROM qualifying_users q
)
SELECT
  r.id, r.email, r.subscription_tier,
  r.order_count, r.total_amount, r.last_order_at,
  r.statuses, r.tier_rank, r.overall_pct
FROM ranked r
WHERE r.tier_rank <= 100
ORDER BY r.subscription_tier, r.tier_rank
