import { describe, expect, it } from "vitest";
import { findTutorScheduleConflict, plannedIntervalsOverlap } from "./planned-scheduling";

const candidate = { tutorId: "tutor", termId: "term", scheduleConfirmed: true,
  dayOfWeek: 1, startMin: 600, endMin: 660 };
const booked = { ...candidate, id: "other", timeSlotId: null };

describe("copied planned tutor intervals", () => {
  it.each([[600, 660], [630, 690], [570, 630], [590, 670]])(
    "rejects overlap %i–%i independently of catalog linkage", (startMin, endMin) => {
      expect(findTutorScheduleConflict(candidate, [{ ...booked, startMin, endMin }])).toBeDefined();
    });
  it.each([[540, 600], [660, 720]])("allows adjacency %i–%i", (startMin, endMin) => {
    expect(plannedIntervalsOverlap(candidate, { ...booked, startMin, endMin })).toBe(false);
  });
  it("ignores unconfirmed placeholders, other weekdays, tutors and periods", () => {
    for (const change of [{ scheduleConfirmed: false }, { dayOfWeek: 2 },
      { tutorId: "different" }, { termId: "past" }]) {
      expect(findTutorScheduleConflict(candidate, [{ ...booked, ...change }])).toBeUndefined();
    }
    expect(findTutorScheduleConflict({ ...candidate, scheduleConfirmed: false }, [booked])).toBeUndefined();
  });
  it("excludes exactly the current unit and retains an independent equal-time conflict", () => {
    expect(findTutorScheduleConflict(candidate, [booked], ["other"])).toBeUndefined();
    expect(findTutorScheduleConflict(candidate, [booked, { ...booked, id: "independent" }], ["other"])?.id)
      .toBe("independent");
  });
});
