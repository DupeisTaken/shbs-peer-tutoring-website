import { describe, expect, it, vi } from "vitest";
import type { DomainDb } from "~/server/transactions";
import {
  queueEventReminders,
  reminderIsDue,
  reminderKey,
  validateEventReminder,
} from "./event-reminders";

vi.mock("~/server/db", () => ({ db: {} }));

const start = new Date("2026-10-28T07:30:00.000Z");
const hourBefore = new Date(start.getTime() - 3_600_000);
type Delivery = {
  destination: string;
  userId: string;
  recipient: string;
  event: string;
  context: Record<string, unknown>;
  reminderKey: string;
  status: string;
  leaseUntil: Date | null;
};

function fixture(kind: "meeting" | "interview" | "tutoring" = "meeting") {
  const settings = {
    emailNotificationsEnabled: true,
    timeZone: "Asia/Shanghai",
  };
  const features: {
    key: string;
    enabled: boolean;
    pendingEnabled: boolean | null;
  }[] = [];
  const user = {
    id: "user",
    email: "recipient@example.test",
    emailEventReminders: true,
    emailSecondaryRecipients: false,
    role: "TUTOR",
    suspendedAt: null,
    mergedIntoId: null,
    schoolDeparture: null,
    tutorAccessRevoked: false,
    tutorId: "tutor",
    tutor: { status: "ACTIVE", englishName: "Alice Tutor" },
    emails: [
      { email: "recipient@example.test", verifiedAt: new Date() },
      { email: "secondary@example.test", verifiedAt: new Date() },
    ],
  };
  const meeting = { id: "meeting", title: "Team meeting", date: start };
  const interview = {
    id: "interview",
    name: "Alex Applicant",
    status: "INTERVIEW",
    interviewAt: start,
    invalidatedAt: null as Date | null,
    interviewCompletedAt: null as Date | null,
    requestedTutorId: "applicant",
    interviewers: [{ tutorId: "tutor" }],
  };
  const pairing = {
    id: "pairing",
    groupId: null as string | null,
    subject: "Mathematics",
    scheduleConfirmed: true,
    tutorId: "tutor",
    tutor: { status: "ACTIVE", englishName: "Alice Tutor" },
    termId: "term",
    term: {
      active: true,
      startDate: null as Date | null,
      endDate: null as Date | null,
    },
    dayOfWeek: 3,
    startMin: 930,
    endMin: 990,
    roomId: "room",
    room: { name: "Room A" },
    tutees: [
      {
        tuteeId: "student",
        tutee: {
          id: "student",
          englishName: "Emma Tutee",
          status: "ACTIVE",
          user: { id: "student-user" },
        },
      },
    ],
  };
  const rows = new Map<string, Delivery>();
  const state = {
    sourceExists: true,
    eligible: true,
    holiday: false,
    noTutoring: false,
    absent: false,
  };
  const client = {
    programFeature: { findMany: vi.fn(async () => features) },
    programSettings: { findUnique: vi.fn(async () => settings) },
    user: {
      findMany: vi.fn(async () => (state.eligible ? [user] : [])),
      findFirst: vi.fn(async () => (state.eligible ? user : null)),
    },
    tutorMeeting: {
      findMany: vi.fn(async () => (kind === "meeting" ? [meeting] : [])),
      findUnique: vi.fn(async () => (state.sourceExists ? meeting : null)),
    },
    tutorApplication: {
      findMany: vi.fn(async () => (kind === "interview" ? [interview] : [])),
      findUnique: vi.fn(async () => (state.sourceExists ? interview : null)),
    },
    pairing: {
      findMany: vi.fn(
        async (args: { include?: unknown; where: { dayOfWeek?: number } }) =>
          kind !== "tutoring" || !state.sourceExists
            ? []
            : args.include
              ? [pairing]
              : args.where.dayOfWeek === pairing.dayOfWeek
                ? [pairing]
                : [],
      ),
    },
    schoolCalendarDay: {
      findUnique: vi.fn(async () =>
        state.holiday ? { isSchoolDay: false } : null,
      ),
    },
    programCalendarDay: {
      count: vi.fn(async () => (state.noTutoring ? 1 : 0)),
    },
    session: { count: vi.fn(async () => (state.absent ? 1 : 0)) },
    studentProfileOwnership: {
      findMany: vi.fn(async () => [{ userId: "retained-owner" }]),
    },
    emailDelivery: {
      createMany: vi.fn(async ({ data }: { data: Delivery[] }) => {
        let count = 0;
        for (const item of data)
          if (!rows.has(item.reminderKey)) {
            rows.set(item.reminderKey, {
              ...item,
              status: "PENDING",
              leaseUntil: null,
            });
            count++;
          }
        return { count };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { reminderKey: string; NOT: { context: { equals: string } } };
          data: Partial<Delivery>;
        }) => {
          const row = rows.get(where.reminderKey);
          if (
            !row ||
            !["PENDING", "SKIPPED"].includes(row.status) ||
            row.leaseUntil ||
            row.context.fingerprint === where.NOT.context.equals
          )
            return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
  };
  return {
    features,
    client,
    db: client as unknown as DomainDb,
    settings,
    user,
    meeting,
    interview,
    pairing,
    state,
    rows,
  };
}

describe("upcoming event reminders", () => {
  it.each(["interview", "meeting"] as const)(
    "honors the effective %s module gate at queue and preflight, not staged changes",
    async (kind) => {
      const f = fixture(kind);
      const feature = {
        key: kind === "interview" ? "INTERVIEWS" : "MEETINGS",
        enabled: true,
        pendingEnabled: false,
      };
      f.features.push(feature);
      await queueEventReminders(f.db, hourBefore);
      const row = [...f.rows.values()][0]!;
      expect(await validateEventReminder(f.db, row, hourBefore)).toBe(true);
      feature.enabled = false;
      feature.pendingEnabled = true;
      expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
      f.rows.clear();
      expect(await queueEventReminders(f.db, hourBefore)).toBe(0);
    },
  );

  it("routes a dual tutor/tutee account to its student assignment without disclosing peers", async () => {
    const f = fixture("tutoring");
    f.user.tutorId = "unrelated-tutor";
    await queueEventReminders(f.db, hourBefore);
    const row = [...f.rows.values()][0]!;
    expect(row.destination).toBe("/student");
    expect(JSON.stringify(row.context.emailDetail)).not.toContain("Emma Tutee");
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(true);
  });
  it.each([1440, 60])(
    "has exact %imin boundaries and a ten-minute grace, with no after-start catch-up",
    (lead) => {
      const due = new Date(start.getTime() - lead * 60_000);
      expect(reminderIsDue(start, lead, new Date(due.getTime() - 1))).toBe(
        false,
      );
      expect(reminderIsDue(start, lead, due)).toBe(true);
      expect(
        reminderIsDue(start, lead, new Date(due.getTime() + 600_000)),
      ).toBe(true);
      expect(
        reminderIsDue(start, lead, new Date(due.getTime() + 600_001)),
      ).toBe(false);
      expect(reminderIsDue(start, lead, start)).toBe(false);
    },
  );

  it("queues both thresholds independently and deduplicates repeated/concurrent sweeps", async () => {
    const f = fixture();
    await Promise.all([
      queueEventReminders(f.db, hourBefore),
      queueEventReminders(f.db, hourBefore),
    ]);
    expect(f.rows.size).toBe(1);
    await queueEventReminders(f.db, new Date(start.getTime() - 86_400_000));
    expect(
      [...f.rows.values()].map((row) => row.context.leadMinutes).sort(),
    ).toEqual([1440, 60]);
    expect(f.client.emailDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it("uses separate keys for occurrence, threshold, account and delivery address", () => {
    const context = {
      kind: "meeting" as const,
      sourceId: "meeting",
      startsAt: start.toISOString(),
      leadMinutes: 60 as const,
    };
    const key = reminderKey(context, "user", "primary@example.test");
    expect(
      new Set([
        key,
        reminderKey(
          { ...context, leadMinutes: 1440 },
          "user",
          "primary@example.test",
        ),
        reminderKey(context, "user", "secondary@example.test"),
        reminderKey(context, "other", "primary@example.test"),
        reminderKey(
          { ...context, startsAt: "2026-10-29T07:30:00.000Z" },
          "user",
          "primary@example.test",
        ),
      ]).size,
    ).toBe(5);
  });

  it("honors the global gate, optional preference and secondary-address switch", async () => {
    const f = fixture();
    f.settings.emailNotificationsEnabled = false;
    expect(await queueEventReminders(f.db, hourBefore)).toBe(0);
    f.settings.emailNotificationsEnabled = true;
    f.user.emailEventReminders = false;
    expect(await queueEventReminders(f.db, hourBefore)).toBe(0);
    f.user.emailEventReminders = true;
    f.user.emailSecondaryRecipients = true;
    expect(await queueEventReminders(f.db, hourBefore)).toBe(2);
  });

  it("rechecks source deletion/rescheduling, opt-out, participant eligibility and verified-address ownership", async () => {
    const f = fixture();
    await queueEventReminders(f.db, hourBefore);
    const row = [...f.rows.values()][0]!;
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(true);
    f.state.sourceExists = false;
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
    f.state.sourceExists = true;
    f.meeting.date = new Date(start.getTime() + 60_000);
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
    f.meeting.date = start;
    f.user.emailEventReminders = false;
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
    f.user.emailEventReminders = true;
    f.state.eligible = false;
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
    f.state.eligible = true;
    f.user.emails = [];
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
  });

  it("rejects late sends, changed timezones and tampered email detail", async () => {
    const f = fixture();
    await queueEventReminders(f.db, hourBefore);
    const row = [...f.rows.values()][0]!;
    expect(
      await validateEventReminder(
        f.db,
        row,
        new Date(hourBefore.getTime() + 600_001),
      ),
    ).toBe(false);
    f.settings.timeZone = "America/New_York";
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
    f.settings.timeZone = "Asia/Shanghai";
    expect(
      await validateEventReminder(
        f.db,
        {
          ...row,
          context: {
            ...row.context,
            emailDetail: { en: "Injected", zh: "注入" },
          },
        },
        hourBefore,
      ),
    ).toBe(false);
  });

  it("refreshes a changed unsent occurrence without resending accepted or changing leased mail", async () => {
    const f = fixture();
    await queueEventReminders(f.db, hourBefore);
    const row = [...f.rows.values()][0]!;
    f.meeting.title = "Updated team meeting";
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
    await queueEventReminders(f.db, hourBefore);
    expect(f.rows.size).toBe(1);
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(true);
    row.status = "SENT";
    f.meeting.title = "Another title";
    await queueEventReminders(f.db, hourBefore);
    expect(row.status).toBe("SENT");
    expect(JSON.stringify(row.context)).not.toContain("Another title");
    row.status = "PENDING";
    row.leaseUntil = new Date();
    await queueEventReminders(f.db, hourBefore);
    expect(JSON.stringify(row.context)).not.toContain("Another title");
  });

  it("includes the full interview panel and linked qualification applicant, never a raw application email", async () => {
    const f = fixture("interview");
    await queueEventReminders(f.db, hourBefore);
    expect(f.rows.size).toBe(1);
    expect(JSON.stringify(f.client.user.findMany.mock.calls[0])).toContain(
      '"in":["applicant","tutor"]',
    );
    f.interview.invalidatedAt = new Date();
    expect(
      await validateEventReminder(f.db, [...f.rows.values()][0]!, hourBefore),
    ).toBe(false);
  });

  it("excludes excused meeting attendees and inactive/departed/merged accounts in the database audience", async () => {
    const f = fixture();
    await queueEventReminders(f.db, hourBefore);
    const query = JSON.stringify(f.client.user.findMany.mock.calls[0]);
    expect(query).toContain("EXCUSED_ABSENT");
    expect(query).toContain("schoolDeparture");
    expect(query).toContain("mergedIntoId");
    expect(query).toContain('"status":"ACTIVE"');
  });

  it("derives a confirmed recurring occurrence in program local time with explicit owners", async () => {
    const f = fixture("tutoring");
    await queueEventReminders(f.db, hourBefore);
    expect(f.rows.size).toBe(1);
    const row = [...f.rows.values()][0]!;
    expect(row.context.startsAt).toBe(start.toISOString());
    expect(row.event).toBe("tutoring_upcoming");
    expect(JSON.stringify(f.client.user.findMany.mock.calls[0])).toContain(
      "retained-owner",
    );
    f.pairing.scheduleConfirmed = false;
    expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
  });

  it.each(["holiday", "noTutoring", "absent"] as const)(
    "suppresses the whole tutoring occurrence when %s becomes known after queuing",
    async (flag) => {
      const f = fixture("tutoring");
      await queueEventReminders(f.db, hourBefore);
      const row = [...f.rows.values()][0]!;
      f.state[flag] = true;
      expect(await validateEventReminder(f.db, row, hourBefore)).toBe(false);
      f.rows.clear();
      expect(await queueEventReminders(f.db, hourBefore)).toBe(0);
    },
  );

  it("queries explicit tutor and assigned tutee absence on the exact school date and overlapping block", async () => {
    const f = fixture("tutoring");
    await queueEventReminders(f.db, hourBefore);
    expect(f.client.session.count).toHaveBeenCalledWith({
      where: {
        pairingId: { in: ["pairing"] },
        tutorId: "tutor",
        date: {
          gte: new Date("2026-10-28T00:00:00Z"),
          lt: new Date("2026-10-29T00:00:00Z"),
        },
        startMin: { lt: 990 },
        endMin: { gt: 930 },
        OR: [
          { tutorStatus: { in: ["TUTOR_ABSENT", "RESCHEDULED"] } },
          {
            tutees: {
              some: {
                tuteeId: { in: ["student"] },
                status: { in: ["EXCUSED_ABSENT", "UNEXCUSED_ABSENT"] },
              },
            },
          },
        ],
      },
    });
  });

  it("honors optional term date bounds", async () => {
    const f = fixture("tutoring");
    f.pairing.term.endDate = new Date(start.getTime() - 1);
    expect(await queueEventReminders(f.db, hourBefore)).toBe(0);
    f.pairing.term.endDate = null;
    f.pairing.term.startDate = new Date(start.getTime() + 1);
    expect(await queueEventReminders(f.db, hourBefore)).toBe(0);
  });

  it("deduplicates a combined tutoring group's tutor across its member pairings", async () => {
    const f = fixture("tutoring");
    f.pairing.groupId = "group";
    const members = [
      f.pairing,
      { ...f.pairing, id: "second", subject: "Physics" },
    ];
    f.client.pairing.findMany.mockImplementation(async (args) =>
      args.include || args.where.dayOfWeek === 3 ? members : [],
    );
    await queueEventReminders(f.db, hourBefore);
    expect(f.rows.size).toBe(1);
    const row = [...f.rows.values()][0]!;
    expect(row.context.kind).toBe("tutoring_group");
    expect(row.context.sourceId).toBe("group");
    expect(JSON.stringify(row.context.emailDetail)).toContain(
      "Mathematics / Physics",
    );
  });

  it.each([
    ["2026-03-08T06:30:00Z", 150],
    ["2026-11-01T05:30:00Z", 90],
  ])(
    "skips nonexistent or ambiguous DST wall time at %s",
    async (now, minutes) => {
      const f = fixture("tutoring");
      f.settings.timeZone = "America/New_York";
      f.pairing.dayOfWeek = 7;
      f.pairing.startMin = minutes;
      expect(await queueEventReminders(f.db, new Date(now))).toBe(0);
    },
  );

  it("continues through source pages rather than starving the 101st due event", async () => {
    const f = fixture();
    const meetings = Array.from({ length: 101 }, (_, index) => ({
      ...f.meeting,
      id: `meeting-${String(index).padStart(3, "0")}`,
    }));
    f.client.tutorMeeting.findMany.mockImplementation(
      async (...args: unknown[]) => {
        const options = args[0] as { cursor?: { id: string } };
        return options.cursor ? meetings.slice(100) : meetings.slice(0, 100);
      },
    );
    f.client.tutorMeeting.findUnique.mockImplementation(
      async (...args: unknown[]) => {
        const options = args[0] as { where: { id: string } };
        return meetings.find((row) => row.id === options.where.id) ?? null;
      },
    );
    await queueEventReminders(f.db, hourBefore);
    expect(f.rows.size).toBe(101);
  });
});
