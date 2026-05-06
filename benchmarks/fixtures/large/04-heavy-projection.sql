SELECT
  u.id::text AS user_id_str,
  u.email::varchar(255) AS email,
  upper(u.email) AS email_upper,
  lower(u.email) AS email_lower,
  length(u.email) AS email_length,
  position('@' IN u.email) AS at_position,
  substring(u.email FROM position('@' IN u.email) + 1) AS email_domain,
  to_char(u.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_str,
  extract(year FROM u.created_at) AS created_year,
  extract(month FROM u.created_at) AS created_month,
  extract(epoch FROM u.created_at)::bigint AS created_epoch,
  age(u.created_at) AS account_age,
  date_trunc('day', u.created_at) AS created_day,
  date_trunc('week', u.created_at) AS created_week,
  date_trunc('month', u.created_at) AS created_month_start,
  greatest(u.last_login, u.last_purchase) AS last_activity,
  least(u.created_at, u.first_purchase) AS earliest_engagement,
  coalesce(u.display_name, u.email) AS display_name,
  nullif(u.notes, '') AS notes_or_null,
  jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'tier', u.subscription_tier,
    'verified', u.email_verified,
    'metadata', u.metadata
  ) AS user_doc,
  array[u.id, u.org_id, u.team_id]::text[] AS scope_ids,
  CASE u.subscription_tier
    WHEN 'enterprise' THEN u.monthly_value * 12 * 1.0
    WHEN 'pro' THEN u.monthly_value * 12 * 0.85
    WHEN 'basic' THEN u.monthly_value * 12 * 0.7
    ELSE 0
  END AS annualized_value
FROM users u
WHERE u.deleted_at IS NULL
  AND u.email IS NOT NULL
ORDER BY u.id
LIMIT 1000
