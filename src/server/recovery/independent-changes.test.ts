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
it("preserves an independent account email-language edit without admitting adjacent authority changes", () => {
  expect(preservedRecoveryChange({ ...change, changedFields: ["emailLocale"] })).toBe(true);
  expect(preservedRecoveryChange({ ...change, changedFields: ["emailLocale", "mergedIntoId"] })).toBe(false);
});
it("preserves live history invalidation epochs without adopting ownership or execution changes", () => {
  const epoch = {
    ...change,
    changedFields: ["historyAccessRevision", "sessionVersion"],
  };
  expect(preservedRecoveryChange(epoch)).toBe(true);
  for (const field of [
    "mergedIntoId",
    "personId",
    "studentId",
    "tutorId",
    "recoveryVoidedAt",
  ])
    expect(
      preservedRecoveryChange({
        ...epoch,
        changedFields: [...epoch.changedFields, field],
      }),
    ).toBe(false);
  for (const entity of [
    "RetiredHistoryOwnership",
    "HistoryRowOwnership",
    "PersonHistoryCorrectionReceipt",
    "ParticipantConsolidation",
    "PairingExecutionSuccessor",
    "SessionPlanExecution",
    "SessionParticipantExecution",
    "SessionResponseExecution",
    "QualificationTransferGrant",
    "PersonParticipationTransferReceipt",
    "StudentRequestExecutionAssignment",
    "PersonPartitionReceipt",
  ]) {
    const authority = { ...change, entity, changedFields: ["revision"] };
    expect(preservedRecoveryChange(authority), entity).toBe(false);
    expect(preservedRecoveryEvent([epoch, authority]), entity).toBe(false);
  }
});
it("preserves journaled notification settings but rejects ownership rewrites and unknown coverage", () => {
  for (const operation of ["INSERT", "DELETE"]) {
    expect(
      preservedRecoveryChange({
        ...change,
        entity: "NotificationPreference",
        operation,
        changedFields: ["userId", "category", "badgeEnabled", "emailEnabled"],
      }),
    ).toBe(true);
  }
  expect(
    preservedRecoveryChange({
      ...change,
      entity: "NotificationPreference",
      changedFields: ["badgeEnabled", "emailEnabled"],
    }),
  ).toBe(true);
  for (const changedFields of [
    null,
    [],
    ["userId"],
    ["category"],
    ["futureField"],
  ])
    expect(
      preservedRecoveryChange({
        ...change,
        entity: "NotificationPreference",
        changedFields,
      }),
    ).toBe(false);
  expect(
    preservedRecoveryChange({
      ...change,
      changedFields: ["emailReviewRequests", "emailEventReminders"],
    }),
  ).toBe(true);
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

it("preserves generated scheduling epochs only with supported independent authority changes", () => {
  for (const changedFields of [
    ["suspendedAt", "suspendedReason", "refreshAuthorityRevision"],
    ["role", "refreshAuthorityRevision"],
  ])
    expect(
      preservedRecoveryChange({
        ...change,
        changedFields,
        after: { role: "COORDINATOR" },
      }),
    ).toBe(true);
  for (const changedFields of [
    ["refreshAuthorityRevision"],
    ["name", "refreshAuthorityRevision"],
    ["mergedIntoId", "refreshAuthorityRevision"],
    ["role", "mergedIntoId", "refreshAuthorityRevision"],
  ])
    expect(
      preservedRecoveryChange({
        ...change,
        changedFields,
        after: { role: "COORDINATOR" },
      }),
    ).toBe(false);
  expect(
    preservedRecoveryChange({
      ...change,
      changedFields: ["role", "refreshAuthorityRevision"],
      after: { role: "TUTOR" },
    }),
  ).toBe(false);
  expect(
    preservedRecoveryChange({
      ...change,
      entity: "ScheduledProgramRefresh",
      changedFields: ["state", "version"],
    }),
  ).toBe(false);
});
