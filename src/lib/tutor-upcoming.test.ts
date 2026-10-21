import { describe, expect, it } from "vitest";
import {
  tutorUpcoming,
  type UpcomingPairing,
  type UpcomingInterview,
} from "./tutor-upcoming";

const pairing = (fields: Partial<UpcomingPairing> = {}): UpcomingPairing => ({
  id: "pairing",
  dayOfWeek: 7,
  startMin: 900,
  endMin: 960,
  scheduleConfirmed: true,
  subject: "Mathematics",
  room: null,
  tutees: [{ tuteeId: "student" }],
  ...fields,
});
const interview = (
  fields: Partial<UpcomingInterview> = {},
): UpcomingInterview => ({
  id: "applicant",
  name: "Synthetic Applicant",
  status: "INTERVIEW",
  isInvalid: false,
  interviewAt: new Date("2026-10-18T08:00:00Z"),
  ...fields,
});
const project = (
  pairings: UpcomingPairing[] = [],
  interviews: UpcomingInterview[] = [],
  now = new Date("2026-10-18T07:30:00Z"),
  timeZone = "Asia/Shanghai",
) => tutorUpcoming({ pairings, interviews, now, timeZone });

describe("personal seven-program-date projection", () => {
  it("retains ongoing confirmed sessions until their end and never promotes defaults or empty assignments", () => {
    const input = [
      pairing(),
      pairing({ id: "default", scheduleConfirmed: false }),
      pairing({ id: "empty", tutees: [] }),
    ];
    expect(project(input).events.map((e) => e.id)).toEqual([
      "session:pairing:2026-10-18",
    ]);
    expect(project(input, [], new Date("2026-10-18T08:00:00Z")).events).toEqual(
      [],
    );
    expect(input[1]!.scheduleConfirmed).toBe(false);
  });
  it("uses today plus six calendar dates, retaining the final date and excluding date eight", () => {
    const events = project(
      [],
      [
        interview({
          id: "last",
          interviewAt: new Date("2026-10-24T15:59:00Z"),
        }),
        interview({
          id: "outside",
          interviewAt: new Date("2026-10-24T16:00:00Z"),
        }),
        interview({
          id: "elapsed",
          interviewAt: new Date("2026-10-18T07:29:59Z"),
        }),
        interview({ id: "now", interviewAt: new Date("2026-10-18T07:30:00Z") }),
      ],
    ).events;
    expect(events.map((e) => e.id)).toEqual([
      "interview:now",
      "interview:last",
    ]);
    expect(events.every((e) => e.end === null && e.room === null)).toBe(true);
  });
  it("filters unscheduled, invalid, recalled and finalized records while retaining both open states", () => {
    const applications = [
      "PENDING",
      "INTERVIEW",
      "RECALLED",
      "ACCEPTED",
      "REJECTED",
    ].map((status) => interview({ id: status, status }));
    applications.push(
      interview({ id: "invalid", isInvalid: true }),
      interview({ id: "unscheduled", interviewAt: null }),
    );
    expect(project([], applications).events.map((e) => e.id)).toEqual([
      "interview:INTERVIEW",
      "interview:PENDING",
    ]);
  });
  it("groups coherent plans once, flags divergent groups and orders equal instants by stable identity", () => {
    const common = { groupId: "group", group: { primaryPairingId: "p1" } };
    const pairings = [
      pairing({ ...common, id: "p2", subject: "Physics" }),
      pairing({ ...common, id: "p1" }),
    ];
    const events = project(
      pairings,
      [
        interview({ id: "b", interviewAt: new Date("2026-10-18T07:00:00Z") }),
        interview({ id: "a" }),
        interview({ id: "a" }),
      ],
      new Date("2026-10-18T06:00:00Z"),
    ).events;
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({
      id: "session:group:2026-10-18",
      count: 2,
      label: "Mathematics / Physics",
    });
    expect(
      project([...pairings].reverse(), [], new Date("2026-10-18T06:00:00Z"))
        .events,
    ).toEqual(project(pairings, [], new Date("2026-10-18T06:00:00Z")).events);
    const divergent = project([
      pairings[0]!,
      { ...pairings[1]!, startMin: 960, endMin: 1020 },
    ]);
    expect(divergent.events).toEqual([]);
    expect(divergent.groupsNeedingRepair).toBe(1);
  });
  it("keeps unscheduled groups out of appointments and never hides an empty member before validating coverage", () => {
    const common = { groupId: "group", group: { primaryPairingId: "p1" } };
    const members = [
      pairing({ ...common, id: "p1" }),
      pairing({ ...common, id: "p2", subject: "Physics" }),
    ];
    const waiting = project(members.map((p) => ({ ...p, scheduleConfirmed: false })));
    expect(waiting.events).toEqual([]);
    expect(waiting.groupsNeedingRepair).toBe(0);
    const invalid = project([members[0]!, { ...members[1]!, tutees: [] }]);
    expect(invalid.events).toEqual([]);
    expect(invalid.groupsNeedingRepair).toBe(1);
  });
  it("reprojects reschedules, panel removal and replaced active-period lists without retained commitments", () => {
    expect(project([pairing()], [interview()]).events).toHaveLength(2);
    expect(
      project(
        [],
        [interview({ interviewAt: new Date("2026-10-25T08:00:00Z") })],
      ).events,
    ).toEqual([]);
    expect(project([], []).events).toEqual([]);
  });
  it("handles 24:00 and a DST horizon without adding 168 elapsed hours", () => {
    const now = new Date("2026-10-31T16:00:00Z");
    const result = project(
      [pairing({ dayOfWeek: 6, startMin: 1380, endMin: 1440 })],
      [
        interview({
          id: "last",
          interviewAt: new Date("2026-11-07T04:59:00Z"),
        }),
        interview({
          id: "next",
          interviewAt: new Date("2026-11-07T05:00:00Z"),
        }),
      ],
      now,
      "America/New_York",
    );
    expect(result.events.map((e) => e.id)).toEqual([
      "session:pairing:2026-10-31",
      "interview:last",
    ]);
    expect(result.events[0]!.end?.toISOString()).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });
  it.each([
    ["2026-11-01T04:00:00Z", 90, 150],
    ["2026-03-08T05:00:00Z", 150, 210],
  ])(
    "surfaces nonunique DST wall clocks without inventing an instant (%s)",
    (now, startMin, endMin) => {
      const result = project(
        [pairing({ startMin, endMin })],
        [],
        new Date(now),
        "America/New_York",
      );
      expect(result.events).toEqual([]);
      expect(result.unresolvedTimes).toBe(1);
    },
  );
});
