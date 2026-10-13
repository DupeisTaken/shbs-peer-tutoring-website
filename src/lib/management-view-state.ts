import { viewEnum, viewFields, viewSearch } from "./session-view-state";
import {
  emptyUserFilters,
  normalizeUserFilters,
  type UserFilters,
} from "./user-filters";

/** Flat presentation fields only: drafts, credentials, records and selections
 * stay with the existing form, review or version owner. */
export const viewBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : undefined;
export const viewMonth = (value: unknown) =>
  typeof value === "string" &&
  (value === "" || /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value))
    ? value
    : undefined;
/** Restore only after the catalog loads. Removed IDs become All, preserving the
 * other filters and preventing an obsolete selection from returning later. */
export const viewCatalogId = (ids: readonly string[]) => (value: unknown) =>
  typeof value === "string" && value.length <= 160
    ? ids.includes(value)
      ? value
      : ""
    : undefined;
export type AttendanceView = {
  month: string;
  tutorId: string;
  showPast: boolean;
};
export const attendanceViewParser = (ids: readonly string[]) =>
  viewFields<AttendanceView>({
    month: viewMonth,
    tutorId: viewCatalogId(ids),
    showPast: viewBoolean,
  });
export type ReportView = {
  schoolYear: string;
  scope: "year" | "S1" | "S2" | "Q1" | "Q2" | "Q3" | "Q4";
  depth: "summary" | "detailed" | "full";
  maskPii: boolean;
};
export function reportViewParser(
  years: readonly string[],
  quarters: boolean,
  readOnly: boolean,
) {
  const parse = viewFields<ReportView>({
    schoolYear: viewCatalogId(years),
    scope: viewEnum(["year", "S1", "S2", "Q1", "Q2", "Q3", "Q4"]),
    depth: viewEnum(["summary", "detailed", "full"]),
    maskPii: viewBoolean,
  });
  return (value: unknown): ReportView | undefined => {
    const parsed = parse(value);
    return parsed
      ? {
          ...parsed,
          scope:
            !quarters && parsed.scope.startsWith("Q") ? "year" : parsed.scope,
          maskPii: readOnly || parsed.maskPii,
        }
      : undefined;
  };
}
export type MeetingView = { showPast: boolean; showSummary: boolean };
export const meetingViewParser = viewFields<MeetingView>({
  showPast: viewBoolean,
  showSummary: viewBoolean,
});
export const CREW_PANELS = ["review", "roster", "patrol"] as const;
export type CrewPanel = (typeof CREW_PANELS)[number];
export const crewPanelParser =
  (available: readonly CrewPanel[]) =>
  (value: unknown): CrewPanel | undefined => {
    const parsed = viewEnum(CREW_PANELS)(value);
    return parsed === undefined
      ? undefined
      : available.includes(parsed)
        ? parsed
        : (available[0] ?? "review");
  };
export const USER_VIEW_ROLES = [
  "STUDENT",
  "VIEWER",
  "TUTOR",
  "COORDINATOR",
  "ADMIN",
  "HEAD",
  "CREW",
  "TRANSLATOR",
  "__none__",
] as const;
export const USER_VIEW_STATUSES = [
  "ACTIVE",
  "PENDING",
  "GRADUATED",
  "OPTED_OUT",
  "ARCHIVED",
  "__none__",
] as const;
export const USER_VIEW_ACCOUNTS = [
  "registered",
  "setup",
  "invited",
  "none",
] as const;
export type UserDirectoryView = {
  roleInclude: string[];
  roleExclude: string[];
  statusInclude: string[];
  statusExclude: string[];
  accountInclude: string[];
  accountExclude: string[];
  showPastTutors: boolean;
  showUnverified: boolean;
  search: string;
};
const selections =
  (allowed: readonly string[]) =>
  (value: unknown): string[] | undefined =>
    Array.isArray(value) &&
    value.length <= 40 &&
    value.every((item) => typeof item === "string")
      ? [...new Set(value.filter((item) => allowed.includes(item)))]
      : undefined;
export const userDirectoryFilters = (view: UserDirectoryView): UserFilters =>
  normalizeUserFilters({
    role: { include: [...view.roleInclude], exclude: [...view.roleExclude] },
    status: {
      include: [...view.statusInclude],
      exclude: [...view.statusExclude],
    },
    account: {
      include: [...view.accountInclude],
      exclude: [...view.accountExclude],
    },
    showPastTutors: view.showPastTutors,
    showUnverified: view.showUnverified,
  });
export const userDirectoryView = (
  filters = emptyUserFilters(),
  search = "",
): UserDirectoryView => {
  const normalized = normalizeUserFilters(filters);
  return {
    roleInclude: [...normalized.role.include],
    roleExclude: [...normalized.role.exclude],
    statusInclude: [...normalized.status.include],
    statusExclude: [...normalized.status.exclude],
    accountInclude: [...normalized.account.include],
    accountExclude: [...normalized.account.exclude],
    showPastTutors: normalized.showPastTutors,
    showUnverified: normalized.showUnverified,
    search,
  };
};
const parseDirectory = viewFields<UserDirectoryView>({
  roleInclude: selections(USER_VIEW_ROLES),
  roleExclude: selections(USER_VIEW_ROLES),
  statusInclude: selections(USER_VIEW_STATUSES),
  statusExclude: selections(USER_VIEW_STATUSES),
  accountInclude: selections(USER_VIEW_ACCOUNTS),
  accountExclude: selections(USER_VIEW_ACCOUNTS),
  showPastTutors: viewBoolean,
  showUnverified: viewBoolean,
  search: viewSearch,
});
export const userDirectoryViewParser = (
  value: unknown,
): UserDirectoryView | undefined => {
  const parsed = parseDirectory(value);
  return parsed
    ? userDirectoryView(userDirectoryFilters(parsed), parsed.search)
    : undefined;
};
