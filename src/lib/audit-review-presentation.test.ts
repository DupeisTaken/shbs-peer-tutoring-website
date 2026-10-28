import { expect, it } from "vitest";
import { auditChangeSummary } from "./audit-change-summary";
import {
  auditCapturedReferences,
  auditComparisonFacts,
  auditComparisonIdentity,
  auditDirectField,
} from "./audit-review-presentation";

it("names unchanged contextual records by captured entity and side, never rematching audit arrays", () => {
  const summary = auditChangeSummary({
    evidenceVersion: 1,
    changes: [
      {
        entity: "Tutor",
        before: [{ id: "same", englishName: "Original Tutor" }],
        after: [{ id: "same", englishName: "Recorded Tutor" }],
      },
      {
        entity: "Room",
        before: [{ id: "same", name: "Original Room" }],
        after: [{ id: "same", name: "Recorded Room" }],
      },
      {
        entity: "Tutee",
        before: [{ id: "stable", englishName: "Unchanged Learner" }],
        after: [{ id: "stable", englishName: "Unchanged Learner" }],
      },
      {
        entity: "Pairing",
        before: [
          {
            id: "p",
            tutorId: "same",
            roomId: "same",
            subject: "Stored subject",
          },
        ],
        after: [
          { id: "p", tutorId: "same", roomId: null, subject: "Stored subject" },
        ],
      },
    ],
  })!;
  const references = auditCapturedReferences(summary.capturedRecords);
  expect(references("Pairing", "tutorId", "same", "before")).toBe(
    "Original Tutor",
  );
  expect(references("Pairing", "roomId", "same", "after")).toBe(
    "Recorded Room",
  );
  expect(references("PairingTutee", "tuteeId", "stable", "after")).toBe(
    "Unchanged Learner",
  );
  expect(references("Unknown", "tutorId", "same", "before")).toBeUndefined();
  expect(references("Pairing", "tutorId", "missing", "before")).toBeUndefined();
  expect(auditComparisonFacts(summary.comparisons.at(-1)!)).toContainEqual({
    key: "subject",
    before: "Stored subject",
    after: "Stored subject",
  });
  expect(auditComparisonIdentity(summary.comparisons[0]!)).toBe(
    "Original Tutor → Recorded Tutor",
  );
});

it("declines ambiguous names and unknown nested paths", () => {
  const references = auditCapturedReferences([
    { entity: "Tutor", beforeRecord: { id: "t", name: "First" } },
    { entity: "Tutor", beforeRecord: { id: "t", name: "Second" } },
  ]);
  expect(references("Pairing", "tutorId", "t", "before")).toBeUndefined();
  expect(references.resolve("Pairing", "tutorId", "t", "before")).toEqual({
    state: "ambiguous",
  });
  expect(references.resolve("Pairing", "tutorId", "t", "after")).toEqual({
    state: "missing",
  });
  expect(
    references.resolve("Pairing", "tutorId", "unrecorded", "before"),
  ).toEqual({ state: "missing" });
  expect(auditDirectField("/a~1b~0")).toBe("a/b~");
  expect(auditDirectField("/nested/status")).toBeNull();
  expect(auditDirectField("")).toBeNull();
});

it("does not let same-ID records on another side or entity create a false ambiguity", () => {
  const references = auditCapturedReferences([
    {
      entity: "Tutor",
      beforeRecord: { id: "same", name: "Original Tutor" },
      afterRecord: { id: "same", name: "Updated Tutor" },
    },
    {
      entity: "Room",
      beforeRecord: { id: "same", name: "Room Name" },
      afterRecord: { id: "same", name: "Room Name" },
    },
  ]);
  expect(references.resolve("Pairing", "tutorId", "same", "before")).toEqual({
    state: "recorded",
    name: "Original Tutor",
  });
  expect(references.resolve("Pairing", "tutorId", "same", "after")).toEqual({
    state: "recorded",
    name: "Updated Tutor",
  });
  expect(references.resolve("Pairing", "roomId", "same", "before")).toEqual({
    state: "recorded",
    name: "Room Name",
  });
});
