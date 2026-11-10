import { readFileSync } from "node:fs";
import type { ReceiptGuardMetadata, ReceiptTable } from "./receipt-guard-metadata";

/** Synthetic catalog rows, with actual migration CHECK/body text as input. */
export function receiptGuardFixture(table: ReceiptTable, withNotNullConstraints = false): ReceiptGuardMetadata {
  const translation = table === "TranslationIntentReceipt";
  const migration = translation
    ? "20261109020000_translation_intent_receipts"
    : "20261109010000_historical_invitation_operation_closure";
  const sql = readFileSync(new URL(`../../../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8");
  const fieldTypes: Record<string, string> = translation
    ? { actorId: "text", intentId: "text", protocolVersion: "integer", status: "text", operation: "text", mode: "text", inputHash: "text", draftId: "text", cleared: "boolean", createdAt: "timestamp(3) without time zone" }
    : { operationId: "text", issuedById: "text", inputHash: "text", scopeKey: "text", createdAt: "timestamp(3) without time zone" };
  const nullable = translation ? ["operation", "mode", "inputHash", "draftId", "cleared"] : [];
  const columns = Object.entries(fieldTypes).map(([column_name, type]) => ({
    column_name, type, not_null: !nullable.includes(column_name), identity_kind: "", generated_kind: "",
    type_schema: "pg_catalog", type_name: type === "boolean" ? "bool" : type === "integer" ? "int4" : type === "text" ? "text" : "timestamp",
    collation_schema: type === "text" ? "pg_catalog" : null, collation_name: type === "text" ? "default" : null,
    collation_deterministic: type === "text" ? true : null,
    default_expression: column_name === "createdAt" ? "CURRENT_TIMESTAMP" : null,
    relkind: "r", relpersistence: "p", relrowsecurity: false, relforcerowsecurity: false,
  }));
  const constraints: Record<string, unknown>[] = [{
    name: `${table}_pkey`, kind: "p", validated: true, deferrable: false, deferred: false,
    local: true, inherited: 0, builtin_dependencies_only: true, no_inherit: true, expression: null,
    key_columns: translation ? ["actorId", "intentId"] : ["operationId"],
    index_valid: true, index_ready: true, index_live: true, index_unique: true, index_primary: true,
    index_method: "btree", index_predicate: null, index_expressions: null,
    index_key_count: translation ? 2 : 1, index_attribute_count: translation ? 2 : 1,
    index_opclasses: Array.from({ length: translation ? 2 : 1 }, () => "pg_catalog.text_ops"),
    index_opclass_contract: true,
    index_collations: Array.from({ length: translation ? 2 : 1 }, () => "pg_catalog.default"),
  }];
  // This balanced reader is test-only. Production uses a fixed positive grammar
  // and fixed expected expressions, independent of this migration extraction.
  for (const match of sql.matchAll(/CONSTRAINT (\w+) CHECK\s*\(/g)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let quoted = false;
    let end = start;
    for (; depth > 0 && end < sql.length; end++) {
      const character = sql[end];
      if (character === "'") {
        if (quoted && sql[end + 1] === "'") { end++; continue; }
        quoted = !quoted;
      }
      if (!quoted) {
        if (character === "(") depth++;
        if (character === ")") depth--;
      }
    }
    if (depth !== 0) throw new Error("Unbalanced migration CHECK fixture");
    constraints.push({ name: match[1], kind: "c", validated: true, deferrable: false, deferred: false,
      local: true, inherited: 0, builtin_dependencies_only: true, no_inherit: false, expression: sql.slice(start, end - 1), key_columns: [] });
  }
  if (withNotNullConstraints) for (const column of columns.filter((column) => column.not_null)) constraints.push({
    name: `${table}_${column.column_name}_not_null`, kind: "n", validated: true, deferrable: false, deferred: false,
    no_inherit: false, local: true, inherited: 0, expression: null, builtin_dependencies_only: true,
    key_columns: [column.column_name], index_valid: null, index_ready: null, index_live: null,
    index_unique: null, index_primary: null, index_method: null, index_key_count: null, index_attribute_count: null,
    index_opclasses: [], index_opclass_contract: null, index_collations: [], index_predicate: null, index_expressions: null,
  });
  const name = translation ? "translation_intent_receipt_immutable" : "historical_invitation_operation_closure_immutable";
  const body = /AS \$\$([\s\S]*?)\$\$/.exec(sql)?.[1];
  if (!body) throw new Error("Missing migration function fixture");
  return { columns, constraints, triggers: [{ name, enabled: "O", type: 27, columns: "", when_expression: null,
    arguments: "", unconstrained: true, deferrable: false, deferred: false,
    function_schema: "public", function_name: name, language: "plpgsql", result_type: "trigger",
    argument_count: 0, function_kind: "f", volatility: "v", parallel: "u", security_definer: false,
    leakproof: false, strict: false, returns_set: false, configuration: null, body }] };
}
