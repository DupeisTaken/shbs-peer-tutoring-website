import { expect, it } from "vitest";
import {
  preservedRecoveryChange,
  preservedRecoveryEvent,
} from "./independent-changes";

const change = {
  entity: "User",
  operation: "UPDATE",
  before: {},
  after: {},
  changedFields: ["name", "profileVersion"],
};
it("preserves journaled notification settings but rejects ownership rewrites and unknown coverage", () => {
  for (const operation of ["INSERT", "DELETE"]) {
    expect(preservedRecoveryChange({ ...change, entity: "NotificationPreference", operation,
      changedFields: ["userId", "category", "badgeEnabled", "emailEnabled"] })).toBe(true);
  }
  expect(preservedRecoveryChange({ ...change, entity: "NotificationPreference", changedFields: ["badgeEnabled", "emailEnabled"] })).toBe(true);
  for (const changedFields of [null, [], ["userId"], ["category"], ["futureField"]])
    expect(preservedRecoveryChange({ ...change, entity: "NotificationPreference", changedFields })).toBe(false);
  expect(preservedRecoveryChange({ ...change, changedFields: ["emailReviewRequests", "emailEventReminders"] })).toBe(true);
});
it("requires complete field-name evidence rather than equal redacted snapshots", () => {
  expect(preservedRecoveryChange(change)).toBe(true);
  for (const changedFields of [
    null,
    undefined,
    {},
    ["name", "mergedIntoId"],
    ["studentId"],
    ["tutorAccessRevoked"],
    ["personId"],
    ["futurePrivateField"],
  ])
    expect(preservedRecoveryChange({ ...change, changedFields })).toBe(false);
});
it("never infers a safe transaction from only some of its changes", () => {
  expect(preservedRecoveryEvent([])).toBe(false);
  expect(
    preservedRecoveryEvent([change, { ...change, entity: "Session" }]),
  ).toBe(false);
  for (const operation of ["INSERT", "DELETE"])
    expect(preservedRecoveryChange({ ...change, operation })).toBe(false);
});
it("does not classify a fresh tutor-role decision as unrelated access", () => {
  expect(
    preservedRecoveryChange({
      ...change,
      changedFields: ["role"],
      after: { role: "TUTOR" },
    }),
  ).toBe(false);
  expect(
    preservedRecoveryChange({
      ...change,
      changedFields: ["role"],
      after: { role: "ADMIN" },
    }),
  ).toBe(true);
});
