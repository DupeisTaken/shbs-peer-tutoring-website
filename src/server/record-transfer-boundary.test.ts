import { describe, expect, it } from "vitest";
import { historicalImportError } from "./record-transfer-boundary";
import { importedRecordKey } from "./imported-records";

const now = new Date("2026-11-08T06:00:00Z");

it("uses stable typed primary keys for archive rows without an id column", () => {
  expect(
    importedRecordKey({ id: "original", name: "Private label" }, ["id"]),
  ).toBe("original");
  expect(
    importedRecordKey(
      { tuteeId: "learner", sessionId: "session", status: "PRESENT" },
      ["tuteeId", "sessionId"],
    ),
  ).toBe('[["sessionId","session"],["tuteeId","learner"]]');
  expect(importedRecordKey({ a: 1, b: "1" }, ["b", "a"])).toBe(
    '[["a",1],["b","1"]]',
  );
  expect(
    importedRecordKey(
      { windowStart: new Date("2026-11-08T06:00:00Z"), crewUserId: "crew" },
      ["windowStart", "crewUserId"],
    ),
  ).toBe(
    importedRecordKey(
      { crewUserId: "crew", windowStart: "2026-11-08T06:00:00.000Z" },
      ["crewUserId", "windowStart"],
    ),
  );
});

describe("historical import admission", () => {
  it.each([
    ["Tutor", {}],
    ["Tutor", { status: "ACTIVE" }],
    ["Tutor", { status: "PENDING" }],
    ["Tutee", {}],
    ["Tutee", { status: "ACTIVE" }],
    ["Tutee", { status: "PENDING" }],
    ["TutorApplication", { status: "INTERVIEW" }],
    ["TutorApplication", { status: "PENDING" }],
    ["CrewApplication", {}],
    ["TutorQualification", { status: "PENDING" }],
    ["TutorQualification", {}],
    ["TutorStatusRequest", { state: "PENDING" }],
    ["TuteeRemovalRequest", { state: "PENDING" }],
    ["CrewStatusRequest", {}],
    ["StudentRequestReview", { state: "PENDING" }],
    ["StudentSignupAppeal", { state: "PENDING" }],
    ["StudentAppeal", {}],
    ["SessionFlag", { state: "PENDING" }],
    ["StudentSurvey", { state: "OPEN" }],
    ["DisciplinaryCard", { reviewStatus: "PENDING" }],
    ["Announcement", {}],
    ["Announcement", { active: true }],
    ["TutorMeeting", { date: "2026-11-09T06:00:00Z" }],
    ["Patrol", { createdAt: "2026-11-09T06:00:00Z" }],
    ["Patrol", { creditAwardedAt: "2026-11-09T06:00:00Z" }],
    ["PatrolObservation", { observedAt: "2026-11-09T06:00:00Z" }],
  ] as const)(
    "does not create live work from a new %s archive row",
    (table, row) => {
      expect(historicalImportError(table, row, now)).toMatch(
        /Historical .* (require|must)/,
      );
    },
  );

  it.each([
    ["Tutor", { status: "ARCHIVED" }],
    ["Tutor", { status: "GRADUATED" }],
    ["Tutor", { status: "TRANSFERRED" }],
    ["Tutor", { status: "OPTED_OUT" }],
    ["Tutee", { status: "INACTIVE" }],
    ["TutorApplication", { status: "ACCEPTED" }],
    ["TutorApplication", { status: "REJECTED" }],
    ["TutorApplication", { status: "RECALLED" }],
    ["CrewApplication", { status: "ACCEPTED" }],
    ["TutorQualification", { status: "APPROVED" }],
    ["TutorQualification", { status: "REJECTED" }],
    ["TutorStatusRequest", { state: "DENIED" }],
    ["TuteeRemovalRequest", { state: "REINSTATED" }],
    ["CrewStatusRequest", { state: "RECALLED" }],
    ["StudentRequestReview", { state: "APPROVED" }],
    ["StudentSignupAppeal", { state: "REJECTED" }],
    ["StudentAppeal", { state: "UPHELD" }],
    ["SessionFlag", { state: "PENALIZED" }],
    ["StudentSurvey", { state: "ABORTED" }],
    ["DisciplinaryCard", { reviewStatus: "VALID" }],
    ["Announcement", { active: false }],
    ["TutorMeeting", { date: "2026-11-07T06:00:00Z" }],
    ["Patrol", { createdAt: "2026-11-07T06:00:00Z", creditAwardedAt: null }],
    ["PatrolObservation", { observedAt: "2026-11-07T06:00:00Z" }],
    ["Room", { name: "Historical Room" }],
  ] as const)(
    "retains completed %s evidence without changing its outcome",
    (table, row) => {
      expect(historicalImportError(table, row, now)).toBeNull();
    },
  );
});
