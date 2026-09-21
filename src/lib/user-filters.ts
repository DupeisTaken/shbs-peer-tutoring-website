import { accountMembership, membershipBadges } from "./account-membership";
export type Selection = { include: string[]; exclude: string[] };
export type UserFilters = {
  role: Selection;
  status: Selection;
  account: Selection;
};
export const emptyUserFilters = (): UserFilters => ({
  role: { include: [], exclude: [] },
  status: { include: [], exclude: [] },
  account: { include: [], exclude: [] },
});
/** OR inside one include list, AND across dimensions; exclusion always takes precedence. */
export function matchesSelection(
  value: string | null | undefined,
  selection: Selection,
) {
  const normalized = value ?? "__none__";
  return (
    !selection.exclude.includes(normalized) &&
    (!selection.include.length || selection.include.includes(normalized))
  );
}
export function matchesUserFilters(
  row: { role: string | null; tutorStatus: string | null; account: string; tutorId?: string | null; tutorAccessRevoked?: boolean; tuteeMember?: boolean; canTranslate?: boolean; crewStatus?: string | null },
  filters: UserFilters,
) {
  // Match every applicable badge, including independent Translator/Crew participation.
  const badges = "tuteeMember" in row ? membershipBadges(accountMembership(row)) : [row.role ?? "__none__"];
  if (!badges.length) badges.push("__none__");
  return (
    !badges.some(badge => filters.role.exclude.includes(badge)) &&
    (!filters.role.include.length || badges.some(badge => filters.role.include.includes(badge))) &&
    matchesSelection(row.tutorStatus, filters.status) &&
    matchesSelection(row.account, filters.account)
  );
}
export function parseUserFilters(raw: string | null): UserFilters {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return emptyUserFilters();
    const result = emptyUserFilters();
    for (const key of ["role", "status", "account"] as const) {
      const group: unknown = (value as Record<string, unknown>)[key];
      if (!group || typeof group !== "object") continue;
      for (const mode of ["include", "exclude"] as const) {
        const list: unknown = (group as Record<string, unknown>)[mode];
        if (Array.isArray(list))
          result[key][mode] = list.filter(
            (item): item is string => typeof item === "string",
          );
      }
    }
    return result;
  } catch {
    return emptyUserFilters();
  }
}
