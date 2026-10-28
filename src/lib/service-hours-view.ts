import { viewEnum, viewFields, viewSearch } from "./session-view-state";

export type ServiceHoursRow = {
  tutorId: string;
  englishName: string;
  active: boolean;
  sessions: number;
  adjustmentCount: number;
  earned: number;
  extras: number;
  punishments: number;
  total: number;
};
export const HOURS_SORT_KEYS = [
  "englishName",
  "sessions",
  "earned",
  "extras",
  "punishments",
  "total",
] as const;
export type HoursSortKey = (typeof HOURS_SORT_KEYS)[number];
export type ServiceHoursView = {
  status: "active" | "inactive" | "all";
  activity: "all" | "records" | "none";
  search: string;
  panel: "summary" | "breakdown";
  sortKey: HoursSortKey;
  sortDir: "asc" | "desc" | "none";
};
export const initialServiceHoursView: ServiceHoursView = {
  status: "active",
  activity: "all",
  search: "",
  panel: "summary",
  sortKey: "englishName",
  sortDir: "none",
};
export const serviceHoursViewParser = viewFields<ServiceHoursView>({
  status: viewEnum(["active", "inactive", "all"]),
  activity: viewEnum(["all", "records", "none"]),
  search: viewSearch,
  panel: viewEnum(["summary", "breakdown"]),
  sortKey: viewEnum(HOURS_SORT_KEYS),
  sortDir: viewEnum(["asc", "desc", "none"]),
});

/** Record evidence includes zero-credit sessions and zero-valued adjustments.
 * Net hours alone cannot distinguish inactivity from offsets or deductions. */
export const hasServiceHoursRecords = (row: ServiceHoursRow) =>
  row.sessions > 0 || row.adjustmentCount > 0;

export function selectServiceHoursRows(
  rows: readonly ServiceHoursRow[],
  view: ServiceHoursView,
  locale: string,
) {
  const query = view.search.trim().toLocaleLowerCase(locale);
  const selected = rows.filter((row) => {
    if (view.status !== "all" && row.active !== (view.status === "active"))
      return false;
    if (
      view.activity !== "all" &&
      hasServiceHoursRecords(row) !== (view.activity === "records")
    )
      return false;
    return !query || row.englishName.toLocaleLowerCase(locale).includes(query);
  });
  if (view.sortDir === "none") return selected;
  // Stable sorting preserves distinct IDs, including people sharing a name.
  return selected.sort((a, b) => {
    const first = a[view.sortKey];
    const second = b[view.sortKey];
    const comparison =
      typeof first === "number" && typeof second === "number"
        ? first - second
        : String(first).localeCompare(String(second), locale, {
            numeric: true,
            sensitivity: "base",
          });
    return comparison * (view.sortDir === "asc" ? 1 : -1);
  });
}

export function serviceHoursSubtotal(rows: readonly ServiceHoursRow[]) {
  return rows.reduce(
    (sum, row) => ({
      earned: sum.earned + row.earned,
      extras: sum.extras + row.extras,
      punishments: sum.punishments + row.punishments,
      total: sum.total + row.total,
    }),
    { earned: 0, extras: 0, punishments: 0, total: 0 },
  );
}
