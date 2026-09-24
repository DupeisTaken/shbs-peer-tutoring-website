import { z } from "zod";

export const signupFormSchema = z.enum(["tutee", "tutor"]);
export type SignupFormKind = z.infer<typeof signupFormSchema>;
// A single state makes the impossible combination hidden + required unrepresentable.
export const fieldStateSchema = z.enum(["hidden", "optional", "required"]);
export type FieldState = z.infer<typeof fieldStateSchema>;
type Field = {
  key: string;
  label: string;
  initial: FieldState;
  locked?: boolean;
};
export const SIGNUP_FIELDS: Record<SignupFormKind, readonly Field[]> = {
  tutee: [
    { key: "name", label: "name", initial: "required", locked: true },
    { key: "gradeLevel", label: "gradeLevel", initial: "optional" },
    { key: "email", label: "email", initial: "required", locked: true },
    { key: "phone", label: "phone", initial: "optional" },
    { key: "preferredContact", label: "preferredContact", initial: "required" },
    {
      key: "firstSubject",
      label: "firstSubject",
      initial: "required",
      locked: true,
    },
    { key: "secondSubject", label: "secondSubject", initial: "optional" },
    { key: "availability", label: "availability", initial: "required" },
    { key: "policy", label: "policy", initial: "required", locked: true },
    { key: "signatureName", label: "signatureName", initial: "required" },
  ],
  tutor: [
    {
      key: "firstSubject",
      label: "firstSubject",
      initial: "required",
      locked: true,
    },
    { key: "secondSubject", label: "secondSubject", initial: "optional" },
    { key: "thirdSubject", label: "thirdSubject", initial: "optional" },
    { key: "taken", label: "taken", initial: "optional" },
    { key: "hasApScore", label: "hasApScore", initial: "optional" },
    { key: "selfStudied", label: "selfStudied", initial: "optional" },
    { key: "grade", label: "grade", initial: "optional" },
    { key: "apScore", label: "apScore", initial: "optional" },
    { key: "selfStudyNote", label: "selfStudyNote", initial: "optional" },
    { key: "policy", label: "policy", initial: "required", locked: true },
    { key: "name", label: "name", initial: "required", locked: true },
    { key: "email", label: "email", initial: "required", locked: true },
    { key: "preferredContact", label: "preferredContact", initial: "required" },
  ],
};
export type FieldSettings = Record<string, FieldState>;
export type SignupSettings = Record<SignupFormKind, FieldSettings>;

/** Only known fields can be configured; essentials also survive invalid legacy JSON. */
export function signupSettings(value: unknown): SignupSettings {
  const stored = z.record(z.record(fieldStateSchema)).safeParse(value);
  return Object.fromEntries(
    (["tutee", "tutor"] as const).map((form) => [
      form,
      Object.fromEntries(
        SIGNUP_FIELDS[form].map((field) => [
          field.key,
          field.locked
            ? "required"
            : ((stored.success ? stored.data[form]?.[field.key] : undefined) ??
              field.initial),
        ]),
      ),
    ]),
  ) as SignupSettings;
}
export function fieldMissing(
  settings: FieldSettings,
  key: string,
  value: unknown,
) {
  return (
    settings[key] === "required" &&
    (value == null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && !value.length))
  );
}

export type TuteeFields = {
  gradeLevel?: string;
  phone?: string;
  preferredContact: string;
  secondChoiceId?: string;
  slotIds: string[];
  signatureName: string;
};
export function normalizeTuteeFields<T extends TuteeFields>(
  input: T,
  fields: FieldSettings,
): T {
  return {
    ...input,
    gradeLevel: fields.gradeLevel === "hidden" ? undefined : input.gradeLevel,
    phone: fields.phone === "hidden" ? undefined : input.phone,
    preferredContact:
      fields.preferredContact === "hidden" ? "" : input.preferredContact,
    secondChoiceId:
      fields.secondSubject === "hidden" ? undefined : input.secondChoiceId,
    slotIds: fields.availability === "hidden" ? [] : input.slotIds,
    signatureName: fields.signatureName === "hidden" ? "" : input.signatureName,
  };
}
export function missingTuteeFields(input: TuteeFields, fields: FieldSettings) {
  const values = {
    gradeLevel: input.gradeLevel,
    phone: input.phone,
    preferredContact: input.preferredContact,
    signatureName: input.signatureName,
    secondSubject: input.secondChoiceId,
    availability: input.slotIds,
  };
  return Object.entries(values)
    .filter(([key, value]) => fieldMissing(fields, key, value))
    .map(([key]) => key);
}

export type TutorSubjectFields = {
  subjectId: string;
  taken?: boolean;
  grade?: string;
  hasApScore?: boolean;
  apScore?: string;
  selfStudied?: boolean;
  selfStudyNote?: string;
};
export const subjectFieldKey = (index: number) =>
  ["firstSubject", "secondSubject", "thirdSubject"][index]!;
/** Conditional details only apply to a visible, affirmative parent answer (and AP subjects).
 * Required yes/no questions require an explicit answer, never an assertion of qualification. */
export function normalizeTutorSubject(
  row: TutorSubjectFields,
  fields: FieldSettings,
  isAp: boolean,
): TutorSubjectFields {
  const taken = fields.taken === "hidden" ? undefined : row.taken;
  const hasApScore =
    !isAp || fields.hasApScore === "hidden" ? undefined : row.hasApScore;
  const selfStudied =
    fields.selfStudied === "hidden" ? undefined : row.selfStudied;
  return {
    ...row,
    taken,
    hasApScore,
    selfStudied,
    grade: taken && fields.grade !== "hidden" ? row.grade : undefined,
    apScore:
      hasApScore && fields.apScore !== "hidden" ? row.apScore : undefined,
    selfStudyNote:
      selfStudied && fields.selfStudyNote !== "hidden"
        ? row.selfStudyNote
        : undefined,
  };
}
export function missingTutorSubject(
  row: TutorSubjectFields,
  fields: FieldSettings,
  isAp: boolean,
) {
  return [
    "taken",
    ...(isAp ? ["hasApScore"] : []),
    "selfStudied",
    ...(row.taken ? ["grade"] : []),
    ...(isAp && row.hasApScore ? ["apScore"] : []),
    ...(row.selfStudied ? ["selfStudyNote"] : []),
  ].filter((key) =>
    fieldMissing(fields, key, row[key as keyof TutorSubjectFields]),
  );
}
