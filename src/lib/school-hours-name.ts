export type SchoolHoursName = {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  alternativeNames?: string | null;
  legacyName?: string | null;
  name?: string | null;
  englishName?: string | null;
  nameFieldsConfirmed?: boolean;
};

/** Export identity is independent of display preferences. Never split a legacy
 * label or present unconfirmed inferred parts as verified legal fields. */
export function schoolHoursExportName(person: SchoolHoursName) {
  const nonempty = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed?.length ? trimmed : undefined;
  };
  const first = nonempty(person.firstName);
  const last = nonempty(person.lastName);
  const nickname = nonempty(person.preferredName);
  const structured =
    person.nameFieldsConfirmed !== false &&
    (first !== undefined || last !== undefined);
  const primary = structured
    ? [first, nickname ? `"${nickname}"` : null, last].filter(Boolean).join(" ")
    : (nonempty(person.legacyName) ??
      nonempty(person.englishName) ??
      nonempty(person.name) ??
      "Unnamed participant");
  const alternate = nonempty(person.alternativeNames);
  return `${primary}${alternate ? ` (${alternate})` : ""}`;
}
