SELECT
  category_id,
  count(*) AS product_count,
  avg(price) AS avg_price,
  min(price) AS min_price,
  max(price) AS max_price,
  sum(stock_quantity) AS total_stock
FROM products
WHERE discontinued = false
GROUP BY category_id
HAVING count(*) > 5
   AND avg(price) BETWEEN 10 AND 1000
   AND sum(stock_quantity) > 100
ORDER BY product_count DESC
