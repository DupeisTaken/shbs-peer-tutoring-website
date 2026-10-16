import { describe, expect, it } from "vitest";
import {
  attendanceViewParser,
  reportViewParser,
  crewPanelParser,
  meetingViewParser,
  userDirectoryView,
  userDirectoryViewParser,
  userDirectoryFilters,
  viewMonth,
} from "./management-view-state";
import { emptyUserFilters, matchesUserFilters } from "./user-filters";

describe("management presentation allowlists", () => {
  it("keeps cleared month semantics and rejects invalid calendar input", () => {
    expect(viewMonth("")).toBe("");
    expect(viewMonth("2026-01")).toBe("2026-01");
    for (const value of [
      "0000-01",
      "2026-00",
      "2026-13",
      "2026-1",
      "2026-10-14",
      {},
      false,
    ])
      expect(viewMonth(value)).toBeUndefined();
  });
  it("drops removed tutor IDs without losing month or visibility and never copies record fields", () => {
    const input = {
      month: "2026-08",
      tutorId: "old",
      showPast: true,
      correctionNote: "private",
      expectedUpdatedAt: "version",
    };
    expect(attendanceViewParser(["new"])(input)).toEqual({
      month: "2026-08",
      tutorId: "",
      showPast: true,
    });
    expect(attendanceViewParser(["old"])(input)?.tutorId).toBe("old");
    expect(attendanceViewParser([])({ ...input, tutorId: {} })).toBeUndefined();
  });
  it("normalizes obsolete report years and disabled quarters while enforcing observer masking", () => {
    const input = {
      schoolYear: "old-year",
      scope: "Q3",
      depth: "full",
      maskPii: false,
      reportRows: [],
    };
    expect(reportViewParser(["2026-27"], false, true)(input)).toEqual({
      schoolYear: "",
      scope: "year",
      depth: "full",
      maskPii: true,
    });
    expect(reportViewParser(["old-year"], true, false)(input)).toEqual({
      schoolYear: "old-year",
      scope: "Q3",
      depth: "full",
      maskPii: false,
    });
    expect(
      reportViewParser([], true, false)({ ...input, scope: "removed" }),
    ).toBeUndefined();
  });
  it("normalizes unavailable crew panels and excludes meeting editor state", () => {
    expect(crewPanelParser(["roster"])("patrol")).toBe("roster");
    expect(crewPanelParser(["review", "patrol"])("patrol")).toBe("patrol");
    expect(crewPanelParser(["review"])("bad")).toBeUndefined();
    expect(
      meetingViewParser({
        showPast: true,
        showSummary: true,
        selected: "private",
        attendanceDraft: [],
      }),
    ).toEqual({ showPast: true, showSummary: true });
  });
  it("retains filter semantics, removes obsolete options and clears hidden status on restore", () => {
    const filters = emptyUserFilters();
    filters.role.include = ["TUTOR"];
    filters.status.include = ["ACTIVE"];
    filters.account.exclude = ["none"];
    const restored = userDirectoryViewParser({
      ...userDirectoryView(filters, "handle"),
      roleInclude: ["TUTOR", "TUTOR", "REMOVED"],
      password: "private",
    })!;
    expect(restored.roleInclude).toEqual(["TUTOR"]);
    expect(restored.statusInclude).toEqual(["ACTIVE"]);
    expect(restored).not.toHaveProperty("password");
    const mixed = userDirectoryViewParser({
      ...restored,
      roleInclude: ["TUTOR", "ADMIN"],
    })!;
    expect(mixed.statusInclude).toEqual([]);
    expect(userDirectoryFilters(restored)).toEqual(filters);
    expect(
      matchesUserFilters(
        { role: "TUTOR", tutorStatus: "ACTIVE", account: "none" },
        userDirectoryFilters(restored),
      ),
    ).toBe(false);
    const long = "a".repeat(5000);
    expect(userDirectoryViewParser({ ...restored, search: long })).toEqual({
      ...restored,
      search: long,
    });
    expect(
      userDirectoryViewParser({ ...restored, roleExclude: [42] }),
    ).toBeUndefined();
  });
});
