import { accountMembership, membershipBadges } from "./account-membership";
import { isPastTutor } from "./tutor-visibility";
export type Selection = { include: string[]; exclude: string[] };
export type UserFilters = {
  role: Selection;
  status: Selection;
  account: Selection;
  showPastTutors: boolean;
  showUnverified: boolean;
};
export const emptyUserFilters = (): UserFilters => ({
  role: { include: [], exclude: [] },
  status: { include: [], exclude: [] },
  account: { include: [], exclude: [] },
  showPastTutors: false,
  showUnverified: false,
});
/** Only an explicit Tutor-only include makes lifecycle status meaningful. */
export function isTutorStatusApplicable(role: Selection): boolean {
  return (
    role.include.length > 0 &&
    role.include.every((value) => value === "TUTOR") &&
    !role.exclude.includes("TUTOR")
  );
}

/** Normalize on both restoration and edits so a hidden selection cannot return later. */
export function normalizeUserFilters(filters: UserFilters): UserFilters {
  return isTutorStatusApplicable(filters.role)
    ? filters
    : { ...filters, status: { include: [], exclude: [] } };
}
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
  row: {
    role: string | null;
    tutorStatus: string | null;
    account: string;
    tutorId?: string | null;
    tutorAccessRevoked?: boolean;
    tuteeMember?: boolean;
    canTranslate?: boolean;
    crewStatus?: string | null;
    emailVerifiedAt?: Date | string | null;
    userId?: string | null;
    currentTutee?: boolean;
    hasTuteeHistory?: boolean;
  },
  filters: UserFilters,
) {
  // Match every applicable badge, including independent Translator/Crew participation.
  const badges =
    "tuteeMember" in row
      ? membershipBadges(accountMembership(row))
      : [row.role ?? "__none__"];
  // An explicit lifecycle search includes historical tutor records even when their
  // archived membership no longer grants the Tutor badge or workspace access.
  const explicitPast =
    isTutorStatusApplicable(filters.role) &&
    filters.status.include.includes(row.tutorStatus ?? "__none__") &&
    isPastTutor(row.tutorStatus);
  if (explicitPast && !badges.includes("TUTOR")) badges.push("TUTOR");
  if (!badges.length) badges.push("__none__");
  // An archived tutor identity cannot hide independently current account capabilities.
  const otherCurrent =
    ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"].includes(row.role ?? "") ||
    row.crewStatus === "ACTIVE" ||
    row.canTranslate === true ||
    row.currentTutee === true ||
    (row.tutorStatus === "ACTIVE" && !row.tutorAccessRevoked);
  const explicitlyRequestedSetup = filters.account.include.some((value) =>
    ["setup", "invited", "none"].includes(value),
  );
  const unverified = !!row.userId && row.emailVerifiedAt === null;
  return (
    (!unverified || filters.showUnverified || explicitlyRequestedSetup) &&
    ((!isPastTutor(row.tutorStatus) && !row.hasTuteeHistory) ||
      otherCurrent ||
      filters.showPastTutors ||
      explicitPast) &&
    !badges.some((badge) => filters.role.exclude.includes(badge)) &&
    (!filters.role.include.length ||
      badges.some((badge) => filters.role.include.includes(badge))) &&
    // Also guard matching itself for callers with old, unnormalized preferences.
    (!isTutorStatusApplicable(filters.role) ||
      matchesSelection(row.tutorStatus, filters.status)) &&
    matchesSelection(row.account, filters.account)
  );
}
export function parseUserFilters(raw: string | null): UserFilters {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return emptyUserFilters();
    const result = emptyUserFilters();
    result.showUnverified =
      (value as Record<string, unknown>).showUnverified === true;
    result.showPastTutors =
      (value as Record<string, unknown>).showPastTutors === true;
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
    return normalizeUserFilters(result);
  } catch {
    return emptyUserFilters();
  }
}
