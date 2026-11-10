/** Known terminal ledgers only. No receipt reads, writes, migrations or repair. */
import { operatorAssert } from "./operator-cli";
import type { OperatorSql } from "./operator-site";

export type ReceiptTable =
  "HistoricalInvitationOperationClosure" | "TranslationIntentReceipt";
type Row = Record<string, unknown>;
export type ReceiptGuardMetadata = {
  columns: Row[];
  constraints: Row[];
  triggers: Row[];
};
const invalid = () =>
  operatorAssert(false, "UNREVIEWED_RECEIPT_GUARD_METADATA");

// Parse just the reviewed CHECK vocabulary, never executable SQL. Keeping the
// boolean tree is essential: deleting parentheses would accept weaker guards.
type Expression = string | number | boolean | null | Expression[];
type Token = { kind: "word" | "string" | "number" | "symbol"; value: string };
function tokens(sql: string): Token[] {
  if (sql.length > 16_384) invalid();
  const result: Token[] = [];
  let rest = sql;
  while (rest.length) {
    const match =
      /^(\s+|'(?:[^']|'')*'|"(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z_0-9]*|\d+|::|[(),\[\]=~>;])/.exec(
        rest,
      );
    if (!match) {
      invalid();
      break;
    }
    const value = match[0];
    rest = rest.slice(value.length);
    if (/^\s/.test(value)) continue;
    result.push(
      value.startsWith("'")
        ? { kind: "string", value: value.slice(1, -1).replaceAll("''", "'") }
        : value.startsWith('"')
          ? { kind: "word", value: value.slice(1, -1).replaceAll('""', '"') }
          : /^\d/.test(value)
            ? { kind: "number", value }
            : /^[a-zA-Z_]/.test(value)
              ? { kind: "word", value: value.toLowerCase() }
              : { kind: "symbol", value },
    );
    if (result.length > 1024) invalid();
  }
  return result;
}
function checkTree(sql: string): Expression {
  const input = tokens(sql);
  let cursor = 0;
  let depth = 0;
  const peek = (value: string) =>
    input[cursor]?.value === value && input[cursor]?.kind !== "string";
  const take = (value: string) => {
    if (!peek(value)) invalid();
    cursor++;
  };
  const logical = (operator: string, parts: Expression[]): Expression => {
    const flattened = parts.flatMap((part) =>
      Array.isArray(part) && part[0] === operator ? part.slice(1) : [part],
    );
    return flattened.length === 1 ? flattened[0]! : [operator, ...flattened];
  };
  const primary = (): Expression => {
    if (++depth > 64) invalid();
    let value: Expression;
    if (peek("(")) {
      take("(");
      value = or();
      take(")");
    } else {
      const token = input[cursor++];
      if (!token) {
        invalid();
        return null;
      }
      if (token.kind === "string") value = ["literal", token.value];
      else if (token.kind === "number") value = ["number", Number(token.value)];
      else if (token.kind === "word" && ["true", "false"].includes(token.value))
        value = ["boolean", token.value === "true"];
      else if (token.kind === "word") {
        value = ["column", token.value];
        if (peek("(")) {
          if (token.value !== "length") invalid();
          take("(");
          value = ["length", primary()];
          take(")");
        }
      } else {
        invalid();
        return null;
      }
    }
    if (peek("::")) {
      // Only transparent casts of the reviewed literal types are accepted.
      take("::");
      if (Array.isArray(value) && value[0] === "literal") take("text");
      else if (
        Array.isArray(value) &&
        value[0] === "number" &&
        (peek("integer") || peek("int4"))
      )
        cursor++;
      else invalid();
    }
    depth--;
    return value;
  };
  const list = (closing: string): Expression[] => {
    const values = [primary()];
    while (peek(",")) {
      take(",");
      values.push(primary());
    }
    take(closing);
    return values;
  };
  const predicate = (): Expression => {
    if (peek("not")) {
      if (++depth > 64) invalid();
      take("not");
      const result: Expression = ["not", predicate()];
      depth--;
      return result;
    }
    const left = primary();
    if (peek("is")) {
      take("is");
      const negate = peek("not");
      if (negate) take("not");
      take("null");
      return [negate ? "not-null" : "null", left];
    }
    if (peek("in")) {
      take("in");
      take("(");
      return ["in", left, list(")")];
    }
    const operator = input[cursor]?.value;
    if (operator && ["=", ">", "~"].includes(operator)) {
      cursor++;
      if (operator === "=" && peek("any")) {
        take("any");
        take("(");
        take("array");
        take("[");
        const values = list("]");
        take(")");
        return ["in", left, values];
      }
      const right = primary();
      // PG may deparse a boolean equality as NOT column.
      if (operator === "=" && Array.isArray(right) && right[0] === "boolean")
        return right[1] ? left : ["not", left];
      return [operator, left, right];
    }
    return left;
  };
  const and = (): Expression => {
    const parts = [predicate()];
    while (peek("and")) {
      take("and");
      parts.push(predicate());
    }
    return logical("and", parts);
  };
  const or = (): Expression => {
    const parts = [and()];
    while (peek("or")) {
      take("or");
      parts.push(and());
    }
    return logical("or", parts);
  };
  const result = or();
  if (cursor !== input.length) invalid();
  return result;
}

const translationChecks = {
  translation_intent_receipt_protocol: '"protocolVersion" = 1',
  translation_intent_receipt_status: "status IN ('ACCEPTED', 'STOPPED')",
  translation_intent_receipt_uuid: `"intentId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
  translation_intent_receipt_binding: `
    (status = 'STOPPED' AND operation IS NULL AND mode IS NULL AND "inputHash" IS NULL)
    OR (status = 'ACCEPTED' AND operation IS NOT NULL
      AND operation IN ('localization.setString', 'home.setContent', 'home.setNewsTranslation', 'home.setSectionTranslation', 'home.setPageTitle')
      AND mode IS NOT NULL AND mode IN ('DRAFT', 'PUBLISH')
      AND "inputHash" IS NOT NULL AND "inputHash" ~ '^[0-9a-f]{64}$')`,
  translation_intent_receipt_result: `
    (status = 'STOPPED' AND "draftId" IS NULL AND cleared IS NULL)
    OR (status = 'ACCEPTED'
      AND ((mode = 'DRAFT' AND "draftId" IS NOT NULL AND length("draftId") > 0)
        OR (mode = 'PUBLISH' AND "draftId" IS NULL))
      AND ((operation IN ('localization.setString', 'home.setContent') AND cleared IS NOT NULL
          AND (mode = 'PUBLISH' OR cleared = false))
        OR (operation IN ('home.setNewsTranslation', 'home.setSectionTranslation', 'home.setPageTitle') AND cleared IS NULL)))`,
};
const contracts = {
  HistoricalInvitationOperationClosure: {
    fields: {
      operationId: "text",
      issuedById: "text",
      inputHash: "text",
      scopeKey: "text",
      createdAt: "timestamp(3) without time zone",
    },
    nullable: [] as string[],
    key: ["operationId"],
    checks: {} as Record<string, string>,
    guard: "historical_invitation_operation_closure_immutable",
    message: "Historical invitation operation closures are immutable",
  },
  TranslationIntentReceipt: {
    fields: {
      actorId: "text",
      intentId: "text",
      protocolVersion: "integer",
      status: "text",
      operation: "text",
      mode: "text",
      inputHash: "text",
      draftId: "text",
      cleared: "boolean",
      createdAt: "timestamp(3) without time zone",
    },
    nullable: ["operation", "mode", "inputHash", "draftId", "cleared"],
    key: ["actorId", "intentId"],
    checks: translationChecks,
    guard: "translation_intent_receipt_immutable",
    message: "Translation intent receipts are immutable",
  },
};
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const typeNames: Record<string, string> = {
  text: "text",
  integer: "int4",
  boolean: "bool",
  "timestamp(3) without time zone": "timestamp",
};

/** Validate against a positive contract before producing portable hash input. */
export function validateReceiptGuardMetadata(
  table: ReceiptTable,
  metadata: ReceiptGuardMetadata,
) {
  const contract = contracts[table];
  const expectedFields = Object.entries(contract.fields).sort(([a], [b]) =>
    compare(a, b),
  );
  const fields = [...metadata.columns].sort((a, b) =>
    compare(String(a.column_name), String(b.column_name)),
  );
  operatorAssert(
    fields.length === expectedFields.length,
    "UNREVIEWED_RECEIPT_GUARD_METADATA",
  );
  fields.forEach((field, index) => {
    const expected = expectedFields[index]!;
    operatorAssert(
      field.column_name === expected[0] &&
        field.type === expected[1] &&
        field.type_schema === "pg_catalog" &&
        field.type_name === typeNames[expected[1]] &&
        field.collation_schema ===
          (expected[1] === "text" ? "pg_catalog" : null) &&
        field.collation_name === (expected[1] === "text" ? "default" : null) &&
        field.collation_deterministic ===
          (expected[1] === "text" ? true : null) &&
        field.not_null === !contract.nullable.includes(expected[0]) &&
        field.identity_kind === "" &&
        field.generated_kind === "" &&
        field.default_expression ===
          (expected[0] === "createdAt" ? "CURRENT_TIMESTAMP" : null) &&
        field.relkind === "r" &&
        field.relpersistence === "p" &&
        field.relrowsecurity === false &&
        field.relforcerowsecurity === false,
      "UNREVIEWED_RECEIPT_GUARD_METADATA",
    );
  });
  const checks: Record<string, string> = contract.checks;
  // PG18 also exposes NOT NULL as constraints; PG16 exposes attnotnull only.
  // Normalize a complete known set to the already-validated column evidence,
  // never discard arbitrary/partial `n` rows or weaken the CHECK/PK contract.
  const notNull = metadata.constraints.filter(
    (constraint) => constraint.kind === "n",
  );
  if (notNull.length) {
    const required = expectedFields
      .filter(([field]) => !contract.nullable.includes(field))
      .map(([field]) => field);
    operatorAssert(
      notNull.length === required.length,
      "UNREVIEWED_RECEIPT_GUARD_METADATA",
    );
    const seen = new Set<string>();
    for (const constraint of notNull) {
      const field = required.find((field) =>
        equal(constraint.key_columns, [field]),
      );
      operatorAssert(
        field !== undefined &&
          !seen.has(field) &&
          constraint.name === `${table}_${field}_not_null` &&
          constraint.validated === true &&
          constraint.deferrable === false &&
          constraint.deferred === false &&
          constraint.local === true &&
          constraint.inherited === 0 &&
          constraint.no_inherit === false &&
          constraint.builtin_dependencies_only === true &&
          constraint.expression === null &&
          [
            "index_valid",
            "index_ready",
            "index_live",
            "index_unique",
            "index_primary",
            "index_method",
            "index_key_count",
            "index_attribute_count",
            "index_opclass_contract",
            "index_predicate",
            "index_expressions",
          ].every((key) => constraint[key] === null) &&
          equal(constraint.index_opclasses, []) &&
          equal(constraint.index_collations, []),
        "UNREVIEWED_RECEIPT_GUARD_METADATA",
      );
      seen.add(field);
    }
  }
  const constraints = metadata.constraints
    .filter((constraint) => constraint.kind !== "n")
    .sort((a, b) => compare(String(a.name), String(b.name)));
  operatorAssert(
    constraints.length === Object.keys(checks).length + 1,
    "UNREVIEWED_RECEIPT_GUARD_METADATA",
  );
  const canonicalConstraints = constraints.map((constraint) => {
    operatorAssert(
      constraint.validated === true &&
        constraint.deferrable === false &&
        constraint.deferred === false &&
        constraint.local === true &&
        constraint.inherited === 0 &&
        constraint.builtin_dependencies_only === true,
      "UNREVIEWED_RECEIPT_GUARD_METADATA",
    );
    if (constraint.name === `${table}_pkey`) {
      operatorAssert(
        constraint.kind === "p" &&
          equal(constraint.key_columns, contract.key) &&
          constraint.index_valid === true &&
          constraint.index_ready === true &&
          constraint.index_live === true &&
          constraint.index_unique === true &&
          constraint.index_primary === true &&
          constraint.index_method === "btree" &&
          constraint.index_key_count === contract.key.length &&
          constraint.index_attribute_count === contract.key.length &&
          equal(
            constraint.index_opclasses,
            contract.key.map(() => "pg_catalog.text_ops"),
          ) &&
          constraint.index_opclass_contract === true &&
          equal(
            constraint.index_collations,
            contract.key.map(() => "pg_catalog.default"),
          ) &&
          constraint.index_predicate === null &&
          constraint.index_expressions === null,
        "UNREVIEWED_RECEIPT_GUARD_METADATA",
      );
      return {
        name: constraint.name,
        kind: "p",
        key: contract.key,
        index: {
          method: constraint.index_method,
          opclasses: constraint.index_opclasses,
          collations: constraint.index_collations,
          builtinTextContract: constraint.index_opclass_contract,
          keyCount: constraint.index_key_count,
          attributeCount: constraint.index_attribute_count,
          valid: true,
          ready: true,
          live: true,
          unique: true,
          primary: true,
        },
      };
    }
    const expected = checks[String(constraint.name)];
    operatorAssert(
      expected !== undefined &&
        constraint.kind === "c" &&
        constraint.no_inherit === false &&
        typeof constraint.expression === "string",
      "UNREVIEWED_RECEIPT_GUARD_METADATA",
    );
    const expression = checkTree(String(constraint.expression));
    operatorAssert(
      equal(expression, checkTree(expected)),
      "UNREVIEWED_RECEIPT_GUARD_METADATA",
    );
    return { name: constraint.name, kind: "c", expression };
  });
  operatorAssert(
    metadata.triggers.length === 1,
    "UNREVIEWED_RECEIPT_GUARD_METADATA",
  );
  const trigger = metadata.triggers[0]!;
  operatorAssert(
    trigger.name === contract.guard &&
      trigger.enabled === "O" &&
      trigger.type === 27 &&
      trigger.columns === "" &&
      trigger.when_expression === null &&
      trigger.arguments === "" &&
      trigger.unconstrained === true &&
      trigger.deferrable === false &&
      trigger.deferred === false &&
      trigger.function_schema === "public" &&
      trigger.function_name === contract.guard &&
      trigger.language === "plpgsql" &&
      trigger.result_type === "trigger" &&
      trigger.argument_count === 0 &&
      trigger.function_kind === "f" &&
      trigger.volatility === "v" &&
      trigger.parallel === "u" &&
      trigger.security_definer === false &&
      trigger.leakproof === false &&
      trigger.strict === false &&
      trigger.returns_set === false &&
      trigger.configuration === null &&
      typeof trigger.body === "string",
    "UNREVIEWED_RECEIPT_GUARD_METADATA",
  );
  const body = tokens(String(trigger.body));
  const expectedBody = tokens(
    `BEGIN RAISE EXCEPTION '${contract.message}' USING ERRCODE='23514'; END`,
  );
  operatorAssert(
    equal(body, expectedBody),
    "UNREVIEWED_RECEIPT_GUARD_METADATA",
  );
  // Never hash OIDs, owners, search_path-dependent function headers or connection
  // metadata. Every property below has first passed the known migration contract.
  return {
    table,
    version: 1,
    columns: fields,
    constraints: canonicalConstraints,
    immutable: { ...trigger, body },
  };
}

export async function readReceiptGuardMetadata(
  db: OperatorSql,
  table: ReceiptTable,
) {
  const columns = await db.query(
    `SELECT /* receipt_guard_columns */
    a.attname AS column_name, format_type(a.atttypid,a.atttypmod) AS type,
    tn.nspname AS type_schema,ty.typname AS type_name,cn.nspname AS collation_schema,co.collname AS collation_name,
    co.collisdeterministic AS collation_deterministic,
    a.attnotnull AS not_null,a.attidentity AS identity_kind,a.attgenerated AS generated_kind,
    left(pg_get_expr(d.adbin,d.adrelid),1025) AS default_expression,
    c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    JOIN pg_type ty ON ty.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=ty.typnamespace
    LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY a.attname LIMIT 33`,
    [table],
  );
  const constraints = await db.query(
    `SELECT /* receipt_guard_constraints */
    c.conname AS name,c.contype AS kind,c.convalidated AS validated,
    c.condeferrable AS deferrable,c.condeferred AS deferred,c.connoinherit AS no_inherit,
    c.conislocal AS local,c.coninhcount AS inherited,left(pg_get_expr(c.conbin,c.conrelid),16385) AS expression,
    NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_constraint'::regclass AND d.objid=c.oid
      AND d.deptype='n' AND NOT ((d.refclassid='pg_class'::regclass AND d.refobjid=c.conrelid)
        OR (d.refclassid='pg_namespace'::regclass AND d.refobjid=n.oid))) AS builtin_dependencies_only,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinal)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ordinal LIMIT 33) AS key_columns,
    i.indisvalid AS index_valid,i.indisready AS index_ready,i.indislive AS index_live,
    i.indisunique AS index_unique,i.indisprimary AS index_primary,m.amname AS index_method,
    i.indnkeyatts AS index_key_count,i.indnatts AS index_attribute_count,
    ARRAY(SELECT onsp.nspname||'.'||op.opcname FROM unnest(i.indclass) WITH ORDINALITY k(opclass_oid,ordinal)
      JOIN pg_opclass op ON op.oid=k.opclass_oid JOIN pg_namespace onsp ON onsp.oid=op.opcnamespace ORDER BY k.ordinal LIMIT 33) AS index_opclasses,
    (SELECT bool_and(op.opcdefault AND op.opcintype='pg_catalog.text'::regtype AND am.amname='btree')
      FROM unnest(i.indclass) k(opclass_oid) JOIN pg_opclass op ON op.oid=k.opclass_oid JOIN pg_am am ON am.oid=op.opcmethod) AS index_opclass_contract,
    ARRAY(SELECT cn.nspname||'.'||co.collname FROM unnest(i.indcollation) WITH ORDINALITY k(collation_oid,ordinal)
      JOIN pg_collation co ON co.oid=k.collation_oid JOIN pg_namespace cn ON cn.oid=co.collnamespace ORDER BY k.ordinal LIMIT 33) AS index_collations,
    left(pg_get_expr(i.indpred,i.indrelid),16385) AS index_predicate,left(pg_get_expr(i.indexprs,i.indrelid),16385) AS index_expressions
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_index i ON i.indexrelid=c.conindid LEFT JOIN pg_class ix ON ix.oid=c.conindid
    LEFT JOIN pg_am m ON m.oid=ix.relam WHERE n.nspname='public' AND t.relname=$1
    ORDER BY c.conname LIMIT 33`,
    [table],
  );
  const triggers = await db.query(
    `SELECT /* receipt_guard_triggers */
    t.tgname AS name,t.tgenabled AS enabled,t.tgtype AS type,left(t.tgattr::text,1025) AS columns,
    left(pg_get_expr(t.tgqual,t.tgrelid),16385) AS when_expression,left(encode(t.tgargs,'hex'),16385) AS arguments,
    (t.tgconstraint=0) AS unconstrained,t.tgdeferrable AS deferrable,t.tginitdeferred AS deferred,
    pn.nspname AS function_schema,p.proname AS function_name,l.lanname AS language,
    p.prorettype::regtype::text AS result_type,p.pronargs AS argument_count,p.prokind AS function_kind,
    p.provolatile AS volatility,p.proparallel AS parallel,p.prosecdef AS security_definer,
    p.proleakproof AS leakproof,p.proisstrict AS strict,p.proretset AS returns_set,
    CASE WHEN p.proconfig IS NULL THEN NULL ELSE ARRAY['unreviewed']::text[] END AS configuration,
    left(p.prosrc,16385) AS body
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND c.relname=$1 AND NOT t.tgisinternal ORDER BY t.tgname LIMIT 33`,
    [table],
  );
  return validateReceiptGuardMetadata(table, {
    columns: columns.rows,
    constraints: constraints.rows,
    triggers: triggers.rows,
  });
}
