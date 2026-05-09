// Shared literal-tautology detector used by SQL-026 (MERGE ON) and
  // SQL-034 (UPDATE/DELETE WHERE).
  //
  // Returns true iff the expression node provably evaluates to TRUE
  // without reference to any column value, OR is the trivial
  // self-comparison (e.g. `id = id`, `s.id = s.id`).
  //
  // We deliberately do NOT recurse into AND/OR — a tautology that is
  // one branch of `tautology AND realPredicate` is not a tautology of
  // the whole expression. The caller passes the WHOLE join/where
  // condition; this helper answers "is THIS expression a tautology?".
  //
  // Recognized shapes:
  //   1. A_Const Boolean true  →  WHERE true / ON true
  //   2. A_Expr "=" with two A_Const operands of equal value
  //      (1=1, 'a'='a', true=true)
  //   3. A_Expr "=" with two ColumnRef operands of equal field path
  //      (id=id, s.id=s.id)
  //   4. NOT (A_Const Boolean false)  →  NOT false
  //
  // Anything else returns false. False negatives are acceptable; false
  // positives are not (they would block legitimate queries).

  interface AnyNode {
    readonly [k: string]: unknown;
  }

  function asConstSval(node: unknown): string | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const c = (node as AnyNode)['A_Const'];
    if (!c || typeof c !== 'object') return undefined;
    const sv = (c as AnyNode)['sval'];
    if (!sv || typeof sv !== 'object') return undefined;
    const v = (sv as AnyNode)['sval'];
    return typeof v === 'string' ? v : undefined;
  }

  function asConstIval(node: unknown): number | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const c = (node as AnyNode)['A_Const'];
    if (!c || typeof c !== 'object') return undefined;
    const iv = (c as AnyNode)['ival'];
    if (!iv || typeof iv !== 'object') return undefined;
    const v = (iv as AnyNode)['ival'];
    // Postgres encodes integer 0 as { ival: {} } (the field is omitted).
    if (typeof v === 'number') return v;
    if (Object.keys(iv as object).length === 0) return 0;
    return undefined;
  }

  function asConstBool(node: unknown): boolean | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const c = (node as AnyNode)['A_Const'];
    if (!c || typeof c !== 'object') return undefined;
    const bv = (c as AnyNode)['boolval'];
    if (!bv || typeof bv !== 'object') return undefined;
    const v = (bv as AnyNode)['boolval'];
    if (typeof v === 'boolean') return v;
    // Postgres encodes Boolean false as { boolval: {} } (the field is omitted).
    if (Object.keys(bv as object).length === 0) return false;
    return undefined;
  }

  function columnRefPath(node: unknown): string | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const cr = (node as AnyNode)['ColumnRef'];
    if (!cr || typeof cr !== 'object') return undefined;
    const fields = (cr as AnyNode)['fields'];
    if (!Array.isArray(fields)) return undefined;
    const parts: string[] = [];
    for (const f of fields) {
      if (!f || typeof f !== 'object') return undefined;
      const s = (f as AnyNode)['String'];
      if (!s || typeof s !== 'object') return undefined;
      const sv = (s as AnyNode)['sval'];
      if (typeof sv !== 'string') return undefined;
      parts.push(sv);
    }
    return parts.length > 0 ? parts.join('.') : undefined;
  }

  function isEqualityOp(opNode: unknown): boolean {
    if (!opNode || typeof opNode !== 'object') return false;
    const ax = (opNode as AnyNode)['A_Expr'];
    if (!ax || typeof ax !== 'object') return false;
    if ((ax as AnyNode)['kind'] !== 'AEXPR_OP') return false;
    const name = (ax as AnyNode)['name'];
    if (!Array.isArray(name) || name.length !== 1) return false;
    const n0 = name[0];
    if (!n0 || typeof n0 !== 'object') return false;
    const s = (n0 as AnyNode)['String'];
    if (!s || typeof s !== 'object') return false;
    return (s as AnyNode)['sval'] === '=';
  }

  export function isLiteralTautology(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    // 1. WHERE/ON true
    const directBool = asConstBool(node);
    if (directBool === true) return true;
    // 4. NOT false
    const be = (node as AnyNode)['BoolExpr'];
    if (be && typeof be === 'object') {
      const beObj = be as AnyNode;
      if (beObj['boolop'] === 'NOT_EXPR') {
        const args = beObj['args'];
        if (Array.isArray(args) && args.length === 1) {
          const inner = asConstBool(args[0]);
          if (inner === false) return true;
        }
      }
      return false; // AND/OR not unwrapped here
    }
    // 2 & 3 require A_Expr "="
    if (!isEqualityOp(node)) return false;
    const ax = (node as AnyNode)['A_Expr'] as AnyNode;
    const lex = ax['lexpr'];
    const rex = ax['rexpr'];
    // 2a. equal integer constants
    const li = asConstIval(lex);
    const ri = asConstIval(rex);
    if (li !== undefined && ri !== undefined && li === ri) return true;
    // 2b. equal string constants
    const ls = asConstSval(lex);
    const rs = asConstSval(rex);
    if (ls !== undefined && rs !== undefined && ls === rs) return true;
    // 2c. equal boolean constants
    const lb = asConstBool(lex);
    const rb = asConstBool(rex);
    if (lb !== undefined && rb !== undefined && lb === rb) return true;
    // 3. equal column references
    const lc = columnRefPath(lex);
    const rc = columnRefPath(rex);
    if (lc !== undefined && rc !== undefined && lc === rc) return true;
    return false;
  }
  