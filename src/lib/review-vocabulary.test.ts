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
  reviewSchema,
  reviewEnumValues,
  reviewFieldKeys,
  reviewStringDomains,
} from "./review-vocabulary";

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
