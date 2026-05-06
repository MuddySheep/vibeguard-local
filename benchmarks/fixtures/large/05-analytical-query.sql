SELECT
  cohort.cohort_month,
  cohort.cohort_size,
  current_period.active_count,
  round(100.0 * current_period.active_count / nullif(cohort.cohort_size, 0), 2) AS retention_pct,
  current_period.total_revenue,
  round(current_period.total_revenue / nullif(current_period.active_count, 0), 2) AS arpu,
  lag(current_period.active_count) OVER (ORDER BY cohort.cohort_month) AS prev_active,
  current_period.active_count - lag(current_period.active_count) OVER (ORDER BY cohort.cohort_month) AS active_delta,
  rank() OVER (ORDER BY current_period.total_revenue DESC) AS revenue_rank,
  ntile(4) OVER (ORDER BY current_period.active_count) AS active_quartile
FROM (
  SELECT
    date_trunc('month', u.created_at) AS cohort_month,
    count(*) AS cohort_size,
    array_agg(u.id) AS user_ids
  FROM users u
  WHERE u.created_at >= now() - interval '24 months'
    AND u.deleted_at IS NULL
  GROUP BY date_trunc('month', u.created_at)
) cohort
LEFT JOIN LATERAL (
  SELECT
    count(DISTINCT o.user_id) AS active_count,
    coalesce(sum(o.amount), 0) AS total_revenue
  FROM orders o
  WHERE o.user_id = ANY(cohort.user_ids)
    AND o.created_at >= now() - interval '30 days'
    AND o.status = 'completed'
) current_period ON true
ORDER BY cohort.cohort_month DESC
