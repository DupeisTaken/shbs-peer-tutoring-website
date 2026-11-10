import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import de from "../../messages/de.json";
import el from "../../messages/el.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ja from "../../messages/ja.json";
import ko from "../../messages/ko.json";
import {
  auditEntityLabelKey,
  auditEnumLabelKey,
  auditFieldLabelKey,
  auditReferenceEntity,
  reviewSchema,
  reviewEnumValues,
  reviewFieldKeys,
  reviewStringDomains,
} from "./review-vocabulary";
import { notificationCategories } from "./notification-categories";

const at = (catalog: unknown, path: string | null): unknown =>
  path
    ?.split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      catalog,
    );

const identityModels = [
  "PersonPartitionReceipt", "RetiredHistoryOwnership", "HistoryRowOwnership",
  "PersonHistoryCorrectionReceipt", "ParticipantConsolidation", "PairingExecutionSuccessor",
  "SessionPlanExecution", "SessionParticipantExecution", "SessionResponseExecution",
  "QualificationTransferGrant", "PersonParticipationTransferReceipt", "StudentRequestExecutionAssignment",
] as const;

it("registers archive import metadata without exposing polymorphic provenance bindings", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const model = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
    .find((match) => match[1] === "ImportedRecordProvenance");
  expect(model).toBeDefined();
  const scalarFields = [...model![2]!.matchAll(/^\s*(\w+)\s+(?:String|DateTime)(?:[?\[\]\s])/gm)]
    .map((match) => match[1]);
  expect(reviewSchema.ImportedRecordProvenance).toEqual({ fields: scalarFields, references: {}, enums: {} });
  expect(auditEntityLabelKey("ImportedRecordProvenance"))
    .toBe("auditEventDetails.presentation.entities.ImportedRecordProvenance");
  for (const field of ["entity", "recordId"]) {
    expect(auditFieldLabelKey("ImportedRecordProvenance", field), field).toBeNull();
    expect(auditEnumLabelKey("ImportedRecordProvenance", field, "Tutor"), field).toBeNull();
    expect(auditReferenceEntity("ImportedRecordProvenance", field), field).toBeUndefined();
  }
  expect(auditFieldLabelKey("ImportedRecordProvenance", "importedAt"))
    .toBe("auditEventDetails.presentation.fields.importedAt");
  expect(auditEnumLabelKey("ImportedRecordProvenance", "importedAt", "ACTIVE")).toBeNull();
  expect(auditReferenceEntity("ImportedRecordProvenance", "importedAt")).toBeUndefined();
  // Private provenance keys do not narrow unrelated labels or genuine relations.
  expect(auditFieldLabelKey("AuditLog", "entity")).toBe("auditEventDetails.presentation.fields.entity");
  expect(auditFieldLabelKey("HistoricalAcademicCorrection", "recordId"))
    .toBe("auditEventDetails.presentation.fields.recordId");
  expect(auditReferenceEntity("HistoricalAcademicCorrection", "recordId")).toBe("HistoricalAcademicRecord");
  expect(auditFieldLabelKey("Tutor", "importedAt")).toBeNull();
});

it("discovers historical invitation stop metadata with exact scalar-only schema coverage", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const model = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
    .find((match) => match[1] === "HistoricalInvitationOperationClosure");
  expect(model).toBeDefined();
  const scalarFields = [...model![2]!.matchAll(/^\s*(\w+)\s+(?:String|DateTime)(?:[?\[\]\s])/gm)]
    .map((match) => match[1]);
  expect(scalarFields).toEqual(["operationId", "issuedById", "inputHash", "scopeKey", "createdAt"]);
  expect(reviewSchema.HistoricalInvitationOperationClosure).toEqual({ fields: scalarFields, references: {}, enums: {} });
  expect(auditEntityLabelKey("HistoricalInvitationOperationClosure"))
    .toBe("auditEventDetails.presentation.entities.HistoricalInvitationOperationClosure");
});

it("withholds stopped invitation bindings from generic labels and references without changing other owners", () => {
  for (const field of ["operationId", "issuedById", "inputHash", "scopeKey"]) {
    expect(auditFieldLabelKey("HistoricalInvitationOperationClosure", field), field).toBeNull();
    expect(auditEnumLabelKey("HistoricalInvitationOperationClosure", field, "ABANDONED"), field).toBeNull();
    expect(auditReferenceEntity("HistoricalInvitationOperationClosure", field), field).toBeUndefined();
  }
  expect(auditFieldLabelKey("HistoricalInvitationOperationClosure", "createdAt"))
    .toBe("auditEventDetails.presentation.fields.createdAt");
  expect(auditReferenceEntity("HistoricalInvitationOperationClosure", "createdAt")).toBeUndefined();
  // Issuer labels on the existing invitation and real references are independent.
  expect(auditFieldLabelKey("TuteeHistoryInvitation", "issuedById"))
    .toBe("auditEventDetails.presentation.fields.issuedById");
  expect(auditReferenceEntity("TuteeHistoryInvitation", "tuteeId")).toBe("Tutee");
});

it("catalogues translation terminal scalars but withholds actor, UUID, hash and result bindings", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const model = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
    .find((match) => match[1] === "TranslationIntentReceipt");
  expect(model).toBeDefined();
  const scalarFields = [...model![2]!.matchAll(/^\s*(\w+)\s+(?:String|Int|Boolean|DateTime)(?:[?\[\]\s])/gm)]
    .map((match) => match[1]);
  expect(reviewSchema.TranslationIntentReceipt).toEqual({ fields: scalarFields, references: {}, enums: {} });
  for (const field of ["actorId", "intentId", "protocolVersion", "operation", "mode", "inputHash", "draftId", "cleared"]) {
    expect(auditFieldLabelKey("TranslationIntentReceipt", field), field).toBeNull();
    expect(auditEnumLabelKey("TranslationIntentReceipt", field, "DRAFT"), field).toBeNull();
    expect(auditReferenceEntity("TranslationIntentReceipt", field), field).toBeUndefined();
  }
  expect(auditReferenceEntity("TranslationIntentReceipt", "actorId")).toBeUndefined();
  expect(auditFieldLabelKey("TranslationDraft", "operation")).not.toBeNull();
  expect(auditFieldLabelKey("RecoveryReceipt", "actorId")).not.toBeNull();
});

it("registers exact identity lifecycle scalar fields without inventing schema enums", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  for (const entity of identityModels) {
    const model = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].find((match) => match[1] === entity);
    expect(model, entity).toBeDefined();
    const scalarFields = [...model![2]!.matchAll(/^\s*(\w+)\s+(?:String|Int|Boolean|DateTime|Json)(?:[?\[\]\s])/gm)].map((match) => match[1]);
    expect(reviewSchema[entity].fields, entity).toEqual(scalarFields);
    expect(reviewSchema[entity].enums).toEqual({});
  }
  expect(reviewSchema.User.fields).toContain("historyAccessRevision");
  expect(reviewSchema.PersonCombineReceipt.fields).toContain("ownershipTransfers");
  expect(reviewSchema.EmailDelivery.fields).toContain("sourceNotificationId");
});

it("keeps private identity snapshots, hashes and source arrays outside the display vocabulary", () => {
  const privateFields = {
    User: ["historyAccessRevision"], Tutor: ["historyIdentityRevision"], Tutee: ["historyIdentityRevision"],
    EmailDelivery: ["sourceNotificationId"],
    PersonCombineReceipt: ["inputHash", "retiredUserIds", "ownershipTransfers"],
    PersonPartitionReceipt: ["inputHash", "sources", "subjects"],
    PersonHistoryCorrectionReceipt: ["inputHash", "sourceUserIds", "before", "after", "subjects"],
    PersonParticipationTransferReceipt: ["inputHash", "retainedUserId", "selection", "result", "subjects"],
    RetiredHistoryOwnership: ["sourceUserId", "readerUserId", "receiptId"],
    HistoryRowOwnership: ["recordId", "readerUserId", "sourceUserIds", "quarantineUserIds", "receiptId"],
    ParticipantConsolidation: ["sourceId", "targetId"], SessionPlanExecution: ["assignments"],
    SessionParticipantExecution: ["sourceSurveyIds"], SessionResponseExecution: ["profileId"],
  };
  for (const [entity, fields] of Object.entries(privateFields)) for (const field of fields) {
    expect(auditFieldLabelKey(entity, field), `${entity}.${field}`).toBeNull();
    expect(auditReferenceEntity(entity, field), `${entity}.${field}`).toBeUndefined();
    expect(auditEnumLabelKey(entity, field, "ASSIGNED"), `${entity}.${field}`).toBeNull();
  }
  // Shared names remain usable on their independent, already-supported owners.
  expect(auditFieldLabelKey("RecoveryChange", "before")).toBe("auditEventDetails.presentation.fields.before");
  expect(auditFieldLabelKey("RecoveryChange", "after")).toBe("auditEventDetails.presentation.fields.after");
  expect(auditFieldLabelKey("SessionPlanningReceipt", "result")).toBe("auditEventDetails.presentation.fields.result");
  expect(auditReferenceEntity("PairingExecutionSuccessor", "sourcePairingId")).toBe("Pairing");
  expect(auditReferenceEntity("SessionPlanExecution", "planId")).toBe("SessionPlan");
  expect(auditReferenceEntity("SessionResponseExecution", "responseId")).toBe("SessionPlanningResponse");
  expect(auditReferenceEntity("QualificationTransferGrant", "subjectId")).toBe("Subject");
  expect(auditReferenceEntity("HistoryRowOwnership", "recordId")).toBeUndefined();
});

it("scopes retired-history String states to their actual owner and preserves unknown values", () => {
  for (const value of ["ASSIGNED", "QUARANTINED"])
    expect(auditEnumLabelKey("RetiredHistoryOwnership", "state", value)).toBe(`auditEventDetails.presentation.historyOwnershipStates.${value}`);
  expect(auditEnumLabelKey("RetiredHistoryOwnership", "state", "FUTURE_STATE")).toBeNull();
  expect(auditEnumLabelKey("User", "state", "ASSIGNED")).toBeNull();
  expect(auditEnumLabelKey("RetiredHistoryOwnership", "readerUserId", "ASSIGNED")).toBeNull();
});

it("labels scheduled-refresh business state without registering private execution evidence for display", () => {
  expect(auditEntityLabelKey("ScheduledProgramRefresh")).toBe("auditEventDetails.presentation.entities.ScheduledProgramRefresh");
  expect(auditEnumLabelKey("ScheduledProgramRefresh", "state", "BLOCKED")).toBe("auditEventDetails.presentation.enums.ScheduledRefreshState.BLOCKED");
  expect(auditEnumLabelKey("ScheduledProgramRefresh", "blockedReason", "SCHEDULED_REFRESH_HEAD_CHANGED")).toBe("scheduledRefresh.errors.SCHEDULED_REFRESH_HEAD_CHANGED");
  expect(auditFieldLabelKey("ScheduledProgramRefresh", "executeAt")).toBe("auditEventDetails.presentation.fields.executeAt");
  expect(auditReferenceEntity("ScheduledProgramRefresh", "sourceTermId")).toBe("Term");
  for (const field of ["expectedPreparation", "authorizedById", "authorizedByName", "authorityRevision"]) {
    expect(auditFieldLabelKey("ScheduledProgramRefresh", field)).toBeNull();
    expect(auditReferenceEntity("ScheduledProgramRefresh", field)).toBeUndefined();
  }
  expect(reviewSchema.User.fields).toContain("refreshAuthorityRevision");
  expect(auditFieldLabelKey("User", "refreshAuthorityRevision")).toBeNull();
  expect(auditEnumLabelKey("User", "blockedReason", "SCHEDULED_REFRESH_HEAD_CHANGED")).toBeNull();
});

it("labels school-report proposal aliases and delivery references within their owners", () => {
  expect(auditEntityLabelKey("schoolHoursSchedule")).toBe(
    "auditEventDetails.presentation.entities.SchoolHoursSchedule",
  );
  expect(auditFieldLabelKey("schoolHoursSchedule", "dateOverrides")).toBe(
    "auditEventDetails.presentation.fields.dateOverrides",
  );
  expect(auditFieldLabelKey("SchoolHoursReport", "sourceBaseline")).toBe(
    "auditEventDetails.presentation.fields.sourceBaseline",
  );
  expect(auditFieldLabelKey("SchoolHoursReport", "linkVersion")).toBe(
    "auditEventDetails.presentation.fields.linkVersion",
  );
  expect(auditReferenceEntity("SchoolHoursReport", "scheduleId")).toBe(
    "SchoolHoursSchedule",
  );
  expect(auditReferenceEntity("EmailDelivery", "schoolHoursReportId")).toBe(
    "SchoolHoursReport",
  );
  expect(auditFieldLabelKey("MonthlyHoursSchedule", "dateOverrides")).toBeNull();
  expect(auditFieldLabelKey("User", "sourceBaseline")).toBeNull();
  expect(auditFieldLabelKey("SchoolHoursReport", "linkTokenHash")).toBeNull();
});

it("labels recovery evidence only within its known schema owners", () => {
  expect(auditEntityLabelKey("RecoveryReceipt")).toBe(
    "auditEventDetails.presentation.entities.RecoveryReceipt",
  );
  expect(auditFieldLabelKey("RecoveryChange", "changedFields")).toBe(
    "auditEventDetails.presentation.fields.changedFields",
  );
  expect(auditFieldLabelKey("User", "recoveryVoidedAt")).toBe(
    "auditEventDetails.presentation.fields.recoveryVoidedAt",
  );
  expect(auditFieldLabelKey("Tutor", "recoveryVoidedAt")).toBeNull();
  expect(auditFieldLabelKey("UnknownRecord", "changedFields")).toBeNull();
});

it("registers all five scoped recovery models with exact current scalar fields", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  for (const entity of ["RecoveryCheckpoint", "RecoveryDeliveryEffect", "RecoveryDeliveryCancellation",
    "RecoveryDeliveryCoverage", "RecoveryWorkflowDraft"] as const) {
    const model = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .find((match) => match[1] === entity);
    expect(model, entity).toBeDefined();
    const scalarFields = [...model![2]!.matchAll(
      /^\s*(\w+)\s+(?:String|Int|BigInt|Float|Boolean|DateTime|Json)(?:[?\[\]\s])/gm,
    )].map((match) => match[1]);
    expect(reviewSchema[entity].fields, entity).toEqual(scalarFields);
    expect(reviewSchema[entity].enums, entity).toEqual({});
    expect(reviewSchema[entity].references, entity).toEqual({});
    expect(auditEntityLabelKey(entity)).toBe(`auditEventDetails.presentation.entities.${entity}`);
  }
});

it("withholds checkpoint scope and exact draft identity/answers without narrowing unrelated field owners", () => {
  const withheld = {
    RecoveryCheckpoint: ["sourceId", "capturedById", "captureTransactionId", "scope"],
    RecoveryWorkflowDraft: ["sourceSurveyId", "sourceTuteeId", "ownerUserId", "ownerBindingHash", "answers", "submittedSurveyId"],
  };
  for (const [entity, fields] of Object.entries(withheld)) for (const field of fields) {
    expect(auditFieldLabelKey(entity, field), `${entity}.${field}`).toBeNull();
    expect(auditEnumLabelKey(entity, field, "PENDING_OWNER_REVIEW"), `${entity}.${field}`).toBeNull();
    expect(auditReferenceEntity(entity, field), `${entity}.${field}`).toBeUndefined();
  }
  expect(auditFieldLabelKey("RecoveryCheckpoint", "actionId")).toBe("auditEventDetails.presentation.fields.actionId");
  expect(auditFieldLabelKey("RecoveryWorkflowDraft", "state")).toBe("auditEventDetails.presentation.fields.state");
  expect(auditFieldLabelKey("SessionPlanningRequest", "scope")).toBe("auditEventDetails.presentation.fields.scope");
  expect(auditReferenceEntity("RecoveryCheckpoint", "sourceId")).toBeUndefined();
  // String state names remain literal until their owning workflow registers a
  // deliberate translation. Neither a polymorphic ID nor a token creates a route.
  expect(auditEnumLabelKey("RecoveryWorkflowDraft", "state", "PENDING_OWNER_REVIEW")).toBeNull();
  expect(auditEnumLabelKey("RecoveryCheckpoint", "state", "PENDING_OWNER_REVIEW")).toBeNull();
});

it("labels continuation evidence and retained-request outcomes only on their owning records", () => {
  for (const entity of [
    "StudentContinuationReceipt",
    "StudentContinuationAssignment",
    "StudentContinuationPairing",
    "SessionPlanContinuationMember",
  ])
    expect(auditEntityLabelKey(entity)).toBe(
      `auditEventDetails.presentation.entities.${entity}`,
    );
  expect(auditFieldLabelKey("Term", "signupFirstOpenedAt")).toBe(
    "auditEventDetails.presentation.fields.signupFirstOpenedAt",
  );
  expect(
    auditFieldLabelKey("StudentContinuationAssignment", "sourcePairingId"),
  ).toBe("auditEventDetails.presentation.fields.sourcePairingId");
  expect(
    auditFieldLabelKey("SessionPlanContinuationMember", "releasedAt"),
  ).toBe("auditEventDetails.presentation.fields.releasedAt");
  expect(auditFieldLabelKey("StudentSurvey", "signupFirstOpenedAt")).toBeNull();
  expect(auditFieldLabelKey("StudentSurvey", "publicSignupEmailConfirmedAt")).toBe(
    "auditEventDetails.presentation.fields.publicSignupEmailConfirmedAt",
  );
  expect(auditFieldLabelKey("User", "publicSignupEmailConfirmedAt")).toBeNull();
  expect(
    auditEnumLabelKey("StudentContinuationAssignment", "status", "UNASSIGNED"),
  ).toBe("legacyContinuation.result.queued");
  expect(
    auditEnumLabelKey("StudentContinuationAssignment", "status", "RELEASED"),
  ).toBe("legacyContinuation.result.released");
  expect(
    auditEnumLabelKey("StudentContinuationAssignment", "reason", "RELEASED"),
  ).toBeNull();
  expect(auditEnumLabelKey("StudentSurvey", "status", "UNASSIGNED")).toBeNull();
});

it("labels notification preference schema and scopes closed topics without exposing literal evidence", () => {
  expect(auditReferenceEntity("NotificationPreference", "userId")).toBe("User");
  for (const [entity, field] of [
    ["User", "emailReviewRequests"], ["User", "emailEventReminders"], ["User", "notificationPreferences"],
    ["Notification", "category"], ["EmailDelivery", "preferenceTopic"], ["EmailDelivery", "reminderKey"],
    ["NotificationPreference", "category"], ["NotificationPreference", "badgeEnabled"], ["NotificationPreference", "emailEnabled"],
  ]) expect(auditFieldLabelKey(entity, field!)).toBe(`auditEventDetails.presentation.fields.${field}`);
  for (const category of notificationCategories) {
    for (const [entity, field] of [["Notification", "category"], ["NotificationPreference", "category"], ["EmailDelivery", "preferenceTopic"]])
      expect(auditEnumLabelKey(entity, field!, category)).toBe(`notificationPreferences.categories.${category}`);
    expect(auditEnumLabelKey("Notification", "body", category)).toBeNull();
  }
  expect(auditEnumLabelKey("EmailDelivery", "category", "reviews")).toBeNull();
  expect(auditEnumLabelKey("EmailDelivery", "category", "review")).toBe("notificationPreferences.categories.reviews");
  expect(auditEnumLabelKey("EmailDelivery", "category", "security")).toBe("auditEventDetails.presentation.deliveryCategories.security");
  expect(auditEnumLabelKey("NotificationPreference", "category", "PRIVATE_SENTINEL")).toBeNull();
  expect(auditEnumLabelKey("EmailDelivery", "reminderKey", "reminders")).toBeNull();
});
it.each(Object.entries({ en, zh, de, el, es, fr, ja, ko }))(
  "has localized schema vocabulary in %s",
  (_locale, catalog) => {
    for (const [entity, schema] of Object.entries(reviewSchema)) {
      expect(at(catalog, auditEntityLabelKey(entity)), entity).toBeTruthy();
      for (const [field, type] of Object.entries(schema.enums))
        for (const value of (
          reviewEnumValues as Record<string, readonly string[]>
        )[type] ?? [])
          expect(
            at(catalog, auditEnumLabelKey(entity, field, value)),
            `${entity}.${field}.${value}`,
          ).toBeTruthy();
    }
    for (const field of reviewFieldKeys)
      expect(
        at(catalog, `auditEventDetails.presentation.fields.${field}`),
        field,
      ).toBeTruthy();
    for (const kind of ["ATTEMPT", "REVERSAL"])
      expect(at(catalog, `auditFilters.kinds.${kind}`)).toBeTruthy();
    for (const [entity, fields] of Object.entries(
      reviewStringDomains as Record<
        string,
        Record<string, Record<string, string>>
      >,
    ))
      for (const [field, values] of Object.entries(fields))
        for (const [value, key] of Object.entries(values)) {
          expect(auditEnumLabelKey(entity, field, value)).toBe(key);
          expect(at(catalog, key), `${entity}.${field}.${value}`).toBeTruthy();
        }
  },
);

it("covers every current schema model and enum value and reports schema drift", () => {
  const schema = readFileSync(
    new URL("../../prisma/schema.prisma", import.meta.url),
    "utf8",
  );
  expect(Object.keys(reviewSchema).sort()).toEqual(
    [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]).sort(),
  );
  for (const match of schema.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
    const expected = match[2]!
      .split(/\r?\n/)
      .map((line) => line.split("//")[0]!.trim())
      .filter(Boolean);
    expect(reviewEnumValues[match[1] as keyof typeof reviewEnumValues]).toEqual(
      expected,
    );
  }
  // Reusing an existing enum on a new field is schema drift too: merely checking
  // the enum's value list would miss that new display path.
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const enumFields = Object.fromEntries(
      [...match[2]!.matchAll(/^\s*(\w+)\s+(\w+)[?\[\]\s]/gm)]
        .filter((field) => Object.hasOwn(reviewEnumValues, field[2]!))
        .map((field) => [field[1]!, field[2]!]),
    );
    expect(reviewSchema[match[1] as keyof typeof reviewSchema].enums).toEqual(
      enumFields,
    );
  }
});

it("gives closed String states their owning workflow meaning without translating literal text", () => {
  expect(auditEnumLabelKey("TranslationDraft", "state", "APPROVED")).toBe(
    "translationEditor.APPROVED",
  );
  expect(
    at(en, auditEnumLabelKey("TranslationDraft", "state", "APPROVED")),
  ).toBe("Published");
  expect(auditEnumLabelKey("StudentAppeal", "state", "UPHELD")).toBe(
    "approvals.review.overturn",
  );
  expect(auditEnumLabelKey("StudentAppeal", "state", "REJECTED")).toBe(
    "approvals.review.uphold",
  );
  expect(auditEnumLabelKey("MessageModeration", "action", "RESTORE")).toBe(
    "messaging.actions.RESTORE",
  );
  expect(auditEnumLabelKey("SchoolDepartureEvent", "action", "RESTORE")).toBe(
    "approvals.review.values.RESTORE",
  );
  expect(auditFieldLabelKey("MessageModeration", "action")).toBe(
    "auditEventDetails.action",
  );
  expect(
    auditEnumLabelKey("MessagePermission", "groups", "CURRENT_TUTORS"),
  ).toBe("messaging.groups.CURRENT_TUTORS");
  expect(auditEnumLabelKey("StudentAppeal", "decision", "UPHELD")).toBeNull();
  expect(
    auditEnumLabelKey("SchoolDepartureEvent", "explanation", "RESTORE"),
  ).toBeNull();
  expect(auditEnumLabelKey("MessageModeration", "reason", "HIDE")).toBeNull();
  expect(
    auditEnumLabelKey("TranslationDraft", "state", "FUTURE_STATE"),
  ).toBeNull();
  expect(auditEnumLabelKey("TranslationDraft", "state", "toString")).toBeNull();
  expect(auditEnumLabelKey("Unknown", "state", "UPHELD")).toBeNull();
  for (const entity of ["__proto__", "constructor", "toString"]) {
    expect(auditEntityLabelKey(entity)).toBeNull();
    expect(auditFieldLabelKey(entity, "name")).toBeNull();
    expect(auditEnumLabelKey(entity, "state", "UPHELD")).toBeNull();
  }
  expect(
    auditEnumLabelKey("TranslationDraft", "constructor", "name"),
  ).toBeNull();
});

it("keeps enum meaning scoped to its entity and unknown evidence literal", () => {
  expect(auditEnumLabelKey("Session", "tutorStatus", "EXTRA")).toContain(
    "SessionTutorStatus.EXTRA",
  );
  expect(auditEnumLabelKey("ServiceHourAdjustment", "type", "EXTRA")).toContain(
    "AdjustmentType.EXTRA",
  );
  expect(auditEnumLabelKey("Pairing", "roomMode", "AUTO")).toContain(
    "PairingRoomMode.AUTO",
  );
  expect(auditEnumLabelKey("DisciplinaryCard", "source", "AUTO")).toContain(
    "CardSource.AUTO",
  );
  expect(auditFieldLabelKey("Pairing", "groupId")).toContain(
    "fieldOverrides.combinedGroup",
  );
  expect(auditEnumLabelKey("Tutor", "name", "ACTIVE")).toBeNull();
  expect(auditEnumLabelKey("Unknown", "status", "ACTIVE")).toBeNull();
  expect(auditEnumLabelKey("Tutor", "status", "FUTURE_STATE")).toBeNull();
  expect(auditFieldLabelKey("Unknown", "name")).toBeNull();
  expect(auditFieldLabelKey("Tutor", "futureField")).toBeNull();
});
