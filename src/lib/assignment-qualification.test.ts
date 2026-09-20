import { expect, it } from "vitest";
import {
  assignmentIdentity,
  groupAssignmentTutors,
  isAssignableTutor,
} from "./assignment-qualification";

const tutors = [
  { id: "a", englishName: "Ada" },
  { id: "b", englishName: "Ben" },
];
const grants = [
  { tutorId: "b", subjectId: "standard" },
  { tutorId: "b", subjectId: "advanced" },
];
it("retains unlinked active roster tutors but excludes revoked and inactive memberships", () => {
  expect(isAssignableTutor({ status: "ACTIVE", user: null })).toBe(true);
  expect(
    isAssignableTutor({
      status: "ACTIVE",
      user: { tutorAccessRevoked: false },
    }),
  ).toBe(true);
  expect(
    isAssignableTutor({ status: "ACTIVE", user: { tutorAccessRevoked: true } }),
  ).toBe(false);
  expect(isAssignableTutor({ status: "ARCHIVED", user: null })).toBe(false);
});
it("groups concrete inherited grants without interpreting current level order", () => {
  expect(groupAssignmentTutors(tutors, "standard", grants)).toEqual({
    qualified: [tutors[1]],
    unqualified: [tutors[0]],
  });
  expect(groupAssignmentTutors(tutors, "advanced", grants).qualified).toEqual([
    tutors[1],
  ]);
  expect(groupAssignmentTutors(tutors, "unrelated", grants)).toEqual({
    qualified: [],
    unqualified: tutors,
  });
  expect(groupAssignmentTutors(tutors, "standard", grants).qualified).toEqual([
    tutors[1],
  ]);
});
it("binds changed selections and schedule while ignoring only evidence and object key order", () => {
  const value = {
    tutorId: "a",
    subjectId: "standard",
    timeSlotId: "slot",
    expectedUpdatedAt: new Date(0),
  };
  expect(
    assignmentIdentity({ ...value, ticket: "old", overrideTicket: "old" }),
  ).toBe(assignmentIdentity({ overrideTicket: "new", ...value }));
  for (const change of [
    { tutorId: "b" },
    { subjectId: "advanced" },
    { timeSlotId: "other" },
    { expectedUpdatedAt: new Date(1) },
  ])
    expect(assignmentIdentity({ ...value, ...change })).not.toBe(
      assignmentIdentity(value),
    );
});
