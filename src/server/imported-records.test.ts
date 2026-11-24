import { describe, expect, it } from "vitest";
import {
  directProvenanceRecoveryReferences,
  importedRecordKey,
  normalizeProvenanceKey,
  parseImportedRecordKey,
  PROVENANCE_RECORD_TABLES,
} from "./imported-records";
import { RECORD_TABLES } from "./record-transfer";
import { RECORD_PRIMARY_KEYS } from "./recovery/record-catalog";

describe("imported-records typed provenance keys and recovery references", () => {
  it("keeps PROVENANCE_RECORD_TABLES aligned with writable RECORD_TABLES and RECORD_PRIMARY_KEYS", () => {
    const writableTransferTables = RECORD_TABLES.filter(
      (table) => table !== "User",
    );
    expect([...PROVENANCE_RECORD_TABLES]).toEqual(writableTransferTables);
    for (const table of PROVENANCE_RECORD_TABLES) {
      expect(
        RECORD_PRIMARY_KEYS[table]?.length,
        `${table} primary keys`,
      ).toBeGreaterThan(0);
    }
  });

  it("normalizes and round-trips scalar, single-non-id, and composite keys including DateTime fields", () => {
    const scalar = normalizeProvenanceKey({ id: "sess_1" }, ["id"]);
    expect(scalar).toEqual({
      key: { id: "sess_1" },
      recordId: "sess_1",
      keyKind: "SCALAR_ID",
    });
    expect(parseImportedRecordKey(scalar.recordId, ["id"])).toEqual({
      id: "sess_1",
    });

    const single = normalizeProvenanceKey({ tuteeId: "tutee_1" }, ["tuteeId"]);
    expect(single).toEqual({
      key: { tuteeId: "tutee_1" },
      recordId: '[["tuteeId","tutee_1"]]',
      keyKind: "SINGLE_KEY",
    });
    expect(parseImportedRecordKey(single.recordId, ["tuteeId"])).toEqual({
      tuteeId: "tutee_1",
    });

    // Composite key order is canonicalized alphabetically regardless of input order.
    const composite = normalizeProvenanceKey(
      { tuteeId: "t1", sessionId: "s1" },
      ["sessionId", "tuteeId"],
    );
    expect(composite).toEqual({
      key: { sessionId: "s1", tuteeId: "t1" },
      recordId: '[["sessionId","s1"],["tuteeId","t1"]]',
      keyKind: "COMPOSITE_KEY",
    });
    expect(
      parseImportedRecordKey(composite.recordId, ["sessionId", "tuteeId"]),
    ).toEqual({ sessionId: "s1", tuteeId: "t1" });
    expect(
      importedRecordKey({ tuteeId: "t1", sessionId: "s1" }, [
        "sessionId",
        "tuteeId",
      ]),
    ).toBe(composite.recordId);

    // DateTime composite key (PatrolCreditWindow) normalizes to ISO UTC string.
    const dt = normalizeProvenanceKey(
      { crewUserId: "crew_1", windowStart: "2024-10-01T10:00:00Z" },
      ["crewUserId", "windowStart"],
      new Set(["windowStart"]),
    );
    expect(dt.recordId).toBe(
      '[["crewUserId","crew_1"],["windowStart","2024-10-01T10:00:00.000Z"]]',
    );
    expect(
      parseImportedRecordKey(
        dt.recordId,
        ["crewUserId", "windowStart"],
        new Set(["windowStart"]),
      ),
    ).toEqual({
      crewUserId: "crew_1",
      windowStart: "2024-10-01T10:00:00.000Z",
    });
  });

  it("rejects non-canonical, mismatched, or invalid provenance keys", () => {
    expect(() =>
      normalizeProvenanceKey({ sessionId: "s1" }, ["sessionId", "tuteeId"]),
    ).toThrow("PROVENANCE_KEY_FIELDS_MISMATCH");
    expect(() =>
      normalizeProvenanceKey(
        { sessionId: "", tuteeId: "t1" },
        ["sessionId", "tuteeId"],
      ),
    ).toThrow("INVALID_PROVENANCE_KEY_VALUE");
    // Wrong order in serialized JSON array fails canonical check.
    expect(() =>
      parseImportedRecordKey('[["tuteeId","t1"],["sessionId","s1"]]', [
        "sessionId",
        "tuteeId",
      ]),
    ).toThrow("NON_CANONICAL_PROVENANCE_KEY");
  });

  it("derives explicit typed recovery references for composite, single, and scalar keys", () => {
    expect(
      directProvenanceRecoveryReferences(
        "SessionTutee",
        { sessionId: "s1", tuteeId: "t1" },
        '[["sessionId","s1"],["tuteeId","t1"]]',
      ),
    ).toEqual([
      {
        entity: "ImportedRecordProvenance",
        recordId:
          '{"entity":"SessionTutee","recordId":"[[\\"sessionId\\",\\"s1\\"],[\\"tuteeId\\",\\"t1\\"]]"}',
      },
      { entity: "Session", recordId: "s1" },
      { entity: "Tutee", recordId: "t1" },
    ]);

    expect(
      directProvenanceRecoveryReferences(
        "InterviewAssignment",
        { applicationId: "app1", tutorId: "tut1" },
        '[["applicationId","app1"],["tutorId","tut1"]]',
      ),
    ).toEqual([
      {
        entity: "ImportedRecordProvenance",
        recordId:
          '{"entity":"InterviewAssignment","recordId":"[[\\"applicationId\\",\\"app1\\"],[\\"tutorId\\",\\"tut1\\"]]"}',
      },
      { entity: "TutorApplication", recordId: "app1" },
      { entity: "Tutor", recordId: "tut1" },
    ]);

    expect(
      directProvenanceRecoveryReferences(
        "QualificationGrant",
        { tutorId: "t1", sourceSubjectId: "subA", subjectId: "subB" },
        '[["sourceSubjectId","subA"],["subjectId","subB"],["tutorId","t1"]]',
      ),
    ).toEqual([
      {
        entity: "ImportedRecordProvenance",
        recordId:
          '{"entity":"QualificationGrant","recordId":"[[\\"sourceSubjectId\\",\\"subA\\"],[\\"subjectId\\",\\"subB\\"],[\\"tutorId\\",\\"t1\\"]]"}',
      },
      { entity: "Tutor", recordId: "t1" },
      { entity: "Subject", recordId: "subA" },
      { entity: "Subject", recordId: "subB" },
    ]);

    expect(
      directProvenanceRecoveryReferences(
        "ServiceHourAdjustment",
        { id: "flag:f1" },
        "flag:f1",
      ),
    ).toEqual([
      {
        entity: "ImportedRecordProvenance",
        recordId: '{"entity":"ServiceHourAdjustment","recordId":"flag:f1"}',
      },
      { entity: "ServiceHourAdjustment", recordId: "flag:f1" },
      { entity: "SessionFlag", recordId: "f1" },
    ]);
  });
});
