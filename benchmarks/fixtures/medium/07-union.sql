SELECT id, email, 'customer' AS user_type, created_at
FROM customers
WHERE active = true

UNION ALL

SELECT id, email, 'admin' AS user_type, created_at
FROM admins
WHERE deleted_at IS NULL

UNION ALL

SELECT id, email, 'partner' AS user_type, created_at
FROM partners
WHERE status = 'verified'

ORDER BY created_at DESC
LIMIT 100
