// 15 catch-keyed sample presets for the playground gallery.
//
// Each preset triggers exactly one of the SDK's catches. The ID
// matches the catch code (SQL-001 through SQL-015) so we can pair
// the gallery item with a "click here to see SQL-XXX" affordance.
//
// SQL-014 is default-OFF in the SDK — the sample is included for
// completeness. Visiting it via the gallery toggles SQL-014 on
// before analyzing.

export interface Sample {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly sql: string;
  /** Whether to opt-in to a default-OFF rule for this sample. */
  readonly forceEnable?: string;
}

export const SAMPLES: readonly Sample[] = [
  {
    code: 'SQL-001',
    title: 'Cartesian explosion',
    description: 'Two tables in FROM with no JOIN clause or cross-table predicate.',
    sql: `SELECT a.id, b.id
FROM accounts a, billing b;`,
  },
  {
    code: 'SQL-002',
    title: 'Self-join without disambiguator',
    description: 'Same table joined to itself with no predicate distinguishing the two copies.',
    sql: `SELECT u1.name, u2.name
FROM users u1
JOIN users u2 ON TRUE;`,
  },
  {
    code: 'SQL-003',
    title: 'Unbounded UPDATE',
    description: 'UPDATE with no WHERE clause — every row in the table will be modified.',
    sql: `UPDATE users
SET email = 'rotated@example.com';`,
  },
  {
    code: 'SQL-004',
    title: 'Implicit type coercion',
    description: 'Comparing a column against a literal of an incompatible type.',
    sql: `SELECT id FROM users WHERE id = '42';`,
  },
  {
    code: 'SQL-005',
    title: '= NULL footgun',
    description: 'NULL comparison with `=` always evaluates UNKNOWN; should be `IS NULL`.',
    sql: `SELECT id FROM users
WHERE active = NULL;`,
  },
  {
    code: 'SQL-006',
    title: 'OFFSET without ORDER BY',
    description: 'Pagination based on OFFSET without a stable sort order.',
    sql: `SELECT id FROM events
LIMIT 10 OFFSET 20;`,
  },
  {
    code: 'SQL-007',
    title: 'NOT IN with nullable subquery',
    description: 'NOT IN against a subquery that may return NULL — silently filters everything.',
    sql: `SELECT id FROM users
WHERE id NOT IN (SELECT user_id FROM bans);`,
  },
  {
    code: 'SQL-008',
    title: 'String-concatenation injection risk',
    description: 'Building SQL by concatenating untrusted-looking literals.',
    sql: `SELECT * FROM users
WHERE name = 'admin' || ' OR 1=1';`,
  },
  {
    code: 'SQL-009',
    title: 'DISTINCT on SELECT *',
    description: 'DISTINCT applied to a star projection — fragile + over-fetches.',
    sql: `SELECT DISTINCT * FROM users;`,
  },
  {
    code: 'SQL-010',
    title: 'Correlated subquery in projection',
    description: 'Per-row subquery in SELECT list — runs once per outer row.',
    sql: `SELECT u.id,
       (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS n
FROM users u;`,
  },
  {
    code: 'SQL-011',
    title: 'Aggregate without GROUP BY',
    description: 'Mixing aggregate with naked column without a GROUP BY.',
    sql: `SELECT name, COUNT(*)
FROM events;`,
  },
  {
    code: 'SQL-012',
    title: 'Recursive CTE without termination',
    description: 'WITH RECURSIVE missing an obvious base / depth bound.',
    sql: `WITH RECURSIVE chain AS (
  SELECT id, parent FROM nodes
  UNION ALL
  SELECT n.id, n.parent FROM nodes n JOIN chain c ON n.id = c.parent
)
SELECT * FROM chain;`,
  },
  {
    code: 'SQL-013',
    title: 'DROP TABLE — destructive DDL',
    description: 'DROP TABLE is irreversible; almost never the intended op for an AI agent.',
    sql: `DROP TABLE users;`,
  },
  {
    code: 'SQL-014',
    title: 'INSERT/UPDATE without RETURNING (default OFF)',
    description: 'Write without RETURNING — agent has to re-query for the row. Default-OFF rule; the gallery enables it for this sample.',
    sql: `INSERT INTO users (email)
VALUES ('a@b.com');`,
    forceEnable: 'sql-014',
  },
  {
    code: 'SQL-015',
    title: 'SELECT * over-fetch',
    description: 'Bare SELECT * — returns every column; tokens, PII, schema fragility.',
    sql: `SELECT * FROM users;`,
  },
];

/**
 * Map from catch code (uppercase) to its preset. Useful for
 * gallery → editor wiring.
 */
export const SAMPLE_BY_CODE: ReadonlyMap<string, Sample> = new Map(
  SAMPLES.map((s) => [s.code, s]),
);
