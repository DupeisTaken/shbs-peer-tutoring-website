import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Prisma, User } from "../../../generated/prisma";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  capturePublicationNotice,
  queuePublicationNotices,
  type PublicationNoticeInput,
} from "./publication-notices";

type Intent = Prisma.SessionNoticeCreateManyInput;
function user(id: string, changes: Partial<User> = {}): User {
  return {
    id,
    email: `${id}@example.test`,
    tutorId: null,
    studentId: null,
    ...changes,
  } as User;
}
function input(
  id = "cohort",
  changes: Partial<PublicationNoticeInput> = {},
): PublicationNoticeInput {
  return {
    tutorId: "tutor",
    timeZone: "Asia/Shanghai",
    subjects: ["Math"],
    cohort: {
      id,
      version: 1,
      startsAt: new Date("2026-11-02T07:00:00Z"),
      endsAt: new Date("2026-11-02T07:45:00Z"),
      roomId: null,
      online: false,
    },
    tuteeIds: ["tutee"],
    event: "schedule_updated",
    ...changes,
  };
}
function fixture(
  data: {
    users?: User[];
    ownerships?: { tuteeId: string; userId: string }[];
    rooms?: { id: string; name: string }[];
    existing?: Intent[];
  } = {},
) {
  const users = data.users ?? [];
  const stored = new Map(
    (data.existing ?? []).map((row) => [row.dedupeKey, row]),
  );
  const reads = {
    user: {
      findMany: vi.fn(
        async (query: {
          where: {
            tutorId?: { in: string[] };
            OR?: { id?: { in: string[] }; studentId?: { in: string[] } }[];
          };
        }) =>
          users.filter((row) =>
            query.where.tutorId
              ? row.tutorId !== null &&
                query.where.tutorId.in.includes(row.tutorId)
              : query.where.OR?.some(
                  (condition) =>
                    condition.id?.in.includes(row.id) === true ||
                    (row.studentId !== null &&
                      condition.studentId?.in.includes(row.studentId)),
                ),
          ),
      ),
    },
    studentProfileOwnership: {
      findMany: vi.fn(async (query: { where: { tuteeId: { in: string[] } } }) =>
        (data.ownerships ?? []).filter((row) =>
          query.where.tuteeId.in.includes(row.tuteeId),
        ),
      ),
    },
    room: {
      findMany: vi.fn(async (query: { where: { id: { in: string[] } } }) =>
        (data.rooms ?? []).filter((row) => query.where.id.in.includes(row.id)),
      ),
    },
    sessionNotice: {
      findMany: vi.fn(
        async (query: { where: { dedupeKey: { in: string[] } } }) =>
          query.where.dedupeKey.in
            .filter((key) => stored.has(key))
            .map((dedupeKey) => ({ dedupeKey })),
      ),
      createMany: vi.fn(async ({ data: rows }: { data: Intent[] }) => {
        for (const row of rows) {
          if (stored.has(row.dedupeKey))
            throw new Error("Synthetic duplicate receipt");
          stored.set(row.dedupeKey, row);
        }
        return { count: rows.length };
      }),
    },
  };
  return {
    users,
    reads,
    stored,
    tx: reads as unknown as Parameters<typeof queuePublicationNotices>[0],
  };
}

it("does no database work for an empty publication batch", async () => {
  const { tx, reads } = fixture();
  await queuePublicationNotices(tx, []);
  expect(reads.user.findMany).not.toHaveBeenCalled();
  expect(reads.studentProfileOwnership.findMany).not.toHaveBeenCalled();
  expect(reads.room.findMany).not.toHaveBeenCalled();
  expect(reads.sessionNotice.findMany).not.toHaveBeenCalled();
});

it("captures clocks, audience and subjects before later source objects change", () => {
  const subjects = ["Math"];
  const tutees = ["first"];
  const source = input("original", { subjects, tuteeIds: tutees });
  const captured = capturePublicationNotice(source);
  subjects.push("Later subject");
  tutees[0] = "later";
  source.cohort.startsAt.setTime(0);
  source.cohort.endsAt.setTime(0);
  expect(captured.subjects).toEqual(["Math"]);
  expect(captured.tuteeIds).toEqual(["first"]);
  expect(captured.cohort.startsAt).toBe("2026-11-02T07:00:00.000Z");
  expect(captured.cohort.endsAt).toBe("2026-11-02T07:45:00.000Z");
  expect(Object.isFrozen(captured)).toBe(true);
  expect(Object.isFrozen(captured.cohort)).toBe(true);
  expect(Object.isFrozen(captured.subjects)).toBe(true);
  expect(Object.isFrozen(captured.tuteeIds)).toBe(true);
});

it("stores the exact legacy context and dedupe keys without overriding queue defaults", async () => {
  const room = { id: "room", name: `  Room ${"X".repeat(130)}  ` };
  const source = input("published", {
    subjects: ["  Math  ", "Physics", "  Math  ", "Y".repeat(220)],
  });
  const descriptor = capturePublicationNotice({
    ...source,
    cohort: { ...source.cohort, roomId: room.id, version: 4 },
  });
  const { tx, stored } = fixture({
    users: [
      user("tutor-user", { tutorId: "tutor" }),
      user("student-user", { studentId: "tutee" }),
    ],
    rooms: [room],
  });
  await queuePublicationNotices(tx, [descriptor]);
  const context = {
    isActionable: false,
    startsAt: "2026-11-02T07:00:00.000Z",
    endsAt: "2026-11-02T07:45:00.000Z",
    timeZone: "Asia/Shanghai",
    originalStartsAt: "2026-11-02T07:00:00.000Z",
    subjectLabel: `  Math   / Physics / ${"Y".repeat(220)}`.slice(0, 200),
    roomLabel: room.name.slice(0, 120),
    online: false,
  };
  expect([...stored.values()]).toEqual([
    {
      dedupeKey: "cohort:published:4:schedule_updated:tutor:tutor",
      recipientUserId: "tutor-user",
      recipientEmail: "tutor-user@example.test",
      event: "schedule_updated",
      context,
    },
    {
      dedupeKey: "cohort:published:4:schedule_updated:tutee:tutee",
      recipientUserId: "student-user",
      recipientEmail: "student-user@example.test",
      event: "schedule_updated",
      context,
    },
  ]);
  for (const notice of stored.values()) {
    expect(notice).not.toHaveProperty("status");
    expect(notice).not.toHaveProperty("attempts");
    expect(notice).not.toHaveProperty("availableAt");
  }
});

it.each(["missing", "empty"])(
  "keeps cancelled tutee notices when the tutor mailbox is %s",
  async (mode) => {
    const tutor =
      mode === "empty"
        ? [user("tutor-user", { tutorId: "tutor", email: "" })]
        : [];
    const owner = user("retained", {
      suspendedAt: new Date(0),
      mergedIntoId: "other",
      tuteeMember: false,
    });
    const { tx, stored } = fixture({
      users: [...tutor, user("direct", { studentId: "tutee" }), owner],
      ownerships: [{ tuteeId: "tutee", userId: owner.id }],
    });
    await queuePublicationNotices(tx, [
      capturePublicationNotice(input("cancelled", { event: "cancelled" })),
    ]);
    expect([...stored.values()]).toEqual([
      {
        dedupeKey: "cohort:cancelled:1:cancelled:tutee:tutee",
        recipientUserId: owner.id,
        recipientEmail: owner.email,
        event: "cancelled",
        context: {
          isActionable: false,
          startsAt: "2026-11-02T07:00:00.000Z",
          endsAt: "2026-11-02T07:45:00.000Z",
          timeZone: "Asia/Shanghai",
          originalStartsAt: "2026-11-02T07:00:00.000Z",
          subjectLabel: "Math",
          roomLabel: null,
          online: false,
        },
      },
    ]);
  },
);

it("reads contacts fresh at finalization while retaining captured actor identity and order", async () => {
  const owner = user("owner", { email: "before@example.test" });
  const { tx, users, stored } = fixture({
    users: [owner, user("tutor-user", { tutorId: "tutor" })],
    ownerships: [
      { tuteeId: "a", userId: owner.id },
      { tuteeId: "b", userId: owner.id },
    ],
  });
  const first = capturePublicationNotice(
    input("first", { tuteeIds: ["b", "a", "b"] }),
  );
  const second = capturePublicationNotice(input("second", { tuteeIds: ["a"] }));
  users[0]!.email = "after@example.test";
  await queuePublicationNotices(tx, [first, second]);
  expect([...stored.keys()]).toEqual([
    "cohort:first:1:schedule_updated:tutor:tutor",
    "cohort:first:1:schedule_updated:tutee:b",
    "cohort:first:1:schedule_updated:tutee:a",
    "cohort:second:1:schedule_updated:tutor:tutor",
    "cohort:second:1:schedule_updated:tutee:a",
  ]);
  expect(
    stored.get("cohort:first:1:schedule_updated:tutee:b")?.recipientEmail,
  ).toBe("after@example.test");
  expect(
    stored.get("cohort:first:1:schedule_updated:tutee:a")?.recipientEmail,
  ).toBe("after@example.test");
});

it("retains the first duplicate intent and never overwrites an existing attempt", async () => {
  const key = "cohort:existing:1:schedule_updated:tutor:tutor";
  const retained: Intent = {
    dedupeKey: key,
    recipientUserId: "original",
    recipientEmail: "original@example.test",
    event: "schedule_updated",
    context: { marker: "original" },
    status: "SENDING",
    attempts: 3,
    attemptId: "active-attempt",
  };
  const { tx, stored } = fixture({
    users: [user("tutor-user", { tutorId: "tutor" })],
    existing: [retained],
  });
  await queuePublicationNotices(tx, [
    capturePublicationNotice(input("existing", { tuteeIds: [] })),
    capturePublicationNotice(
      input("duplicate", { tuteeIds: [], subjects: ["First"] }),
    ),
    capturePublicationNotice(
      input("duplicate", { tuteeIds: [], subjects: ["Later"] }),
    ),
  ]);
  expect(stored.get(key)).toBe(retained);
  expect(
    stored.get("cohort:duplicate:1:schedule_updated:tutor:tutor")?.context,
  ).toMatchObject({ subjectLabel: "First", roomLabel: null });
});

it("bounds operation-wide identity, room and insert batches to 500", async () => {
  const count = 501;
  const users = Array.from({ length: count }, (_, index) => [
    user(`tutor-user-${index}`, { tutorId: `tutor-${index}` }),
    user(`student-${index}`),
  ]).flat();
  const ownerships = Array.from({ length: count }, (_, index) => ({
    tuteeId: `tutee-${index}`,
    userId: `student-${index}`,
  }));
  const rooms = Array.from({ length: count }, (_, index) => ({
    id: `room-${index}`,
    name: `Synthetic ${index}`,
  }));
  const descriptors = Array.from({ length: count }, (_, index) => {
    const source = input(`cohort-${index}`, {
      tutorId: `tutor-${index}`,
      tuteeIds: [`tutee-${index}`],
    });
    return capturePublicationNotice({
      ...source,
      cohort: { ...source.cohort, roomId: `room-${index}` },
    });
  });
  const { tx, reads, stored } = fixture({ users, ownerships, rooms });
  await queuePublicationNotices(tx, descriptors);
  expect(stored.size).toBe(count * 2);
  expect(
    reads.user.findMany.mock.calls
      .filter(([query]) => query.where.tutorId)
      .map(([query]) => query.where.tutorId!.in.length),
  ).toEqual([500, 1]);
  expect(
    reads.studentProfileOwnership.findMany.mock.calls.map(
      ([query]) => query.where.tuteeId.in.length,
    ),
  ).toEqual([500, 1]);
  expect(
    reads.room.findMany.mock.calls.map(([query]) => query.where.id.in.length),
  ).toEqual([500, 1]);
  expect(
    reads.sessionNotice.createMany.mock.calls.map(
      ([query]) => query.data.length,
    ),
  ).toEqual([500, 500, 2]);
});

it("propagates a finalization read failure before any notice can be inserted", async () => {
  const failure = new Error("Synthetic contact read failure");
  const { tx, reads } = fixture();
  reads.user.findMany.mockRejectedValueOnce(failure);
  await expect(
    queuePublicationNotices(tx, [capturePublicationNotice(input())]),
  ).rejects.toBe(failure);
  expect(reads.sessionNotice.createMany).not.toHaveBeenCalled();
});

it("propagates notice insertion failures to the enclosing publication transaction", async () => {
  const failure = Object.assign(new Error("Synthetic notice FK failure"), {
    code: "P2003",
  });
  const { tx, reads } = fixture({
    users: [user("tutor-user", { tutorId: "tutor" })],
  });
  reads.sessionNotice.createMany.mockRejectedValueOnce(failure);
  await expect(
    queuePublicationNotices(tx, [capturePublicationNotice(input())]),
  ).rejects.toBe(failure);
});

it("rolls back real publication parents and notice rows when finalization cannot commit", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const { db } = await import("~/server/db");
  const { lockEntity } = await import("~/server/transactions");
  const { lockPlannedRoomSchedule } = await import("~/server/room-bookings");
  const token = randomUUID();
  const tutorId = `publication-notice-tutor-${token}`;
  const userId = `publication-notice-user-${token}`;
  const planId = `publication-notice-plan-${token}`;
  const cohortId = `publication-notice-cohort-${token}`;
  const failure = new Error(
    "Synthetic caller failure after queued publication",
  );
  try {
    await expect(
      db.$transaction(async (tx) => {
        await lockEntity(tx, "program:period");
        await lockPlannedRoomSchedule(tx);
        await lockEntity(tx, "session-planning");
        const term =
          (await tx.term.findFirst({ select: { id: true } })) ??
          (await tx.term.create({
            data: {
              schoolYear: "99-00",
              quarter: "Q4",
              name: "Synthetic rollback term",
              active: false,
            },
          }));
        await tx.tutor.create({
          data: {
            id: tutorId,
            englishName: "Synthetic notice tutor",
            status: "ACTIVE",
          },
        });
        await tx.user.create({
          data: {
            id: userId,
            email: `${token}@example.test`,
            role: "TUTOR",
            tutorId,
          },
        });
        await tx.sessionPlan.create({
          data: {
            id: planId,
            generationKey: `publication-notice:${token}`,
            tutorId,
            termId: term.id,
            originalDate: "2026-11-02",
            timeZone: "Asia/Shanghai",
            sourceFingerprint: "synthetic",
          },
        });
        const cohort = await tx.sessionPlanCohort.create({
          data: {
            id: cohortId,
            planId,
            date: "2026-11-02",
            startMin: 900,
            endMin: 945,
            startsAt: new Date("2026-11-02T07:00:00Z"),
            endsAt: new Date("2026-11-02T07:45:00Z"),
          },
        });
        await queuePublicationNotices(tx, [
          capturePublicationNotice({
            tutorId,
            timeZone: "Asia/Shanghai",
            subjects: ["Synthetic"],
            cohort,
            tuteeIds: [],
            event: "schedule_updated",
          }),
        ]);
        expect(
          await tx.sessionNotice.count({ where: { recipientUserId: userId } }),
        ).toBe(1);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(
      await db.sessionNotice.count({ where: { recipientUserId: userId } }),
    ).toBe(0);
    expect(await db.sessionPlanCohort.count({ where: { id: cohortId } })).toBe(
      0,
    );
    expect(await db.sessionPlan.count({ where: { id: planId } })).toBe(0);
    expect(await db.user.count({ where: { id: userId } })).toBe(0);
    expect(await db.tutor.count({ where: { id: tutorId } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});
