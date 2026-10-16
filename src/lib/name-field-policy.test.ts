import { expect, it } from "vitest";
import {
  DEFAULT_NAME_FIELDS,
  hasDisplayableName,
  missingPersonNames,
  nameFieldPolicies,
  normalizeNewNames,
  nameAccountType,
} from "./name-field-policy";
import { nameDraft } from "./person-name";
it("normalizes missing and malformed individual role states without rejecting an intentional all-hidden policy", () => {
  const policies = nameFieldPolicies({
    STUDENT: {
      firstName: "hidden",
      lastName: "required",
      preferredName: "hidden",
      alternativeNames: "hidden",
    },
    VIEWER: { firstName: "invalid" },
  });
  expect(policies.STUDENT.firstName).toBe("hidden");
  expect(policies.STUDENT.lastName).toBe("required");
  expect(policies.VIEWER).toEqual(DEFAULT_NAME_FIELDS);
  expect(policies.HEAD).toEqual(DEFAULT_NAME_FIELDS);
  expect(nameAccountType("ADMIN", "TUTOR")).toBe("ADMIN");
  expect(nameAccountType("translator", "STUDENT")).toBe("STUDENT");
});
it("requires only configured components and removes new hidden answers without modifying the original draft", () => {
  const value = nameDraft({
    firstName: "原始值",
    lastName: " ",
    preferredName: "Alias",
  });
  const states = {
    ...DEFAULT_NAME_FIELDS,
    firstName: "hidden" as const,
    lastName: "required" as const,
  };
  expect(missingPersonNames(value, states)).toEqual(["lastName"]);
  expect(normalizeNewNames(value, states).firstName).toBe("");
  expect(value.firstName).toBe("原始值");
});
it("matches live display preference/visibility and distinguishes an unsplit legacy identity from cleared structured fields", () => {
  const value = {
    ...nameDraft(),
    legacyName: "Original unsplit",
    legacyIdentity: true,
  };
  expect(hasDisplayableName(value, DEFAULT_NAME_FIELDS, true, false)).toBe(
    true,
  );
  expect(
    hasDisplayableName(
      { ...value, legacyIdentity: false },
      DEFAULT_NAME_FIELDS,
      true,
      false,
    ),
  ).toBe(false);
  expect(
    hasDisplayableName(
      value,
      { ...DEFAULT_NAME_FIELDS, lastName: "hidden" },
      true,
      false,
    ),
  ).toBe(false);
  expect(
    hasDisplayableName(
      { ...nameDraft({ preferredName: "Only alias" }) },
      DEFAULT_NAME_FIELDS,
      false,
      false,
    ),
  ).toBe(false);
  expect(
    hasDisplayableName(
      { ...nameDraft({ preferredName: "Only alias" }) },
      DEFAULT_NAME_FIELDS,
      true,
      false,
    ),
  ).toBe(true);
  expect(
    hasDisplayableName(
      { ...nameDraft({ alternativeNames: "仅其他文字" }) },
      DEFAULT_NAME_FIELDS,
      true,
      true,
    ),
  ).toBe(true);
});
