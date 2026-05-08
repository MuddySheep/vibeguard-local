SELECT
  u.id,
  u.email,
  CASE
    WHEN u.created_at > now() - interval '30 days' THEN 'new'
    WHEN u.created_at > now() - interval '180 days' THEN 'recent'
    WHEN u.last_login > now() - interval '90 days' THEN 'returning'
    ELSE 'inactive'
  END AS user_segment,
  CASE
    WHEN u.subscription_tier = 'enterprise' THEN u.monthly_value * 12
    WHEN u.subscription_tier = 'pro' THEN u.monthly_value * 6
    ELSE u.monthly_value
  END AS annualized_value
FROM users u
WHERE u.deleted_at IS NULL
