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
} from "./review-vocabulary";
import { approvalPresentation } from "./approval-presentation";
import { isReviewReference } from "./approval-summary";

it("registers exact retained decline metadata while withholding its private source and retry evidence", () => {
  const schema = readFileSync(
    new URL("../../prisma/schema.prisma", import.meta.url),
    "utf8",
  );
  const model = /^model LegacySignupDecline \{([\s\S]*?)^\}/m.exec(schema);
  expect(model).not.toBeNull();
  const fields = [...model![1]!.matchAll(/^\s*(\w+)\s+\w+[?\[\]\s]/gm)].map(
    (field) => field[1],
  );
  expect(reviewSchema.LegacySignupDecline.fields).toEqual(fields);
  expect(reviewSchema.LegacySignupDecline.enums).toEqual({});
  expect(auditEntityLabelKey("LegacySignupDecline")).toBe(
    "auditEventDetails.presentation.entities.LegacySignupDecline",
  );
  expect(auditReferenceEntity("LegacySignupDecline", "tuteeId")).toBe("Tutee");
  expect(auditReferenceEntity("LegacySignupDecline", "termId")).toBe("Term");
  expect(auditFieldLabelKey("LegacySignupDecline", "resolvedAt")).toBe(
    "auditEventDetails.presentation.fields.resolvedAt",
  );
  for (const field of [
    "intakeSnapshot",
    "clientKey",
    "inputHash",
    "expectedUpdatedAt",
  ]) {
    expect(auditFieldLabelKey("LegacySignupDecline", field), field).toBeNull();
    expect(
      auditReferenceEntity("LegacySignupDecline", field),
      field,
    ).toBeUndefined();
    expect(
      auditEnumLabelKey("LegacySignupDecline", field, "DECLINED"),
      field,
    ).toBeNull();
  }
  // Decline is an explicit source decision, not a new participation status enum.
  expect(
    auditEnumLabelKey("LegacySignupDecline", "state", "DECLINED"),
  ).toBeNull();
  expect(auditFieldLabelKey("SessionPlanningReceipt", "clientKey")).toBe(
    "auditEventDetails.presentation.fields.clientKey",
  );
});

it("summarizes a legacy decline as retained closure against its exact captured tutee", () => {
  const payload = {
    id: "legacy-source",
    expectedUpdatedAt: new Date("2026-10-01T08:00:00Z"),
    clientKey: "PRIVATE-DECLINE-RETRY",
  };
  const targets = {
    Tutee: [
      {
        record: {
          id: "legacy-source",
          englishName: "Captured legacy learner",
          status: "PENDING",
        },
      },
    ],
    "Tutee.LegacySignupDecline": [
      {
        record: {
          tuteeId: "legacy-source",
          intakeSnapshot: { email: "PRIVATE-INTAKE" },
          inputHash: "PRIVATE-HASH",
        },
      },
    ],
  };
  const original = structuredClone({ payload, targets });
  const model = approvalPresentation("admin.declineSignup", payload, targets);
  expect(model.outcome).toBe("declineLegacySignupOutcome");
  expect(model.summary).toMatchObject({
    known: true,
    operationKey: "admin_declineSignup",
    changes: [],
  });
  const source = model.summary.facts.find((fact) => fact.key === "id")?.value;
  expect(isReviewReference(source)).toBe(true);
  expect(source).toMatchObject({
    entity: "Tutee",
    id: "legacy-source",
    name: "Captured legacy learner",
    state: "recorded",
  });
  expect(JSON.stringify(model.summary)).not.toMatch(
    /PRIVATE-DECLINE-RETRY|PRIVATE-INTAKE|PRIVATE-HASH|expectedUpdatedAt/,
  );
  expect({ payload, targets }).toEqual(original);
});

it.each(Object.entries({ en, zh, de, el, es, fr, ja, ko }))(
  "labels retained decline decisions and their closure consequence in %s",
  (_locale, catalog) => {
    expect(catalog.approvals.review.entities.LegacySignupDecline).toBeTruthy();
    expect(
      catalog.auditEventDetails.presentation.entities.LegacySignupDecline,
    ).toBeTruthy();
    expect(
      catalog.approvals.review.operations.admin_declineSignup,
    ).toBeTruthy();
    expect(catalog.approvals.review.declineLegacySignupOutcome).toBeTruthy();
  },
);
