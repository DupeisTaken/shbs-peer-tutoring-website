import assert from "node:assert/strict";
import test from "node:test";
import { addPlanningDays, plannedWindow, planningWeeks, resolvePlanningCalendarDay, responseDeadline, RESPONSE_WINDOW_MS, type PlanningTime } from "../../src/lib/session-planning";
import type { SchoolCalendarOverride } from "../../src/lib/school-calendar";
import { proposalSourceAfter } from "./scenarios";

const timeZone = "Asia/Shanghai";

/** Model publication's actual prepared date range and calendar decisions, not
 * a fabricated list of future Mondays. No application or database is started. */
function publicationModel(anchor: Date, additionalOverrides: SchoolCalendarOverride[] = []) {
  const weeks = planningWeeks(anchor, timeZone);
  const monday = addPlanningDays(weeks.start, 7);
  const overrides = [
    { date: addPlanningDays(monday, 5), isSchoolDay: true, timetableWeekday: 3 },
    { date: addPlanningDays(monday, 10), isSchoolDay: false },
    ...additionalOverrides,
  ];
  const sources: ReturnType<typeof plannedWindow>[] = [];
  for (let date = weeks.start; date <= weeks.prepareEnd; date = addPlanningDays(date, 1)) {
    const day = resolvePlanningCalendarDay(date, overrides);
    if (day.isSchoolDay && day.effectiveTimetableWeekday === 1) {
      sources.push(plannedWindow({ date, startMin: 900, online: false }, timeZone));
    }
  }
  const target = { date: addPlanningDays(monday, 1), startMin: 1080, online: true };
  const select = (label: string) => {
    const after = proposalSourceAfter(label, anchor, target, anchor);
    // The scenario's findFirstOrThrow has this strict bound and startsAt/id order.
    const selected = sources.find((source) => source.startsAt > after);
    assert.ok(selected, "No eligible source exists in the prepared publication window.");
    return selected;
  };
  const cutoff = (source: (typeof sources)[number]) => new Date(Math.min(
    source.startsAt.getTime(), plannedWindow(target, timeZone).startsAt.getTime(),
  ));
  return { weeks, sources, target, select, cutoff };
}

for (const [instant, expectedPrepared, expectedOld, expectedDeadlineSource] of [
  ["2026-11-02T06:59:59.000Z", ["2026-11-02", "2026-11-09"], "2026-11-02", "2026-11-09"],
  ["2026-11-02T07:00:00.001Z", ["2026-11-02", "2026-11-09"], "2026-11-09", "2026-11-09"],
  ["2026-11-08T06:59:59.999Z", ["2026-11-02", "2026-11-09", "2026-11-16"], "2026-11-09", "2026-11-09"],
  ["2026-11-08T07:00:00.000Z", ["2026-11-02", "2026-11-09", "2026-11-16"], "2026-11-09", "2026-11-16"],
  ["2026-11-08T07:00:00.001Z", ["2026-11-02", "2026-11-09", "2026-11-16"], "2026-11-09", "2026-11-16"],
  ["2026-11-08T15:59:59.999Z", ["2026-11-02", "2026-11-09", "2026-11-16"], "2026-11-09", "2026-11-16"],
  ["2026-11-08T16:00:00.000Z", ["2026-11-09", "2026-11-16"], "2026-11-09", "2026-11-16"],
] as const) {
  void test(`deadline-only source preserves a full response window at ${instant}`, () => {
    const anchor = new Date(instant);
    const model = publicationModel(anchor);
    assert.deepEqual(model.sources.map((source) => source.date), expectedPrepared);
    const ordinary = model.select("propose-one");
    assert.equal(ordinary.date, expectedOld);
    const selected = model.select("propose-deadline");
    assert.equal(selected.date, expectedDeadlineSource);
    const deadline = responseDeadline(anchor, model.cutoff(selected));
    assert.ok(deadline);
    assert.equal(deadline.getTime(), anchor.getTime() + RESPONSE_WINDOW_MS);
    assert.ok(deadline < model.cutoff(selected));
    if (ordinary.date !== selected.date) assert.equal(responseDeadline(anchor, model.cutoff(ordinary)), null);
  });
}

void test("deadline source respects a closed Monday and never fabricates a later unprepared occurrence", () => {
  const monday = publicationModel(new Date("2026-11-02T06:00:00Z"), [
    { date: "2026-11-02", isSchoolDay: false },
  ]);
  assert.deepEqual(monday.sources.map((source) => source.date), ["2026-11-09"]);
  assert.equal(monday.select("propose-deadline").date, "2026-11-09");
  const sunday = publicationModel(new Date("2026-11-08T08:00:00Z"), [
    { date: "2026-11-16", isSchoolDay: false },
  ]);
  assert.deepEqual(sunday.sources.map((source) => source.date), ["2026-11-02", "2026-11-09"]);
  assert.throws(() => sunday.select("propose-deadline"), /No eligible source/);
  assert.equal(sunday.select("contention-pending-room").date, "2026-11-09");
});

void test("target conversion rejects a short or exactly equal cutoff rather than shortening the response window", () => {
  const anchor = new Date("2026-11-08T07:00:00Z");
  for (const startMin of [899, 900]) {
    const target = { date: "2026-11-09", startMin, online: true };
    assert.throws(() => proposalSourceAfter("propose-deadline", anchor, target, anchor), /complete response window/);
    assert.equal(responseDeadline(anchor, plannedWindow(target, timeZone).startsAt), null);
  }
  const later = { date: "2026-11-09", startMin: 901, online: true };
  assert.equal(proposalSourceAfter("propose-deadline", anchor, later, anchor).toISOString(), "2026-11-09T07:00:00.000Z");
  assert.equal(responseDeadline(anchor, plannedWindow(later, timeZone).startsAt)?.toISOString(), "2026-11-09T07:00:00.000Z");
});

void test("all other proposal labels retain their supplied real wall clock and production validation", () => {
  const anchor = new Date("2026-11-08T08:00:00Z");
  const wall = new Date("2026-11-08T08:12:34Z");
  // This invalid target must still reach the existing measured production validation.
  const invalidTarget: PlanningTime = { date: "invalid", startMin: -1, online: true };
  for (const label of ["propose-one", "propose-all", "propose-extra", "warm-pending-offer", "contention-pending-room"]) {
    assert.equal(proposalSourceAfter(label, anchor, invalidTarget, wall), wall);
  }
});

void test("the deadline-only source is stable across delayed paired arms without replacing their real clocks", () => {
  const anchor = new Date("2026-11-08T06:50:00Z");
  const model = publicationModel(anchor);
  const beforeWall = new Date("2026-11-08T06:55:00Z");
  const afterWall = new Date("2026-11-08T07:05:00Z");
  const firstBound = proposalSourceAfter("propose-deadline", anchor, model.target, beforeWall);
  const secondBound = proposalSourceAfter("propose-deadline", anchor, model.target, afterWall);
  assert.equal(firstBound.toISOString(), "2026-11-09T06:50:00.000Z");
  assert.equal(firstBound.getTime(), secondBound.getTime());
  const before = model.sources.find((source) => source.startsAt > firstBound);
  const after = model.sources.find((source) => source.startsAt > secondBound);
  assert.ok(before && after);
  assert.equal(before.date, "2026-11-09");
  assert.equal(after, before);
  assert.equal(responseDeadline(anchor, model.cutoff(after))?.toISOString(), firstBound.toISOString());
  assert.equal(proposalSourceAfter("propose-one", anchor, model.target, beforeWall), beforeWall);
  assert.equal(proposalSourceAfter("propose-one", anchor, model.target, afterWall), afterWall);
});
