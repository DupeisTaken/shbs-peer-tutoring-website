type SearchablePerson = {
  englishName?: string | null;
  legacyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  alternativeNames?: string | null;
};
const normalize = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** Display preferences never remove saved identity from search. Include joined
 * forms for multiword queries, without guessing parts of unsplit legacy names. */
export function matchesPersonSearch(
  person: SearchablePerson,
  query: string,
  identifiers: (string | null | undefined)[] = [],
) {
  const needle = normalize(query);
  if (!needle) return true;
  return [
    person.englishName,
    person.legacyName,
    person.firstName,
    person.lastName,
    person.preferredName,
    person.alternativeNames,
    [person.firstName, person.lastName].filter(Boolean).join(" "),
    [person.preferredName, person.lastName].filter(Boolean).join(" "),
    ...identifiers,
  ].some((value) => !!value && normalize(value).includes(needle));
}
