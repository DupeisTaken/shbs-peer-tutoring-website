import { expect, it } from "vitest";
import {
  reconcilePersonSources,
  type PersonReconciliationSnapshot,
} from "./person-reconciliation";

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
  };
}

it("accepts explicit retirement-family ownership and independent accountless sources", () => {
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
    "MISSING_PRIMARY", "GROUP_REVIEW_STATE_MISMATCH", "RETIREMENT_PROJECTION_MISMATCH", "OWNER_PROJECTION_MISMATCH",
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
  // Tutor history does traverse the family; this is not an automatic transfer
  // or a reason to grant access to every login sharing the Person.
  expect(result.sources.find((row) => row.id === "t")?.historyReaderUserIds).toEqual(["owner"]);
});

it("emits identical comparisons regardless of database row order", () => {
  const snapshot = fixture();
  snapshot.studentOwners.push({ tuteeId: "missing", userId: "absent" });
  const result = reconcilePersonSources(snapshot);
  for (const rows of Object.values(snapshot)) rows.reverse();
  expect(reconcilePersonSources(snapshot)).toEqual(result);
  expect(JSON.stringify(result)).not.toMatch(/password|email|name|token|signature/i);
});
