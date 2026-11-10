import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { planHash } from "./operator-plan";
import {
  readReceiptGuardMetadata,
  validateReceiptGuardMetadata,
  type ReceiptTable,
} from "./receipt-guard-metadata";
import { receiptGuardFixture } from "./receipt-guard-metadata.test-fixtures";

const tables: ReceiptTable[] = [
  "HistoricalInvitationOperationClosure",
  "TranslationIntentReceipt",
];
const rejected = "UNREVIEWED_RECEIPT_GUARD_METADATA";
describe("known terminal receipt guard metadata", () => {
  it.each(tables)(
    "accepts %s migration CHECK/function text without deployment OIDs in portable evidence",
    (table) => {
      const fixture = receiptGuardFixture(table);
      const evidence = validateReceiptGuardMetadata(table, fixture);
      expect(planHash(evidence)).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(evidence)).not.toMatch(
        /proowner|tgfoid|conrelid|pid|CREATE FUNCTION/,
      );
    },
  );

  it.each(tables)(
    "normalizes complete PG18 %s NOT NULL constraints to PG16 attnotnull evidence",
    (table) => {
      expect(
        validateReceiptGuardMetadata(table, receiptGuardFixture(table, true)),
      ).toEqual(
        validateReceiptGuardMetadata(table, receiptGuardFixture(table)),
      );
    },
  );

  it.each(tables)(
    "rejects %s partial, duplicate, unknown or weakened NOT NULL constraint metadata",
    (table) => {
      for (const change of [
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints.splice(
            f.constraints.findIndex((row) => row.kind === "n"),
            1,
          );
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints.push({
            ...f.constraints.find((row) => row.kind === "n"),
          });
        },
        ...Object.entries({
          name: "unreviewed_not_null",
          validated: false,
          deferrable: true,
          deferred: true,
          local: false,
          inherited: 1,
          no_inherit: true,
          builtin_dependencies_only: false,
          expression: "true",
          key_columns: ["unknownField"],
          index_valid: true,
          index_opclasses: ["pg_catalog.text_ops"],
        }).map(
          ([key, value]) =>
            (f: ReturnType<typeof receiptGuardFixture>) => {
              f.constraints.find((row) => row.kind === "n")![key] = value;
            },
        ),
      ]) {
        const fixture = receiptGuardFixture(table, true);
        change(fixture);
        expect(() => validateReceiptGuardMetadata(table, fixture)).toThrow(
          rejected,
        );
      }
      const nullable = receiptGuardFixture("TranslationIntentReceipt", true);
      const row = nullable.constraints.find((row) => row.kind === "n")!;
      row.name = "TranslationIntentReceipt_cleared_not_null";
      row.key_columns = ["cleared"];
      expect(() =>
        validateReceiptGuardMetadata("TranslationIntentReceipt", nullable),
      ).toThrow(rejected);
    },
  );

  // Sanitized root-owned catalog captures contain no receipt/participant rows.
  // Vendored fixtures keep this regression available when outputs/ is absent.
  it.each(tables)(
    "accepts actual migrated %s metadata with NOT NULL catalog rows without broadening CHECK grammar",
    (table) => {
      const metadata = JSON.parse(
        readFileSync(
          new URL(`./fixtures/receipt-guards/${table}.json`, import.meta.url),
          "utf8",
        ),
      ) as Parameters<typeof validateReceiptGuardMetadata>[1];
      expect(validateReceiptGuardMetadata(table, metadata)).toEqual(
        validateReceiptGuardMetadata(table, receiptGuardFixture(table)),
      );
    },
  );

  it.each(tables)(
    "rejects %s missing/extra keys, nullability and identity/default changes",
    (table) => {
      for (const change of [
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.columns.pop();
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.columns.push({ ...f.columns[0], column_name: "unexpected" });
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.columns[0]!.not_null = !f.columns[0]!.not_null;
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.columns[0]!.identity_kind = "a";
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.columns[0]!.default_expression = "'replacement'::text";
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.columns[0]!.relrowsecurity = true;
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.columns[0]!.type_schema = "unreviewed";
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.columns[0]!.collation_name = "C";
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.columns[0]!.collation_deterministic = false;
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints[0]!.key_columns = ["inputHash"];
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints[0]!.index_valid = false;
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints[0]!.deferrable = true;
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints[0]!.builtin_dependencies_only = false;
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints[0]!.index_opclasses = (
            f.constraints[0]!.index_opclasses as string[]
          ).map((value, index) =>
            index === 0 ? "unreviewed.custom_text_ops" : value,
          );
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints[0]!.index_opclass_contract = false;
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints[0]!.index_collations = (
            f.constraints[0]!.index_collations as string[]
          ).map((value, index) => (index === 0 ? "pg_catalog.C" : value));
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints[0]!.index_attribute_count = 4;
        },
        (f: ReturnType<typeof receiptGuardFixture>) => {
          f.constraints.push({
            ...f.constraints[0],
            name: "unknown_constraint",
          });
        },
      ]) {
        const fixture = receiptGuardFixture(table);
        change(fixture);
        expect(() => validateReceiptGuardMetadata(table, fixture)).toThrow(
          rejected,
        );
      }
    },
  );

  it.each(tables)(
    "rejects %s disabled, conditional, wrong-event and replaced immutable functions",
    (table) => {
      for (const [field, value] of [
        ["enabled", "D"],
        ["enabled", "R"],
        ["type", 19],
        ["columns", "1"],
        ["when_expression", "false"],
        ["arguments", "00"],
        ["function_schema", "untrusted"],
        ["function_name", "different_immutable"],
        ["security_definer", true],
        ["configuration", ["search_path=evil"]],
        ["body", "BEGIN RETURN OLD; END"],
        ["body", "BEGIN RAISE NOTICE 'immutable'; RETURN OLD; END"],
        ["body", "x".repeat(16_385)],
      ]) {
        const fixture = receiptGuardFixture(table);
        fixture.triggers[0]![String(field)] = value;
        expect(() => validateReceiptGuardMetadata(table, fixture)).toThrow(
          rejected,
        );
      }
      const missing = receiptGuardFixture(table);
      missing.triggers = [];
      expect(() => validateReceiptGuardMetadata(table, missing)).toThrow(
        rejected,
      );
      const extra = receiptGuardFixture(table);
      extra.triggers.push({ ...extra.triggers[0] });
      expect(() => validateReceiptGuardMetadata(table, extra)).toThrow(
        rejected,
      );
    },
  );

  it("normalizes PostgreSQL IN/ANY text casts and harmless parentheses without changing precedence", () => {
    const plain = receiptGuardFixture("TranslationIntentReceipt");
    const deparsed = receiptGuardFixture("TranslationIntentReceipt");
    const status = deparsed.constraints.find(
      (row) => row.name === "translation_intent_receipt_status",
    )!;
    status.expression = `((status = ANY (ARRAY['ACCEPTED'::text, 'STOPPED'::text])))`;
    const protocol = deparsed.constraints.find(
      (row) => row.name === "translation_intent_receipt_protocol",
    )!;
    protocol.expression = `(("protocolVersion" = 1::integer))`;
    expect(
      validateReceiptGuardMetadata("TranslationIntentReceipt", deparsed),
    ).toEqual(validateReceiptGuardMetadata("TranslationIntentReceipt", plain));
  });

  it("refuses changed CHECK grouping/null semantics, extra true branches, unknown grammar and oversized definitions", () => {
    for (const [name, expression] of [
      [
        "translation_intent_receipt_status",
        `status IN ('ACCEPTED', 'STOPPED', 'OTHER')`,
      ],
      ["translation_intent_receipt_protocol", `"protocolVersion" = 1 OR true`],
      [
        "translation_intent_receipt_protocol",
        `coalesce("protocolVersion", 1) = 1`,
      ],
      ["translation_intent_receipt_protocol", `"protocolVersion" >= 1`],
      [
        "translation_intent_receipt_protocol",
        `${"(".repeat(70)}"protocolVersion" = 1${")".repeat(70)}`,
      ],
      ["translation_intent_receipt_protocol", " ".repeat(16_385)],
    ]) {
      const fixture = receiptGuardFixture("TranslationIntentReceipt");
      fixture.constraints.find((row) => row.name === name)!.expression =
        expression;
      expect(() =>
        validateReceiptGuardMetadata("TranslationIntentReceipt", fixture),
      ).toThrow(rejected);
    }
    for (const modify of [
      (s: string) =>
        s.replace('"operation" IS NOT NULL', '"operation" IS NULL'),
      (s: string) =>
        s.replace(/\("status" = 'STOPPED' AND/, `("status" = 'STOPPED' OR`),
      (s: string) => `${s} OR true`,
    ]) {
      const fixture = receiptGuardFixture("TranslationIntentReceipt");
      const binding = fixture.constraints.find(
        (row) => row.name === "translation_intent_receipt_binding",
      )!;
      binding.expression = modify(String(binding.expression));
      expect(() =>
        validateReceiptGuardMetadata("TranslationIntentReceipt", fixture),
      ).toThrow(rejected);
    }
    for (const field of ["validated", "local"]) {
      const fixture = receiptGuardFixture("TranslationIntentReceipt");
      fixture.constraints[1]![field] = false;
      expect(() =>
        validateReceiptGuardMetadata("TranslationIntentReceipt", fixture),
      ).toThrow(rejected);
    }
    const incomplete = receiptGuardFixture("TranslationIntentReceipt");
    incomplete.constraints.pop();
    expect(() =>
      validateReceiptGuardMetadata("TranslationIntentReceipt", incomplete),
    ).toThrow(rejected);
  });

  it("reads only bounded public-table catalog metadata using parameterized ledger identity", async () => {
    const fixture = receiptGuardFixture("TranslationIntentReceipt");
    const calls: { sql: string; values: unknown[] | undefined }[] = [];
    const metadata = await readReceiptGuardMetadata(
      {
        async query(sql, values) {
          calls.push({ sql, values });
          return {
            rows: sql.includes("receipt_guard_columns")
              ? fixture.columns
              : sql.includes("receipt_guard_constraints")
                ? fixture.constraints
                : fixture.triggers,
          };
        },
        async close() {
          throw new Error("Caller owns connection");
        },
      },
      "TranslationIntentReceipt",
    );
    expect(metadata).toEqual(
      validateReceiptGuardMetadata("TranslationIntentReceipt", fixture),
    );
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.sql).toMatch(/^SELECT\b/);
      expect(call.sql).toContain("LIMIT 33");
      expect(call.values).toEqual(["TranslationIntentReceipt"]);
    }
    expect(calls[1]!.sql).toContain(
      "left(pg_get_expr(c.conbin,c.conrelid),16385)",
    );
    expect(calls[2]!.sql).toContain("left(p.prosrc,16385)");
  });
});
