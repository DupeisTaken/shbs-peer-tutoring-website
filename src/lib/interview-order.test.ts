import { describe, expect, it } from "vitest";
import { isOpenInterview, orderInterviews } from "./interview-order";

const row = (id: string, patch = {}) => ({
  id,
  status: "INTERVIEW",
  isInvalid: false,
  interviewAt: null as Date | null,
  decidedAt: null as Date | null,
  updatedAt: new Date("2026-10-01"),
  ...patch,
});
describe("interview work order", () => {
  it("orders overdue and scheduled work, unscheduled, paused, then newest terminal history without mutating input", () => {
    const rows = [
      row("old", { status: "ACCEPTED" }),
      row("unscheduled"),
      row("paused", { isInvalid: true, interviewAt: new Date("2025-01-01") }),
      row("later", { interviewAt: new Date("2027-01-01") }),
      row("overdue", { interviewAt: new Date("2026-01-01") }),
      row("recent", { status: "REJECTED", decidedAt: new Date("2026-10-03") }),
      row("recalled", {
        status: "RECALLED",
        updatedAt: new Date("2026-10-02"),
      }),
    ];
    const copy = [...rows];
    expect(orderInterviews(rows).map((r) => r.id)).toEqual([
      "overdue",
      "later",
      "unscheduled",
      "paused",
      "recent",
      "recalled",
      "old",
    ]);
    expect(rows).toEqual(copy);
    expect(orderInterviews(rows)[0]).toBe(rows[4]);
  });
  it("uses stable IDs for null/tied dates and distinguishes applied decisions from evidence", () => {
    const rows = [row("b"), row("a"), row("c", { status: "PENDING" })];
    expect(orderInterviews(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(isOpenInterview({ status: "INTERVIEW" })).toBe(true);
    expect(isOpenInterview({ status: "RECALLED" })).toBe(false);
    expect(orderInterviews([])).toEqual([]);
  });
});
