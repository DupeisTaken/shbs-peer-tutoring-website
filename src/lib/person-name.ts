import { z } from "zod";
import { isLatinPrimaryName } from "./profile-policy";

export const latinName = z
  .string()
  .trim()
  .max(100)
  .refine(
    (value) => !value || isLatinPrimaryName(value),
    "PROFILE_LATIN_NAME_REQUIRED",
  );
/** New profile fields are explicit. Never guess given/family boundaries from a display string. */
export const personNameFields = {
  // Script/length parsing is separate from role-configured requiredness.
  firstName: latinName,
  lastName: latinName,
  preferredName: latinName
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value)),
  alternativeNames: z.string().trim().max(200).nullable().optional(),
};
export const personNameSchema = z.object(personNameFields);
// Older clients and historical intake payloads carry only a full name. Preserve that
// compatibility without guessing its parts; all current forms send the explicit fields.
export const optionalPersonNameFields = {
  // Transport validates shape only: the locked domain policy decides visibility,
  // requiredness and which intentional replacements need script validation.
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  preferredName: z.string().trim().max(100).nullable().optional(),
  alternativeNames: personNameFields.alternativeNames,
};
export type PersonNameInput = z.infer<typeof personNameSchema>;
export type PersonNameDraft = {
  firstName: string;
  lastName: string;
  preferredName: string;
  alternativeNames: string;
};
export function nameDraft(
  person?: {
    firstName?: string | null;
    lastName?: string | null;
    preferredName?: string | null;
    alternativeNames?: string | null;
  } | null,
): PersonNameDraft {
  return {
    firstName: person?.firstName ?? "",
    lastName: person?.lastName ?? "",
    preferredName: person?.preferredName ?? "",
    alternativeNames: person?.alternativeNames ?? "",
  };
}
export function fullPersonName(person: {
  firstName: string;
  lastName?: string | null;
}) {
  return [person.firstName.trim(), person.lastName?.trim()]
    .filter(Boolean)
    .join(" ");
}

/** Only an actually unsplit record receives the original First Name exception.
 * Empty structured parts and preferred-only identities are still structured. */
export function unsplitLegacyName(
  person?: {
    firstName?: string | null;
    lastName?: string | null;
    preferredName?: string | null;
    legacyName?: string | null;
    username?: string | null;
    name?: string | null;
    englishName?: string | null;
  } | null,
) {
  if (
    !person ||
    (["firstName", "lastName", "preferredName"] as const).some(
      (key) => person[key] != null,
    )
  )
    return null;
  // An explicit null means no original was stored. Active username fallbacks
  // must never become legacy evidence or exempt a newly required First Name.
  if (person.legacyName !== undefined) return person.legacyName;
  const label = person.name ?? person.englishName ?? null;
  return label && label !== person.username ? label : null;
}

/** An existing unsplit identity may be kept, but never inferred from a display label.
 * Editing any Latin field opts into the complete structured-name validation. */
export function preservesLegacyName(
  value: PersonNameDraft,
  original: PersonNameDraft | undefined,
  legacyName?: string | null,
) {
  return (
    !!legacyName?.trim() &&
    !!original &&
    !original.firstName.trim() &&
    (["firstName", "lastName", "preferredName"] as const).every(
      (key) => value[key].trim() === original[key].trim(),
    )
  );
}

/** Omit unchanged legacy Latin fields so domain writers retain nulls and provenance.
 * The independent additional-language field remains editable. */
export function personNameEdit(
  value: PersonNameDraft,
  original: PersonNameDraft,
  legacyName?: string | null,
) {
  const preserved = preservesLegacyName(value, original, legacyName);
  return {
    name: preserved ? legacyName! : fullPersonName(value),
    fields: preserved ? { alternativeNames: value.alternativeNames } : value,
    preserved,
  };
}
