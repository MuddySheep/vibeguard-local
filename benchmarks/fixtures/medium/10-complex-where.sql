SELECT *
FROM events e
WHERE (
  (e.event_type = 'purchase' AND e.amount > 100)
  OR
  (e.event_type = 'signup' AND e.created_at >= now() - interval '24 hours')
  OR
  (e.event_type = 'login' AND e.user_id IN (SELECT id FROM vip_users))
)
AND e.deleted_at IS NULL
AND e.region IN ('us-east-1', 'us-west-2', 'eu-west-1')
AND (e.metadata->>'source' = 'web' OR e.metadata->>'source' = 'mobile')
ORDER BY e.created_at DESC
LIMIT 200
