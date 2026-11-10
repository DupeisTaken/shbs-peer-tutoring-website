import { describe, expect, it } from "vitest";
import {
  assertRotatedSigningSecrets,
  inspectSiteSecurityReconciliation,
  validateSecurityIdentityClosure,
  readReconciliationSnapshot,
  type OverlaySnapshot,
} from "./operator-reconcile";
import type { OperatorSql } from "./operator-site";
import { reviewedRecoverySchemaMetadata } from "./operator-schema";

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
