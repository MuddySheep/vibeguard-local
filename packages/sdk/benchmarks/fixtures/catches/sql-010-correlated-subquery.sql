SELECT u.id, (SELECT count(*) FROM orders o WHERE o.user_id = u.id) FROM users u
