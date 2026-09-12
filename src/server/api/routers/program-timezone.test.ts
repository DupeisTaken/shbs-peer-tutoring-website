import { beforeEach, afterAll, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "../root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { appealDeadline } from "./student";
import { syncSessionFlag } from "~/server/crew/flags";

const caller = (role: Session["role"]) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: `timezone-${role}`,
        name: role,
        email: `${role}@example.test`,
      },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use shbs_shipping_test");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  for (const role of ["ADMIN", "COORDINATOR", "STUDENT", "HEAD"] as const)
    await db.user.create({
      data: {
        id: `timezone-${role}`,
        name: role,
        email: `${role}@example.test`,
        role,
      },
    });
});
afterAll(() => db.$disconnect());

it("defaults to Shanghai, permits admin changes and records before/after evidence", async () => {
  expect((await caller("ADMIN").program.timeZoneSettings()).timeZone).toBe(
    "Asia/Shanghai",
  );
  await caller("ADMIN").program.setTimeZone({
    timeZone: "America/New_York",
    expectedTimeZone: "Asia/Shanghai",
  });
  expect((await caller("HEAD").program.timeZoneSettings()).timeZone).toBe(
    "America/New_York",
  );
  expect(
    await db.auditLog.findFirst({
      where: { operation: "program.setTimeZone" },
    }),
  ).toMatchObject({
    details: {
      before: "Asia/Shanghai",
      after: "America/New_York",
      storedTimestampsPreserved: true,
    },
  });
});
it("rejects unauthorized, invalid and stale changes without changing settings", async () => {
  for (const role of ["COORDINATOR", "STUDENT"] as const)
    await expect(
      caller(role).program.setTimeZone({
        timeZone: "UTC",
        expectedTimeZone: "Asia/Shanghai",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller("ADMIN").program.setTimeZone({
      timeZone: "Fake/Zone",
      expectedTimeZone: "Asia/Shanghai",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller("ADMIN").program.setTimeZone({
      timeZone: "UTC",
      expectedTimeZone: "Europe/London",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.programSettings.count()).toBe(0);
});
it("preserves existing absolute deadlines and recurring school clock times", async () => {
  const date = new Date("2026-09-20T00:00:00Z");
  const term = await db.term.create({
    data: {
      schoolYear: "26-27",
      quarter: "Q1",
      name: "Q1",
      signupOpensAt: date,
    },
  });
  const slot = await db.timeSlot.create({
    data: {
      label: "School afternoon",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 990,
    },
  });
  await caller("HEAD").program.setTimeZone({
    timeZone: "Asia/Kolkata",
    expectedTimeZone: "Asia/Shanghai",
  });
  expect(
    (await db.term.findUniqueOrThrow({ where: { id: term.id } })).signupOpensAt,
  ).toEqual(date);
  expect(
    await db.timeSlot.findUnique({ where: { id: slot.id } }),
  ).toMatchObject({ startMin: 930, endMin: 990 });
});
it("calculates school-day appeal deadlines in the configured zone across DST", () => {
  const deadline = appealDeadline(
    new Date("2026-03-06T12:00:00Z"),
    [],
    "America/New_York",
  );
  expect(deadline.toISOString()).toBe("2026-03-14T03:59:59.999Z");
});

it("matches evening crew observations after UTC midnight to their school calendar session", async () => {
  await caller("ADMIN").program.setTimeZone({
    timeZone: "America/Los_Angeles",
    expectedTimeZone: "Asia/Shanghai",
  });
  const term = await db.term.create({
    data: { schoolYear: "26-27", quarter: "Q1", name: "Q1", active: true },
  });
  const tutor = await db.tutor.create({
    data: { englishName: "Evening tutor", status: "ACTIVE" },
  });
  const tutee = await db.tutee.create({
    data: { englishName: "Evening student", status: "ACTIVE" },
  });
  const room = await db.room.create({ data: { name: "Evening room" } });
  const pairing = await db.pairing.create({
    data: {
      tutorId: tutor.id,
      termId: term.id,
      subject: "Mathematics",
      dayOfWeek: 6,
      startMin: 1035,
      endMin: 1095,
    },
  });
  const session = await db.session.create({
    data: {
      pairingId: pairing.id,
      tutorId: tutor.id,
      date: new Date("2026-09-12T00:00:00Z"),
      startMin: 1035,
      endMin: 1095,
      month: "2026-09",
      schoolYear: "26-27",
      quarter: "Q1",
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
      actualRoomId: room.id,
      tutees: { create: { tuteeId: tutee.id, status: "PRESENT" } },
    },
  });
  await db.patrol.create({
    data: {
      crewUserId: "timezone-HEAD",
      hours: 0.5,
      termId: term.id,
      observations: {
        create: {
          roomId: room.id,
          headcount: "ZERO",
          observedAt: new Date("2026-09-13T00:15:00Z"),
        },
      },
    },
  });
  expect(await syncSessionFlag(db, session.id)).toEqual({ flagged: true });
});
