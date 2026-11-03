import { expect, it, vi } from "vitest";
import {
  reconcilePersonSources,
  readPersonReconciliationSnapshot,
  type PersonReconciliationSnapshot,
} from "./person-reconciliation";
import type { TransactionDb } from "./transactions";

function fixture(): PersonReconciliationSnapshot {
  return {
    persons: [
      { id: "p", mergedIntoId: null, primaryUserId: "owner", resolutionState: "GROUPED" },
      { id: "standalone", mergedIntoId: null, primaryUserId: null, resolutionState: "GROUPED" },
    ],
    users: [
      { id: "owner", personId: "p", mergedIntoId: null, tutorId: "t", studentId: null },
      { id: "retired", personId: "p", mergedIntoId: "owner", tutorId: null, studentId: null },
    ],
    tutors: [{ id: "t", personId: "p" }],
    tutees: [{ id: "s", personId: "p" }, { id: "unowned", personId: "standalone" }],
    tutorOwners: [{ tutorId: "t", userId: "retired" }],
    studentOwners: [{ tuteeId: "s", userId: "owner" }],
    retiredHistoryOwnership: [{ sourceUserId: "retired", readerUserId: "owner", state: "ASSIGNED", revision: 1 }],
  };
}

it("accepts explicit effective ownership and independent accountless sources", () => {
  const snapshot = fixture();
  const before = JSON.stringify(snapshot);
  const result = reconcilePersonSources(snapshot);
  expect(result.findings).toEqual([]);
  expect(result.sources.find((row) => row.id === "t")).toMatchObject({
    ownerUserIds: ["owner", "retired"], canonicalOwnerIds: ["owner"], canonicalPersonId: "p",
  });
  expect(JSON.stringify(snapshot)).toBe(before);
});

it("reports absent metadata, orphan scalar owners and dangling sources without inferring a match", () => {
  const snapshot = fixture();
  snapshot.tutors[0]!.personId = null;
  snapshot.studentOwners.push({ tuteeId: "gone-source", userId: "gone-user" });
  snapshot.persons.push({ id: "empty", primaryUserId: null, mergedIntoId: null, resolutionState: "GROUPED" });
  expect(reconcilePersonSources(snapshot).findings).toEqual(expect.arrayContaining([
    { code: "MISSING_PERSON", source: { kind: "TUTOR", id: "t" }, relatedIds: [] },
    { code: "DANGLING_SOURCE", source: { kind: "TUTEE", id: "gone-source" }, relatedIds: ["gone-user"] },
    { code: "DANGLING_OWNER", source: { kind: "TUTEE", id: "gone-source" }, relatedIds: ["gone-user"] },
    { code: "ORPHAN_PERSON", source: { kind: "PERSON", id: "empty" }, relatedIds: [] },
  ]));
});

it("separates a reviewed display group from conflicting private owners", () => {
  const snapshot = fixture();
  snapshot.persons[0]!.resolutionState = "REVIEW_REQUIRED";
  snapshot.users.push({ id: "second", personId: "p", mergedIntoId: null, tutorId: null, studentId: "s" });
  const result = reconcilePersonSources(snapshot);
  expect(result.findings).toEqual([
    { code: "CONFLICTING_OWNERS", source: { kind: "TUTEE", id: "s" }, relatedIds: ["owner", "second"] },
  ]);
  expect(result.sources.find((row) => row.id === "s")?.canonicalOwnerIds).toEqual(["owner", "second"]);
});

it("reports both redirect cycles without hanging and detects invalid primary accounts", () => {
  const snapshot = fixture();
  snapshot.persons[0]!.mergedIntoId = "standalone";
  snapshot.persons[1]!.mergedIntoId = "p";
  snapshot.users[0]!.mergedIntoId = "retired";
  const result = reconcilePersonSources(snapshot);
  expect(result.findings.filter((row) => row.code === "PERSON_CYCLE")).toHaveLength(2);
  expect(result.findings.filter((row) => row.code === "RETIREMENT_CYCLE")).toHaveLength(2);
  expect(result.findings).toContainEqual({ code: "INVALID_PRIMARY", source: { kind: "PERSON", id: "p" }, relatedIds: ["owner"] });
});

it("reports primary, review-state and relationship projection drift", () => {
  const snapshot = fixture();
  snapshot.persons[0]!.primaryUserId = null;
  snapshot.users.push({ id: "second", personId: "p", mergedIntoId: null, tutorId: null, studentId: null });
  snapshot.users[1]!.personId = "standalone";
  snapshot.tutees[0]!.personId = "standalone";
  const codes = reconcilePersonSources(snapshot).findings.map((row) => row.code);
  expect(codes).toEqual(expect.arrayContaining([
    "MISSING_PRIMARY", "GROUP_REVIEW_STATE_MISMATCH", "HISTORY_READER_PROJECTION_MISMATCH", "OWNER_PROJECTION_MISMATCH",
  ]));
});

it("reports sources stranded on redirected groups and missing redirect targets", () => {
  const snapshot = fixture();
  snapshot.persons.push({ id: "old", primaryUserId: null, mergedIntoId: "p", resolutionState: "GROUPED" });
  snapshot.tutees[0]!.personId = "old";
  snapshot.persons[1]!.mergedIntoId = "missing-person";
  const result = reconcilePersonSources(snapshot);
  expect(result.findings).toEqual(expect.arrayContaining([
    { code: "SOURCE_REDIRECT", source: { kind: "TUTEE", id: "s" }, relatedIds: ["old", "p"] },
    { code: "DANGLING_PERSON", source: { kind: "PERSON", id: "standalone" }, relatedIds: ["missing-person"] },
  ]));
});

it("reports retired Tutee owner links that the exact private reader cannot reach", () => {
  const snapshot = fixture();
  snapshot.studentOwners[0]!.userId = "retired";
  const result = reconcilePersonSources(snapshot);
  expect(result.findings).toEqual([
    { code: "HISTORY_READER_PROJECTION_MISMATCH", source: { kind: "TUTEE", id: "s" }, relatedIds: ["owner", "retired"] },
  ]);
  expect(result.sources.find((row) => row.id === "s")).toMatchObject({
    canonicalOwnerIds: ["owner"], historyReaderUserIds: [],
  });
  // Tutor history does follow the explicit mapping; this is not an automatic transfer
  // or a reason to grant access to every login sharing the Person.
  expect(result.sources.find((row) => row.id === "t")?.historyReaderUserIds).toEqual(["owner"]);
});

function correctedFamily(): PersonReconciliationSnapshot {
  return {
    persons: [
      { id: "pD", primaryUserId: "D", mergedIntoId: null, resolutionState: "GROUPED" },
      { id: "pC", primaryUserId: "C", mergedIntoId: null, resolutionState: "GROUPED" },
    ],
    users: [
      { id: "B", personId: "pC", mergedIntoId: "A", tutorId: null, studentId: null },
      { id: "A", personId: "pD", mergedIntoId: "D", tutorId: null, studentId: null },
      { id: "D", personId: "pD", mergedIntoId: null, tutorId: null, studentId: null },
      { id: "C", personId: "pC", mergedIntoId: null, tutorId: null, studentId: null },
    ],
    tutors: [{ id: "tB", personId: "pC" }, { id: "tA", personId: "pD" }], tutees: [],
    tutorOwners: [{ tutorId: "tB", userId: "B" }, { tutorId: "tA", userId: "A" }], studentOwners: [],
    retiredHistoryOwnership: [
      { sourceUserId: "A", readerUserId: "D", state: "ASSIGNED", revision: 1 },
      { sourceUserId: "B", readerUserId: "C", state: "ASSIGNED", revision: 2 },
    ],
  };
}

it("keeps B's corrected reader independent of B-to-A-to-D permanent retirement", () => {
  const snapshot = correctedFamily();
  const result = reconcilePersonSources(snapshot);
  expect(result.findings).toEqual([]);
  expect(result.sources.find((row) => row.kind === "USER" && row.id === "B")).toMatchObject({ effectiveHistoryReaderId: "C", retirementTerminalUserId: "D" });
  expect(result.sources.find((row) => row.id === "tB")).toMatchObject({ canonicalOwnerIds: ["C"], historyReaderUserIds: ["C"] });
  expect(result.sources.find((row) => row.id === "tA")).toMatchObject({ canonicalOwnerIds: ["D"], historyReaderUserIds: ["D"] });
  expect(result.schemaVersion).toBe(2);
});

it("reports quarantine and missing mappings independently without inferring retirement access", () => {
  const snapshot = correctedFamily();
  snapshot.retiredHistoryOwnership = [{ sourceUserId: "B", readerUserId: null, state: "QUARANTINED", revision: 3 }];
  const result = reconcilePersonSources(snapshot);
  expect(result.findings).toEqual([
    { code: "HISTORY_MAPPING_MISSING", source: { kind: "USER", id: "A" }, relatedIds: [] },
    { code: "HISTORY_QUARANTINED", source: { kind: "USER", id: "B" }, relatedIds: [] },
  ]);
  expect(result.sources.find((row) => row.id === "tB")?.historyReaderUserIds).toEqual([]);
  expect(result.sources.find((row) => row.id === "tA")?.historyReaderUserIds).toEqual([]);
});

it("retains genuine group drift findings against the corrected reader instead of the old family", () => {
  const snapshot = correctedFamily();
  snapshot.users[0]!.personId = "pD";
  snapshot.tutors[0]!.personId = "pD";
  const result = reconcilePersonSources(snapshot);
  expect(result.findings).toContainEqual({ code: "HISTORY_READER_PROJECTION_MISMATCH", source: { kind: "USER", id: "B" }, relatedIds: ["C", "pC"] });
  expect(result.findings).toContainEqual({ code: "OWNER_PROJECTION_MISMATCH", source: { kind: "TUTOR", id: "tB" }, relatedIds: ["C", "pC", "pD"] });
});

it.each(["A", "missing", null])("rejects a non-live or absent effective reader %s", (readerUserId) => {
  const snapshot = correctedFamily();
  snapshot.retiredHistoryOwnership![1]!.readerUserId = readerUserId;
  const result = reconcilePersonSources(snapshot);
  expect(result.findings).toContainEqual({ code: "HISTORY_MAPPING_INVALID", source: { kind: "USER", id: "B" }, relatedIds: readerUserId ? [readerUserId] : [] });
  expect(result.sources.find((row) => row.id === "tB")?.historyReaderUserIds).toEqual([]);
});

it("does not silently use retirement authority when old pure fixtures omit the mapping inventory", () => {
  const snapshot = correctedFamily();
  delete snapshot.retiredHistoryOwnership;
  const result = reconcilePersonSources(snapshot);
  expect(result.findings.filter((row) => row.code === "HISTORY_MAPPING_MISSING")).toHaveLength(2);
  expect(result.sources.find((row) => row.id === "tB")?.historyReaderUserIds).toEqual([]);
});

it("always reads authoritative history mappings in the production snapshot", async () => {
  const snapshot = correctedFamily();
  const mappingRead = vi.fn().mockResolvedValue(snapshot.retiredHistoryOwnership);
  const tx = {
    person: { findMany: vi.fn().mockResolvedValue(snapshot.persons) },
    user: { findMany: vi.fn().mockResolvedValue(snapshot.users) },
    tutor: { findMany: vi.fn().mockResolvedValue(snapshot.tutors) },
    tutee: { findMany: vi.fn().mockResolvedValue(snapshot.tutees) },
    tutorProfileOwnership: { findMany: vi.fn().mockResolvedValue(snapshot.tutorOwners) },
    studentProfileOwnership: { findMany: vi.fn().mockResolvedValue(snapshot.studentOwners) },
    retiredHistoryOwnership: { findMany: mappingRead },
  } as unknown as TransactionDb;
  expect(await readPersonReconciliationSnapshot(tx)).toEqual(snapshot);
  expect(mappingRead).toHaveBeenCalledOnce();
  mappingRead.mockRejectedValue(new Error("Synthetic unavailable mapping inventory"));
  await expect(readPersonReconciliationSnapshot(tx)).rejects.toThrow("Synthetic unavailable mapping inventory");
});

it("emits identical comparisons regardless of database row order", () => {
  const snapshot = fixture();
  snapshot.studentOwners.push({ tuteeId: "missing", userId: "absent" });
  const result = reconcilePersonSources(snapshot);
  for (const rows of Object.values(snapshot)) rows.reverse();
  expect(reconcilePersonSources(snapshot)).toEqual(result);
  expect(JSON.stringify(result)).not.toMatch(/password|email|name|token|signature/i);
});
