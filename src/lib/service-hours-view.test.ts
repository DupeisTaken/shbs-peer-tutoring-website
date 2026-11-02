import { describe, expect, it } from "vitest";
import {
  initialServiceHoursView as defaults,
  selectServiceHoursRows,
  serviceHoursSubtotal,
  serviceHoursViewParser,
  type ServiceHoursRow,
} from "./service-hours-view";

const row = (
  tutorId: string,
  overrides: Partial<ServiceHoursRow> = {},
): ServiceHoursRow => ({
  tutorId,
  englishName: tutorId,
  active: true,
  sessions: 0,
  adjustmentCount: 0,
  earned: 0,
  extras: 0,
  punishments: 0,
  total: 0,
  ...overrides,
});
const rows = [
  row("No records"),
  row("Zero credit", { sessions: 1 }),
  row("Zero adjustment", { adjustmentCount: 1 }),
  row("Deduction", {
    active: false,
    adjustmentCount: 1,
    punishments: 2,
    total: -2,
  }),
  row("Offset", { sessions: 1, earned: 2, adjustmentCount: 1, punishments: 2 }),
  row("Positive", { active: false, sessions: 1, earned: 3, total: 3 }),
];
describe("service-hour roster presentation", () => {
  it("defaults to active members while retaining active members with no records", () => {
    expect(
      selectServiceHoursRows(rows, defaults, "en").map((r) => r.tutorId),
    ).toEqual(["No records", "Zero credit", "Zero adjustment", "Offset"]);
  });
  it("intersects status, evidence and trimmed case-insensitive name search", () => {
    expect(
      selectServiceHoursRows(
        rows,
        { ...defaults, activity: "records" },
        "en",
      ).map((r) => r.tutorId),
    ).toEqual(["Zero credit", "Zero adjustment", "Offset"]);
    expect(
      selectServiceHoursRows(
        rows,
        {
          ...defaults,
          status: "inactive",
          activity: "records",
          search: " DEDuc ",
        },
        "en",
      ).map((r) => r.tutorId),
    ).toEqual(["Deduction"]);
    expect(
      selectServiceHoursRows(
        rows,
        { ...defaults, status: "all", activity: "none" },
        "en",
      ).map((r) => r.tutorId),
    ).toEqual(["No records"]);
  });
  it("returns no matches separately from the full roster and retains complete accounting", () => {
    const selected = selectServiceHoursRows(
      rows,
      { ...defaults, search: "missing" },
      "en",
    );
    expect(selected).toEqual([]);
    expect(serviceHoursSubtotal(selected)).toEqual({
      earned: 0,
      extras: 0,
      punishments: 0,
      total: 0,
    });
    expect(serviceHoursSubtotal(rows)).toEqual({
      earned: 5,
      extras: 0,
      punishments: 4,
      total: 1,
    });
  });
  it("sorts signed numbers, keeps same-name identities and preserves order across views", () => {
    const source = [
      row("one", { englishName: "Same", total: 2 }),
      row("two", { englishName: "Same", total: -1 }),
    ];
    const view = {
      ...defaults,
      sortKey: "total" as const,
      sortDir: "asc" as const,
    };
    expect(
      selectServiceHoursRows(source, view, "en").map((r) => r.tutorId),
    ).toEqual(["two", "one"]);
    expect(
      selectServiceHoursRows(source, { ...view, panel: "breakdown" }, "en"),
    ).toEqual(selectServiceHoursRows(source, view, "en"));
    expect(source.map((r) => r.tutorId)).toEqual(["one", "two"]);
  });
  it("restores only allowlisted presentation state and strips unrelated fields", () => {
    expect(
      serviceHoursViewParser({ ...defaults, status: "all", record: "private" }),
    ).toEqual({ ...defaults, status: "all" });
    expect(
      serviceHoursViewParser({ ...defaults, status: "ARCHIVED" }),
    ).toBeUndefined();
    expect(
      serviceHoursViewParser({ ...defaults, sortKey: "credential" }),
    ).toBeUndefined();
  });
});
