import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchoolCalendarOverride } from "~/lib/school-calendar";
import * as programTime from "~/lib/program-time";
import { getProgramTimeZone } from "~/server/program/time-zone";
import type { TransactionDb } from "~/server/transactions";
import {
  assertDatedRoomBlackoutAvailable,
  datedUnavailableRooms,
} from "./room-occupancy";

vi.mock("~/server/program/time-zone", () => ({
  getProgramTimeZone: vi.fn().mockResolvedValue("Asia/Shanghai"),
}));

beforeEach(() => {
  vi.mocked(getProgramTimeZone).mockResolvedValue("Asia/Shanghai");
});
afterEach(() => vi.restoreAllMocks());

const now = new Date("2026-10-26T00:00:00Z");
const schedule = {
  termId: "term",
  dayOfWeek: 1,
  startMin: 900,
  endMin: 945,
};
const booking = (roomId = "room", date = "2026-11-02") => ({
  roomId,
  date,
  startMin: 900,
  endMin: 945,
  participants: [{ id: "participant" }],
  plan: { originalDate: date, assignments: [] as { pairingId: string }[] },
});
const offer = (id: string, startMin = 900) => ({
  id,
  roomId: "room",
  date: "2026-11-02",
  startMin,
  endMin: startMin + 45,
  cutoffAt: new Date("2026-11-02T07:00:00Z"),
});
type Request = {
  currentOfferId: string | null;
  offers: ReturnType<typeof offer>[];
};

function fixture({
  calendar = [],
  cohorts = [],
  requests = [],
  term = { startDate: null, endDate: null },
}: {
  calendar?: SchoolCalendarOverride[];
  cohorts?: ReturnType<typeof booking>[];
  requests?: Request[];
  term?: { startDate: Date | null; endDate: Date | null };
} = {}) {
  const raw = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    schoolCalendarDay: { findMany: vi.fn().mockResolvedValue(calendar) },
    term: { findUniqueOrThrow: vi.fn().mockResolvedValue(term) },
    sessionPlanCohort: { findMany: vi.fn().mockResolvedValue(cohorts) },
    sessionPlanningRequest: { findMany: vi.fn().mockResolvedValue(requests) },
  };
  return { raw, db: raw as unknown as TransactionDb };
}

describe("dated recurring room availability", () => {
  it("uses mapped weekdays, reset defaults and inclusive program-zone term bounds", async () => {
    const dates = [
      "2026-11-07",
      "2026-11-02",
      "2026-11-09",
      "2026-10-26",
      "2026-11-16",
      "2026-11-23",
    ];
    const { db } = fixture({
      calendar: [
        { date: "2026-11-07", isSchoolDay: true, timetableWeekday: 1 },
        {
          date: "2026-11-02",
          isSchoolDay: false,
          active: false,
          scheduleRevision: 4,
        },
        { date: "2026-11-09", isSchoolDay: false },
      ],
      cohorts: dates.map((date) => booking(date, date)),
      // UTC dates differ from the authoritative Shanghai date labels.
      term: {
        startDate: new Date("2026-11-01T16:00:00Z"),
        endDate: new Date("2026-11-16T15:59:59Z"),
      },
    });
    const bounds = vi.spyOn(programTime, "programDateKey");
    expect(await datedUnavailableRooms(db, schedule, dates, now)).toEqual(
      new Set(["2026-11-07", "2026-11-02", "2026-11-16"]),
    );
    expect(bounds).toHaveBeenCalledTimes(2);
  });

  it("reads changed calendar and term facts in a new operation", async () => {
    const day: SchoolCalendarOverride = { date: "2026-11-02", isSchoolDay: true };
    const term = { startDate: null, endDate: new Date("2026-11-03T00:00:00Z") };
    const { db } = fixture({ calendar: [day], term, cohorts: [booking()] });
    expect(await datedUnavailableRooms(db, schedule, ["room"], now)).toEqual(
      new Set(["room"]),
    );
    day.isSchoolDay = false;
    expect(await datedUnavailableRooms(db, schedule, ["room"], now)).toEqual(
      new Set(),
    );
    day.isSchoolDay = true;
    term.endDate = new Date("2026-11-01T00:00:00Z");
    expect(await datedUnavailableRooms(db, schedule, ["room"], now)).toEqual(
      new Set(),
    );
  });

  it("preserves own-unit exclusions, strict adjacency and only current pending offers", async () => {
    const own = booking("own");
    own.plan.assignments = [{ pairingId: "selected" }, { pairingId: "sibling" }];
    const moved = booking("moved");
    moved.plan.originalDate = "2026-10-26";
    moved.plan.assignments = [{ pairingId: "selected" }];
    const adjacent = { ...booking("adjacent"), startMin: 945, endMin: 990 };
    const { db } = fixture({
      cohorts: [own, moved, adjacent, { ...booking("empty"), participants: [] }],
      requests: [
        {
          currentOfferId: "current",
          offers: [offer("obsolete"), offer("current", 945)],
        },
      ],
    });
    expect(
      await datedUnavailableRooms(
        db,
        { ...schedule, excludePairingId: "selected" },
        ["own", "moved", "adjacent", "empty", "room"],
        now,
      ),
    ).toEqual(new Set(["moved"]));
    const { db: held } = fixture({
      requests: [
        {
          currentOfferId: "current",
          offers: [offer("obsolete", 945), offer("current")],
        },
      ],
    });
    expect(await datedUnavailableRooms(held, schedule, ["room"], now)).toEqual(
      new Set(["room"]),
    );
  });

  it("retains lazy term-boundary errors when no reservation reaches that comparison", async () => {
    const { db, raw } = fixture({
      term: { startDate: new Date(NaN), endDate: new Date(NaN) },
      cohorts: [{ ...booking(), startMin: 945, endMin: 990 }],
    });
    expect(await datedUnavailableRooms(db, schedule, ["room"], now)).toEqual(
      new Set(),
    );
    raw.sessionPlanCohort.findMany.mockResolvedValue([booking()]);
    await expect(
      datedUnavailableRooms(db, schedule, ["room"], now),
    ).rejects.toThrow(RangeError);
  });

  it.each(["cohorts", "requests"] as const)(
    "keeps the 5001-row %s guard and exact query caps",
    async (collection) => {
      const { db, raw } = fixture();
      if (collection === "cohorts") {
        raw.sessionPlanCohort.findMany.mockResolvedValue(
          Array.from({ length: 5001 }, () => booking()),
        );
      } else {
        raw.sessionPlanningRequest.findMany.mockResolvedValue(
          Array.from({ length: 5001 }, () => ({ currentOfferId: null, offers: [] })),
        );
      }
      await expect(
        datedUnavailableRooms(db, schedule, ["room"], now),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Too many dated room bookings to safely review this change.",
      });
      expect(raw.sessionPlanCohort.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5001 }),
      );
      expect(raw.sessionPlanningRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5001 }),
      );
    },
  );
});

describe("dated physical blackout guard", () => {
  it("keeps civil weekdays and holiday extras independent of school calendar mappings", async () => {
    const { db, raw } = fixture({
      calendar: [{ date: "2026-11-07", isSchoolDay: false }],
      cohorts: [booking("room", "2026-11-07")],
    });
    await expect(
      assertDatedRoomBlackoutAvailable(
        db,
        { roomId: "room", dayOfWeek: 6, startMin: 900, endMin: 945 },
        now,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      assertDatedRoomBlackoutAvailable(
        db,
        { roomId: "room", dayOfWeek: 6, startMin: 945, endMin: 990 },
        now,
      ),
    ).resolves.toBeUndefined();
    expect(raw.schoolCalendarDay.findMany).not.toHaveBeenCalled();
  });
});
