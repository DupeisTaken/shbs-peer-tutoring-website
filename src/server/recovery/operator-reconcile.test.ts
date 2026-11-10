import { describe, expect, it } from "vitest";
import {
  assertRotatedSigningSecrets,
  inspectSiteSecurityReconciliation,
  validateSecurityIdentityClosure,
  readReconciliationSnapshot,
  reconcileSecuritySnapshot,
  type OverlaySnapshot,
} from "./operator-reconcile";
import type { OperatorSql } from "./operator-site";
import { reviewedRecoverySchemaMetadata } from "./operator-schema";
import { receiptGuardFixture } from "./receipt-guard-metadata.test-fixtures";
import type { ReceiptGuardMetadata, ReceiptTable } from "./receipt-guard-metadata";

function fixture(
  options: { restriction?: Date; tooLarge?: boolean; fail?: boolean } = {},
) {
  const queries: string[] = [];
  const db: OperatorSql = {
    async query(sql) {
      queries.push(sql);
      if (options.fail && sql.includes("information_schema"))
        throw new Error("Synthetic read failure");
      if (sql.includes("information_schema"))
        return {
          rows: [
            {
              table_name: "User",
              column_name: "id",
              data_type: "text",
              udt_name: "text",
            },
          ],
        };
      if (sql.includes("count(*)")) return { rows: [{ count: "0" }] };
      if (sql.includes('FROM public."User"')) {
        return {
          rows: options.tooLarge
            ? Array.from({ length: 10_001 }, (_, id) => ({ id: String(id) }))
            : [{ id: "synthetic", suspendedAt: options.restriction ?? null }],
        };
      }
      return { rows: [] };
    },
    async close() {
      throw new Error("Inspection must not close caller-owned connections");
    },
  };
  return { db, queries };
}

describe("operator security reconciliation evidence", () => {
  it("fingerprints archive boundaries and refuses an overlay that loses provenance", async () => {
    const snapshot = async (
      known: boolean,
      records: Record<string, unknown>[],
    ) => {
      const queries: string[] = [];
      const db: OperatorSql = {
        async query(sql) {
          queries.push(sql);
          if (sql.includes("information_schema"))
            return {
              rows: [
                ...reviewedRecoverySchemaMetadata.identityColumns,
                ...(known
                  ? reviewedRecoverySchemaMetadata.importProvenanceColumns
                  : []),
              ],
            };
          if (sql.includes("pg_enum"))
            return { rows: reviewedRecoverySchemaMetadata.enums };
          if (sql.includes("pg_trigger"))
            return {
              rows: [
                {
                  tgenabled: "O",
                  tgtype: 19,
                  proname: "advance_account_session_version",
                },
              ],
            };
          if (sql.includes('FROM public."ImportedRecordProvenance"'))
            return { rows: records.map((row) => ({ row })) };
          if (sql.includes("count(*)")) return { rows: [{ count: "0" }] };
          return { rows: [] };
        },
        async close() {
          throw new Error("Caller owns the SQL connection");
        },
      };
      return { state: await readReconciliationSnapshot(db), queries };
    };
    const current = await snapshot(true, [
      {
        entity: "Session",
        recordId: "archived-session",
        importedAt: "2026-11-08T00:00:00Z",
      },
    ]);
    const restored = await snapshot(true, []);
    expect(current.state.authorityFingerprints).not.toEqual(
      restored.state.authorityFingerprints,
    );
    expect(() =>
      validateSecurityIdentityClosure(current.state, restored.state),
    ).toThrow("CURRENT_AUTHORITY_REQUIRES_DOMAIN_RECONCILIATION");
    const old = await snapshot(false, []);
    expect(
      old.queries.some((sql) =>
        sql.includes('FROM public."ImportedRecordProvenance"'),
      ),
    ).toBe(false);
    expect(JSON.stringify(current.state)).not.toContain("archived-session");
  });
  it("fingerprints retained decline authority and reads reviewed older backups without a nonexistent table", async () => {
    const snapshot = async (
      known: boolean,
      contact = "PRIVATE-DECLINE-INTAKE",
      retry = "key",
    ) => {
      const queries: string[] = [];
      const db: OperatorSql = {
        async query(sql) {
          queries.push(sql);
          if (sql.includes("information_schema"))
            return {
              rows: known
                ? reviewedRecoverySchemaMetadata.identityLegacyDeclineColumns
                : reviewedRecoverySchemaMetadata.identityColumns,
            };
          if (sql.includes("pg_enum"))
            return { rows: reviewedRecoverySchemaMetadata.enums };
          if (sql.includes("pg_trigger"))
            return {
              rows: [
                {
                  tgenabled: "O",
                  tgtype: 19,
                  proname: "advance_account_session_version",
                },
              ],
            };
          if (sql.includes('FROM public."LegacySignupDecline"'))
            return {
              rows: [
                {
                  row: {
                    tuteeId: "declined",
                    termId: "old-term",
                    intakeSnapshot: { contact },
                    clientKey: retry,
                    inputHash: retry,
                  },
                },
              ],
            };
          if (sql.includes("count(*)")) return { rows: [{ count: "0" }] };
          return { rows: [] };
        },
        async close() {
          throw new Error("Caller owns the SQL connection");
        },
      };
      return { state: await readReconciliationSnapshot(db), queries };
    };
    const before = await snapshot(true);
    const changedIntake = await snapshot(true, "changed private intake");
    const changedRetry = await snapshot(
      true,
      "PRIVATE-DECLINE-INTAKE",
      "fresh-retry-key",
    );
    const declineAuthority = (state: OverlaySnapshot) =>
      state.authorityFingerprints.find(
        (row) => row.table === "LegacySignupDecline",
      );
    expect(declineAuthority(before.state)).toBeDefined();
    expect(declineAuthority(changedIntake.state)).not.toEqual(
      declineAuthority(before.state),
    );
    expect(declineAuthority(changedRetry.state)).toEqual(
      declineAuthority(before.state),
    );
    expect(JSON.stringify(before.state)).not.toContain(
      "PRIVATE-DECLINE-INTAKE",
    );
    const old = await snapshot(false);
    expect(declineAuthority(old.state)).toBeUndefined();
    expect(
      old.queries.some((sql) =>
        sql.includes('FROM public."LegacySignupDecline"'),
      ),
    ).toBe(false);
  });
  it("compares normalized restriction timestamps in read-only snapshots without clearing cutover blockers", async () => {
    const source = fixture({ restriction: new Date("2026-02-02T00:00:00Z") });
    const restored = fixture({ restriction: new Date("2026-02-01T00:00:00Z") });
    const report = await inspectSiteSecurityReconciliation(
      source.db,
      restored.db,
    );
    expect(
      report.comparison.find(({ table }) => table === "User")?.changed,
    ).toBe(true);
    expect(report.currentFingerprint).not.toBe(report.restoredFingerprint);
    expect(report.state).toBe(
      "BLOCKED_SECURITY_RECONCILIATION_AND_MANUAL_REVIEW",
    );
    expect(report.blockers).toContain(
      "REVIEW_MISSING_IDENTITIES_AND_FOREIGN_KEY_OWNERSHIP",
    );
    for (const { queries } of [source, restored]) {
      expect(queries[0]).toBe(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      expect(queries.at(-1)).toBe("COMMIT");
      expect(queries.every((sql) => /^(BEGIN|SELECT|COMMIT)/.test(sql))).toBe(
        true,
      );
      expect(queries.some((sql) => sql.includes("SELECT *"))).toBe(false);
      expect(
        queries.some(
          (sql) =>
            /SELECT.*(?:email|passwordHash|tokenHash|codeHash)/s.test(sql) &&
            !sql.includes("count(*)"),
        ),
      ).toBe(false);
    }
  });

  it("equal snapshots remain blocked because equality never authorizes credential revival", async () => {
    const report = await inspectSiteSecurityReconciliation(
      fixture().db,
      fixture().db,
    );
    expect(report.comparison.every(({ changed }) => !changed)).toBe(true);
    expect(report.blockers).toContain(
      "INVALIDATE_ALL_RESTORED_PASSWORDS_SESSIONS_AND_CAPABILITIES",
    );
    expect(report.blockers).toContain(
      "ROTATE_AUTH_SECRET_OR_ESTABLISH_NONREUSABLE_SESSION_EPOCHS",
    );
    expect(JSON.stringify(report)).not.toContain('"synthetic"');
  });

  it("rolls back bounded failures before reading the restored database", async () => {
    for (const options of [{ tooLarge: true }, { fail: true }]) {
      const source = fixture(options);
      const restored = fixture();
      await expect(
        inspectSiteSecurityReconciliation(source.db, restored.db),
      ).rejects.toThrow();
      expect(source.queries.at(-1)).toBe("ROLLBACK");
      expect(restored.queries).toEqual([]);
    }
  });
});

function identitySnapshot(
  accounts: Record<string, unknown>[],
): OverlaySnapshot {
  return {
    identityVersion: 0,
    accounts: accounts.map((row) => ({
      email: `${row.id as string}@example.test`,
      sessionVersion: 0,
      refreshAuthorityRevision: 0,
      tutorId: null,
      studentId: null,
      personId: null,
      mergedIntoId: null,
      recoveryVoidedAt: null,
      ...row,
    })),
    tables: {
      Tutor: [],
      Tutee: [],
      Person: [],
      AccountEmail: [],
      TutorProfileOwnership: [],
      StudentProfileOwnership: [],
    },
    schema: [],
    trigger: { definition: "synthetic-reviewed-trigger", tgenabled: "O" },
    capabilityFingerprints: [],
    referenceIdentities: {},
    authorityFingerprints: [],
  };
}
describe("reviewed security overlay contracts", () => {
  it("supports current-only account closure and backup-only quarantine without inventing profiles", () => {
    expect(() =>
      validateSecurityIdentityClosure(
        identitySnapshot([{ id: "current" }]),
        identitySnapshot([{ id: "backup" }]),
      ),
    ).not.toThrow();
    expect(() =>
      validateSecurityIdentityClosure(
        identitySnapshot([{ id: "current", tutorId: "missing" }]),
        identitySnapshot([]),
      ),
    ).toThrow("SECURITY_IDENTITY_CLOSURE_MISSING");
  });
  it("blocks contradictory retirement, identifier takeover, missing profile closure and epoch overflow", () => {
    expect(() =>
      validateSecurityIdentityClosure(
        identitySnapshot([{ id: "same", mergedIntoId: null }]),
        identitySnapshot([{ id: "same", mergedIntoId: "survivor" }]),
      ),
    ).toThrow("CONTRADICTORY_RETIRED_IDENTITY");
    expect(() =>
      validateSecurityIdentityClosure(
        identitySnapshot([{ id: "one", email: "taken@example.test" }]),
        identitySnapshot([{ id: "two", email: "taken@example.test" }]),
      ),
    ).toThrow("CONTRADICTORY_ACCOUNT_IDENTIFIER");
    const missing = identitySnapshot([]);
    missing.tables.Tutor = [{ id: "missing-profile" }];
    expect(() =>
      validateSecurityIdentityClosure(missing, identitySnapshot([])),
    ).toThrow("CURRENT_SECURITY_IDENTITY_NOT_IN_CHECKPOINT");
    expect(() =>
      validateSecurityIdentityClosure(
        identitySnapshot([{ id: "epoch", sessionVersion: 2147483647 }]),
        identitySnapshot([{ id: "epoch" }]),
      ),
    ).toThrow("RECOVERY_SECURITY_EPOCH_EXHAUSTED");
    expect(() =>
      validateSecurityIdentityClosure(
        identitySnapshot([{ id: "epoch", sessionVersion: 2000000000 }]),
        identitySnapshot([{ id: "epoch", sessionVersion: 1000000000 }]),
      ),
    ).not.toThrow();
  });
  it("requires a different bounded signing secret and persists only reviewed fingerprints", () => {
    const previous = "synthetic-previous-signing-secret-493",
      rotated = "synthetic-rotated-signing-secret-493";
    expect(() =>
      assertRotatedSigningSecrets({
        previousAuthSecret: previous,
        rotatedAuthSecret: previous,
      }),
    ).toThrow("RECOVERY_SIGNING_SECRET_MUST_ROTATE");
    const keys = assertRotatedSigningSecrets({
      previousAuthSecret: previous,
      rotatedAuthSecret: rotated,
    });
    expect(JSON.stringify(keys)).not.toContain(previous);
    expect(JSON.stringify(keys)).not.toContain(rotated);
    expect(() =>
      assertRotatedSigningSecrets(
        {
          previousAuthSecret: previous,
          rotatedAuthSecret: "different-but-still-long-signing-secret",
        },
        keys,
      ),
    ).toThrow("RECOVERY_SIGNING_SECRET_MISMATCH");
  });
});

type InvitationClosure = {
  operationId: string;
  issuedById: string;
  inputHash: string;
  scopeKey: string;
  createdAt: string;
};
const stoppedInvitation: InvitationClosure = {
  operationId: "00000000-0000-4000-8000-000000000614",
  issuedById: "synthetic-private-actor",
  inputHash: "a".repeat(64),
  scopeKey: "b".repeat(64),
  createdAt: "2026-11-09T01:00:00.000Z",
};
function invitationClosureDatabase(
  closures: InvitationClosure[],
  options: {
    present?: boolean; identity?: boolean; decline?: boolean;
    receipts?: Record<string, unknown>[];
    receiptPresent?: boolean;
    weakenGuard?: (table: ReceiptTable, guard: ReceiptGuardMetadata) => void;
  } = {},
) {
  const { present = true, identity = true, decline = true } = options;
  const metadata = reviewedRecoverySchemaMetadata;
  const baseColumns = identity
    ? decline
      ? metadata.identityLegacyDeclineColumns
      : metadata.identityColumns
    : decline
      ? metadata.legacyDeclineColumns
      : metadata.columns;
  const queries: string[] = [];
  const db: OperatorSql = {
    async query(sql, values) {
      queries.push(sql);
      if (sql.includes("information_schema"))
        return {
          rows: [
            ...baseColumns,
            ...(present
              ? metadata.historicalInvitationOperationClosureColumns
              : []),
            ...(options.receiptPresent ? metadata.translationIntentReceiptColumns : []),
          ],
        };
      if (sql.includes("pg_enum")) return { rows: metadata.enums };
      if (sql.includes("receipt_guard_")) {
        const table = values?.[0] as ReceiptTable;
        if (table === "HistoricalInvitationOperationClosure" && !present)
          throw new Error("Guard read must skip a missing closure table");
        if (table === "TranslationIntentReceipt" && !options.receiptPresent)
          throw new Error("Guard read must skip a missing translation receipt table");
        const guard = receiptGuardFixture(table);
        options.weakenGuard?.(table, guard);
        return { rows: sql.includes("receipt_guard_columns") ? guard.columns : sql.includes("receipt_guard_constraints") ? guard.constraints : guard.triggers };
      }
      if (sql.includes("pg_trigger"))
        return {
          rows: [
            {
              tgenabled: "O",
              tgtype: 19,
              proname: "advance_account_session_version",
              definition: "synthetic-reviewed-trigger",
              function: "synthetic-reviewed-function",
            },
          ],
        };
      if (sql.includes('"HistoricalInvitationOperationClosure"')) {
        if (!present) throw new Error("The older backup has no closure table");
        if (!/^SELECT\b/.test(sql))
          throw new Error(
            "Immutable stopped operations must never be rewritten",
          );
        return { rows: closures.map((row) => ({ row })) };
      }
      if (sql.includes('"TranslationIntentReceipt"')) {
        if (!options.receiptPresent) throw new Error("The older backup has no translation receipts");
        if (!/^SELECT\b/.test(sql)) throw new Error("Terminal translation receipts must never be rewritten");
        return { rows: (options.receipts ?? []).map((row) => ({ row })) };
      }
      if (sql.includes("to_regclass"))
        return { rows: [{ dirty: false, maintenance: false }] };
      if (sql.includes("count(*)")) return { rows: [{ count: "0" }] };
      if (sql.includes("AS fingerprint"))
        return { rows: [{ fingerprint: "0".repeat(64) }] };
      return { rows: [] };
    },
    async close() {
      throw new Error("Caller owns the synthetic SQL connection");
    },
  };
  return { db, queries };
}
const closureAuthority = (snapshot: OverlaySnapshot) =>
  snapshot.authorityFingerprints.find(
    (row) => row.table === "HistoricalInvitationOperationClosure",
  );

describe("stopped historical operation recovery fences", () => {
  it.each([
    { identity: false, decline: false },
    { identity: false, decline: true },
    { identity: true, decline: false },
    { identity: true, decline: true },
  ])(
    "reads legacy schema identity=$identity decline=$decline without querying a missing closure table",
    async (version) => {
      const old = invitationClosureDatabase([], { ...version, present: false });
      const snapshot = await readReconciliationSnapshot(old.db);
      expect(closureAuthority(snapshot)).toBeUndefined();
      expect(
        old.queries.some((sql) =>
          sql.includes('"HistoricalInvitationOperationClosure"'),
        ),
      ).toBe(false);
    },
  );

  it.each([
    { identity: false, decline: false },
    { identity: false, decline: true },
    { identity: true, decline: false },
    { identity: true, decline: true },
  ])(
    "fingerprints complete additive closure schema identity=$identity decline=$decline without exposing its values",
    async (version) => {
      const source = invitationClosureDatabase([stoppedInvitation], version);
      const snapshot = await readReconciliationSnapshot(source.db);
      const fingerprint: unknown = expect.stringMatching(/^[a-f0-9]{64}$/);
      expect(closureAuthority(snapshot)).toEqual({
        table: "HistoricalInvitationOperationClosure",
        fingerprint,
      });
      const serialized = JSON.stringify(snapshot);
      for (const value of Object.values(stoppedInvitation))
        expect(serialized).not.toContain(value);
      expect(
        snapshot.tables.HistoricalInvitationOperationClosure,
      ).toBeUndefined();
      expect(
        snapshot.capabilityFingerprints.some(
          (row) => row.table === "HistoricalInvitationOperationClosure",
        ),
      ).toBe(false);
      expect(source.queries.every((sql) => /^SELECT\b/.test(sql))).toBe(true);
    },
  );

  it.each([
    ["operationId", "00000000-0000-4000-8000-000000000615"],
    ["issuedById", "synthetic-different-owner"],
    ["inputHash", "c".repeat(64)],
    ["scopeKey", "d".repeat(64)],
    ["createdAt", "2026-11-09T02:00:00.000Z"],
  ] as const)(
    "refuses a changed closure %s before reconciliation in either cutover direction",
    async (field, value) => {
      const original = await readReconciliationSnapshot(
        invitationClosureDatabase([stoppedInvitation]).db,
      );
      const changed = await readReconciliationSnapshot(
        invitationClosureDatabase([{ ...stoppedInvitation, [field]: value }])
          .db,
      );
      expect(closureAuthority(original)).not.toEqual(closureAuthority(changed));
      expect(() => validateSecurityIdentityClosure(original, changed)).toThrow(
        "CURRENT_AUTHORITY_REQUIRES_DOMAIN_RECONCILIATION",
      );
      expect(() => validateSecurityIdentityClosure(changed, original)).toThrow(
        "CURRENT_AUTHORITY_REQUIRES_DOMAIN_RECONCILIATION",
      );
    },
  );

  it("refuses missing stopped-operation evidence during both restore and rollback review", async () => {
    const stopped = await readReconciliationSnapshot(
      invitationClosureDatabase([stoppedInvitation]).db,
    );
    const missing = await readReconciliationSnapshot(
      invitationClosureDatabase([]).db,
    );
    expect(() => validateSecurityIdentityClosure(stopped, missing)).toThrow(
      "CURRENT_AUTHORITY_REQUIRES_DOMAIN_RECONCILIATION",
    );
    expect(() => validateSecurityIdentityClosure(missing, stopped)).toThrow(
      "CURRENT_AUTHORITY_REQUIRES_DOMAIN_RECONCILIATION",
    );
  });

  it("preserves identical immutable closure evidence through reconciliation and rollback overlays", async () => {
    const first = invitationClosureDatabase([stoppedInvitation]);
    const second = invitationClosureDatabase([stoppedInvitation]);
    const current = await readReconciliationSnapshot(first.db);
    const restored = await readReconciliationSnapshot(second.db);
    expect(() =>
      validateSecurityIdentityClosure(current, restored),
    ).not.toThrow();
    const applied = await reconcileSecuritySnapshot(
      second.db,
      current,
      restored,
    );
    expect(closureAuthority(applied.finalState)).toEqual(
      closureAuthority(current),
    );
    expect(() =>
      validateSecurityIdentityClosure(applied.finalState, current),
    ).not.toThrow();
    const rolledBack = await reconcileSecuritySnapshot(
      first.db,
      applied.finalState,
      current,
    );
    expect(closureAuthority(rolledBack.finalState)).toEqual(
      closureAuthority(current),
    );
    for (const target of [first, second])
      expect(
        target.queries
          .filter((sql) =>
            sql.includes('"HistoricalInvitationOperationClosure"'),
          )
          .every((sql) => /^SELECT\b/.test(sql)),
      ).toBe(true);
  });

  it("keeps the authority read bounded instead of accepting an oversized closure ledger", async () => {
    const oversized = invitationClosureDatabase(
      Array.from({ length: 10_001 }, (_, index) => ({
        ...stoppedInvitation,
        operationId: `synthetic-${index}`,
      })),
    );
    await expect(readReconciliationSnapshot(oversized.db)).rejects.toThrow(
      "SECURITY_MANIFEST_TOO_LARGE",
    );
  });
});

const acceptedTranslation = {
  actorId: "synthetic-private-translator",
  intentId: "00000000-0000-4000-8000-000000000654",
  protocolVersion: 1,
  status: "ACCEPTED",
  operation: "localization.setString",
  mode: "DRAFT",
  inputHash: "e".repeat(64),
  draftId: "synthetic-private-accepted-draft",
  cleared: false,
  createdAt: "2026-11-09T03:00:00.000Z",
};
const stoppedTranslation = {
  ...acceptedTranslation, intentId: "00000000-0000-4000-8000-000000000655",
  status: "STOPPED", operation: null, mode: null, inputHash: null, draftId: null, cleared: null,
};
const translationAuthority = (snapshot: OverlaySnapshot) =>
  snapshot.authorityFingerprints.find((row) => row.table === "TranslationIntentReceipt");

describe("translation terminal evidence in whole-site reconciliation", () => {
  it("inspects all sixteen schema combinations and skips catalog/row reads for absent ledgers", async () => {
    for (const identity of [false, true]) for (const decline of [false, true])
      for (const present of [false, true]) for (const receiptPresent of [false, true]) {
        const fixture = invitationClosureDatabase(present ? [stoppedInvitation] : [], {
          identity, decline, present, receiptPresent, receipts: [acceptedTranslation, stoppedTranslation],
        });
        const snapshot = await readReconciliationSnapshot(fixture.db);
        expect(Boolean(closureAuthority(snapshot))).toBe(present);
        expect(Boolean(translationAuthority(snapshot))).toBe(receiptPresent);
        expect(fixture.queries.filter((sql) => sql.includes("receipt_guard_columns"))).toHaveLength(Number(present) + Number(receiptPresent));
        if (!receiptPresent) expect(fixture.queries.some((sql) => sql.includes('"TranslationIntentReceipt"'))).toBe(false);
        expect(fixture.queries.every((sql) => /^SELECT\b/.test(sql))).toBe(true);
      }
  });

  it.each([
    ["actorId", "synthetic-private-different-actor"],
    ["intentId", "00000000-0000-4000-8000-000000000656"],
    ["protocolVersion", 2],
    ["status", "STOPPED"],
    ["operation", "home.setContent"],
    ["mode", "PUBLISH"],
    ["inputHash", "f".repeat(64)],
    ["draftId", "synthetic-different-draft"],
    ["cleared", true],
    ["createdAt", "2026-11-09T04:00:00.000Z"],
  ])("hashes every receipt field (%s) and refuses changed evidence before either overlay direction", async (field, value) => {
    // Per-field synthetic drift deliberately exercises the reader's full-row
    // hashing, including values that a valid live CHECK would itself refuse.
    const original = await readReconciliationSnapshot(invitationClosureDatabase([], {
      receiptPresent: true, receipts: [acceptedTranslation],
    }).db);
    const changed = await readReconciliationSnapshot(invitationClosureDatabase([], {
      receiptPresent: true, receipts: [{ ...acceptedTranslation, [String(field)]: value }],
    }).db);
    expect(translationAuthority(original)).not.toEqual(translationAuthority(changed));
    for (const [current, restored] of [[original, changed], [changed, original]] as const)
      expect(() => validateSecurityIdentityClosure(current, restored)).toThrow("CURRENT_AUTHORITY_REQUIRES_DOMAIN_RECONCILIATION");
  });

  it("refuses a missing accepted/stop row or entire optional table in either direction", async () => {
    const original = await readReconciliationSnapshot(invitationClosureDatabase([], {
      receiptPresent: true, receipts: [acceptedTranslation, stoppedTranslation],
    }).db);
    for (const receipts of [[acceptedTranslation], [stoppedTranslation], []]) {
      const missing = await readReconciliationSnapshot(invitationClosureDatabase([], { receiptPresent: true, receipts }).db);
      for (const [current, restored] of [[original, missing], [missing, original]] as const)
        expect(() => validateSecurityIdentityClosure(current, restored)).toThrow("CURRENT_AUTHORITY_REQUIRES_DOMAIN_RECONCILIATION");
    }
    const absent = await readReconciliationSnapshot(invitationClosureDatabase([]).db);
    for (const [current, restored] of [[original, absent], [absent, original]] as const)
      expect(() => validateSecurityIdentityClosure(current, restored)).toThrow("RECOVERY_SCHEMA_MISMATCH");
  });

  it.each(["HistoricalInvitationOperationClosure", "TranslationIntentReceipt"] as const)(
    "refuses equal-but-weakened %s guards independently before either direction can write", async (table) => {
      for (const weaken of [
        (guard: ReceiptGuardMetadata) => { guard.triggers[0]!.enabled = "D"; },
        (guard: ReceiptGuardMetadata) => { guard.triggers[0]!.body = "BEGIN RETURN OLD; END"; },
        (guard: ReceiptGuardMetadata) => { guard.constraints[0]!.key_columns = ["inputHash"]; },
        (guard: ReceiptGuardMetadata) => { guard.columns[0]!.not_null = false; },
        (guard: ReceiptGuardMetadata) => { guard.constraints[0]!.index_opclasses = ["unreviewed.custom_text_ops"]; },
        (guard: ReceiptGuardMetadata) => { guard.constraints[0]!.index_collations = ["pg_catalog.C"]; },
        ...(table === "TranslationIntentReceipt" ? [(guard: ReceiptGuardMetadata) => {
          const binding = guard.constraints.find((row) => row.name === "translation_intent_receipt_binding")!;
          binding.expression = `${String(binding.expression)} OR true`;
        }] : []),
      ]) {
        for (const [weakenSource, weakenRestored] of [[true, true], [true, false], [false, true]]) {
          const fixtures = [weakenSource, weakenRestored].map((bad) => invitationClosureDatabase([stoppedInvitation], {
            receiptPresent: true, receipts: [acceptedTranslation],
            weakenGuard: (name, guard) => { if (bad && name === table) weaken(guard); },
          }));
          const source = fixtures[0]!;
          const target = fixtures[1]!;
          const reconcile = async () => {
            const current = await readReconciliationSnapshot(source.db);
            const restored = await readReconciliationSnapshot(target.db);
            validateSecurityIdentityClosure(current, restored);
            return reconcileSecuritySnapshot(target.db, current, restored);
          };
          await expect(reconcile()).rejects.toThrow("UNREVIEWED_RECEIPT_GUARD_METADATA");
          for (const fixture of fixtures) expect(fixture.queries.every((sql) => /^SELECT\b/.test(sql))).toBe(true);
        }
      }
    },
  );

  it("keeps matching accepted/stop rows and guard digests out of overlays, expiry and exported private values", async () => {
    const first = invitationClosureDatabase([stoppedInvitation], { receiptPresent: true, receipts: [acceptedTranslation, stoppedTranslation] });
    const second = invitationClosureDatabase([stoppedInvitation], { receiptPresent: true, receipts: [acceptedTranslation, stoppedTranslation] });
    const original = await readReconciliationSnapshot(first.db);
    const restored = await readReconciliationSnapshot(second.db);
    const fingerprint: unknown = expect.stringMatching(/^[a-f0-9]{64}$/);
    expect(original.authorityFingerprints.filter((row) => String(row.table).endsWith(":guard"))).toEqual([
      { table: "HistoricalInvitationOperationClosure:guard", fingerprint },
      { table: "TranslationIntentReceipt:guard", fingerprint },
    ]);
    for (const value of [acceptedTranslation.actorId, acceptedTranslation.intentId, stoppedTranslation.intentId, acceptedTranslation.inputHash, acceptedTranslation.draftId, acceptedTranslation.createdAt])
      expect(JSON.stringify(original)).not.toContain(value);
    expect(original.tables.TranslationIntentReceipt).toBeUndefined();
    expect(original.capabilityFingerprints.some((row) => row.table === "TranslationIntentReceipt")).toBe(false);
    expect(() => validateSecurityIdentityClosure(original, restored)).not.toThrow();
    const applied = await reconcileSecuritySnapshot(second.db, original, restored);
    const rolledBack = await reconcileSecuritySnapshot(first.db, applied.finalState, original);
    expect(translationAuthority(applied.finalState)).toEqual(translationAuthority(original));
    expect(translationAuthority(rolledBack.finalState)).toEqual(translationAuthority(original));
    for (const fixture of [first, second]) expect(fixture.queries.filter((sql) => sql.includes('"TranslationIntentReceipt"')).every((sql) => /^SELECT\b/.test(sql))).toBe(true);
  });

  it("refuses an oversized receipt ledger instead of pruning permanent replay/stop evidence", async () => {
    const fixture = invitationClosureDatabase([], { receiptPresent: true,
      receipts: Array.from({ length: 10_001 }, (_, index) => ({ ...stoppedTranslation, intentId: `synthetic-${index}` })),
    });
    await expect(readReconciliationSnapshot(fixture.db)).rejects.toThrow("SECURITY_MANIFEST_TOO_LARGE");
  });
});
