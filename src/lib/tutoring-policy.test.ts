import { describe, expect, it } from "vitest";
import { isRegularTutoringPaused, isRegularTutoringPausedAt, tutoringPauseSemanticRanges } from "./tutoring-policy";

const pause = { date: "2026-11-09", endDate: "2026-11-13", schedulingEffect: "PAUSE_REGULAR" };
describe("tutoring-only pause policy", () => {
  it("matches both inclusive endpoints and actual dates, independently of school weekdays", () => {
    for (const date of ["2026-11-09", "2026-11-12", "2026-11-13"])
      expect(isRegularTutoringPaused(date, [pause])).toBe(true);
    for (const date of ["2026-11-08", "2026-11-14"])
      expect(isRegularTutoringPaused(date, [pause])).toBe(false);
  });
  it("requires an applied pause and retains independent overlapping sources", () => {
    const overlap = { ...pause, date: "2026-11-12", endDate: "2026-11-16" };
    expect(isRegularTutoringPaused("2026-11-13", [{ ...pause, active: false }, overlap])).toBe(true);
    expect(isRegularTutoringPaused("2026-11-10", [{ ...pause, active: false }, overlap])).toBe(false);
    for (const schedulingEffect of [undefined, "NOTICE"])
      expect(isRegularTutoringPaused("2026-11-12", [{ ...pause, schedulingEffect }])).toBe(false);
  });
  it("fingerprints semantic intervals without reasons, row order or informational notices", () => {
    const earlier = { ...pause, date: "2026-11-01", endDate: "2026-11-02" };
    expect(tutoringPauseSemanticRanges([pause, earlier, { ...pause, active: false }, { ...pause, schedulingEffect: "NOTICE" }]))
      .toEqual([["2026-11-01", "2026-11-02"], [pause.date, pause.endDate]]);
  });
  it("resolves history before endpoints and preserves the policy before later shrink/removal", () => {
    const opened = new Date("2026-11-01T00:00:00Z");
    const lesson = new Date("2026-11-12T07:50:00Z");
    const changed = new Date("2026-11-12T08:00:00Z");
    const revisions = [
      { ...pause, id: 1n, effectiveAt: opened },
      { ...pause, id: 2n, endDate: "2026-11-10", effectiveAt: changed },
      { ...pause, id: 3n, active: false, effectiveAt: new Date("2026-11-13T00:00:00Z") },
    ];
    expect(isRegularTutoringPausedAt("2026-11-12", lesson, revisions)).toBe(true);
    expect(isRegularTutoringPausedAt("2026-11-12", new Date("2026-11-12T09:00:00Z"), revisions)).toBe(false);
    expect(isRegularTutoringPausedAt("2026-11-12", new Date("2026-11-14T00:00:00Z"), revisions)).toBe(false);
    expect(isRegularTutoringPausedAt("2026-11-12", opened, revisions)).toBe(false);
  });
  it("keeps overlapping histories independent and orders same-clock revisions by durable ID", () => {
    const at = new Date("2026-11-01T00:00:00Z");
    const after = new Date("2026-11-02T00:00:00Z");
    const revisions = [
      { ...pause, id: 2n, active: false, effectiveAt: at },
      { ...pause, id: 1n, effectiveAt: at },
      { ...pause, date: "2026-11-10", id: 3n, effectiveAt: at },
    ];
    expect(isRegularTutoringPausedAt("2026-11-09", after, revisions)).toBe(false);
    expect(isRegularTutoringPausedAt("2026-11-12", after, revisions)).toBe(true);
  });
});
