SELECT
  u.id,
  u.email,
  o.id AS order_id,
  p.name AS product_name,
  c.name AS category_name,
  s.name AS supplier_name
FROM users u
JOIN orders o ON o.user_id = u.id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
JOIN categories c ON c.id = p.category_id
JOIN suppliers s ON s.id = p.supplier_id
WHERE u.active = true
  AND o.status = 'completed'
  AND p.discontinued = false
ORDER BY o.created_at DESC
LIMIT 100
