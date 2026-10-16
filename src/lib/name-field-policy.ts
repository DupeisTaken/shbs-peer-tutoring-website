import { z } from "zod";
import { fieldStateSchema, type FieldState } from "./signup-fields";
import type { PersonNameDraft } from "./person-name";
export const NAME_ACCOUNT_TYPES = [
  "STUDENT",
  "TUTOR",
  "CREW",
  "VIEWER",
  "COORDINATOR",
  "ADMIN",
  "HEAD",
] as const;
export const nameAccountTypeSchema = z.enum(NAME_ACCOUNT_TYPES);
export type NameAccountType = z.infer<typeof nameAccountTypeSchema>;
export const NAME_FIELD_KEYS = [
  "firstName",
  "lastName",
  "preferredName",
  "alternativeNames",
] as const;
export const nameFieldStatesSchema = z
  .object({
    firstName: fieldStateSchema,
    lastName: fieldStateSchema,
    preferredName: fieldStateSchema,
    alternativeNames: fieldStateSchema,
  })
  .strict();
export type NameFieldStates = z.infer<typeof nameFieldStatesSchema>;
export type NameFieldPolicies = Record<NameAccountType, NameFieldStates>;
/** Presentation follows the same configured fields without exposing retained Hidden values. */
export function hasVisibleNameFields(
  states: NameFieldStates,
  latinOnly = false,
) {
  return NAME_FIELD_KEYS.some(
    (key) =>
      (!latinOnly || key !== "alternativeNames") && states[key] !== "hidden",
  );
}
export const DEFAULT_NAME_FIELDS: NameFieldStates = {
  firstName: "required",
  lastName: "optional",
  preferredName: "optional",
  alternativeNames: "optional",
};
/** Missing/invalid individual keys retain existing behavior; an all-hidden policy is deliberate and valid. */
export function nameFieldPolicies(stored: unknown): NameFieldPolicies {
  const value =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    NAME_ACCOUNT_TYPES.map((role) => {
      const row =
        value[role] && typeof value[role] === "object"
          ? (value[role] as Record<string, unknown>)
          : {};
      return [
        role,
        Object.fromEntries(
          NAME_FIELD_KEYS.map((key) => {
            const state = fieldStateSchema.safeParse(row[key]);
            return [key, state.success ? state.data : DEFAULT_NAME_FIELDS[key]];
          }),
        ),
      ];
    }),
  ) as NameFieldPolicies;
}
export function missingPersonNames(
  value: PersonNameDraft,
  states: NameFieldStates,
) {
  return NAME_FIELD_KEYS.filter(
    (key) => states[key] === "required" && !value[key].trim(),
  );
}
export function normalizeNewNames(
  value: PersonNameDraft,
  states: NameFieldStates,
): PersonNameDraft {
  return Object.fromEntries(
    NAME_FIELD_KEYS.map((key) => [
      key,
      states[key] === "hidden" ? "" : value[key].trim(),
    ]),
  ) as PersonNameDraft;
}
/** Role is the canonical account role; independent tutor/crew/student badges never combine policies. */
export function nameAccountType(
  role: string | null | undefined,
  fallback: NameAccountType,
): NameAccountType {
  const parsed = nameAccountTypeSchema.safeParse(role);
  return parsed.success ? parsed.data : fallback;
}
export type NameFieldState = FieldState;

/** Live label decisions never modify originals; unsplit legacy text is omitted if it may contain a hidden part. */
export function hasDisplayableName(
  value: PersonNameDraft & {
    legacyName?: string | null;
    legacyIdentity?: boolean;
  },
  states: NameFieldStates,
  usePreferredNames: boolean,
  showAlternateNames: boolean,
) {
  return !!(
    (states.firstName !== "hidden" && value.firstName.trim()) ||
    (states.lastName !== "hidden" && value.lastName.trim()) ||
    (usePreferredNames &&
      states.preferredName !== "hidden" &&
      value.preferredName.trim()) ||
    (showAlternateNames &&
      states.alternativeNames !== "hidden" &&
      value.alternativeNames.trim()) ||
    (value.legacyIdentity &&
      (["firstName", "lastName", "preferredName"] as const).every(
        (key) => states[key] !== "hidden",
      ) &&
      value.legacyName?.trim())
  );
}
