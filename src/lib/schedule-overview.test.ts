import { expect, it } from "vitest";
import { upcomingPreview } from "./schedule-overview";
it("prioritizes recent unresolved attendance and actions, then nearest events, deduplicated to three", () => {
  const row = (id: string, day: number, needsAction = false) => ({
    id,
    startsAt: new Date(2026, 9, day),
    sortAt: new Date(2026, 9, day),
    needsAction,
  });
  const values = [
    row("future-late", 30),
    row("old-attendance", 1, true),
    row("recent-attendance", 25, true),
    row("future-near", 28),
  ];
  expect(
    upcomingPreview([...values, values[2]!]).map((item) => item.id),
  ).toEqual(["recent-attendance", "old-attendance", "future-near"]);
});
it("retains unscheduled actionable work without inventing an event start", () => {
  expect(
    upcomingPreview([
      { id: "undated", startsAt: null, sortAt: new Date(), needsAction: true },
    ])[0]?.startsAt,
  ).toBeNull();
});
