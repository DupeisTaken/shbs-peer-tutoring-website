import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { currentPolicy } from "~/server/policy-acceptance";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { pairingEntries } from "~/lib/pairing-groups";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
let roomId: string;
function caller(role: Session["role"] = "TUTOR", id = "groups-user") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id },
      role,
      tutorId: "groups-tutor",
      expires: new Date(Date.now() + 60000).toISOString(),
    },
  });
}
const mine = () => caller().pairingGroups.mine();
const save = async (pairingIds = ["a", "b"], slotId = "slot-one") => {
  const state = await mine();
  return caller().pairingGroups.save({
    snapshot: state.snapshot,
    groups: [{ id: state.groups[0]?.id, pairingIds, slotId }],
  });
};
beforeEach(async () => {
  // This fixture owns the explicitly selected disposable local test database.
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
  await db.term.create({
    data: {
      id: "groups-term",
      schoolYear: "26-27",
      quarter: "Q1",
      name: "Current",
      active: true,
    },
  });
  await db.tutor.createMany({
    data: [
      { id: "groups-tutor", englishName: "Synthetic tutor", status: "ACTIVE" },
      { id: "other-tutor", englishName: "Other tutor", status: "ACTIVE" },
    ],
  });
  await db.user.createMany({
    data: [
      {
        id: "groups-user",
        email: "groups@example.test",
        role: "TUTOR",
        tutorId: "groups-tutor",
      },
      {
        id: "other-user",
        email: "other@example.test",
        role: "TUTOR",
        tutorId: "other-tutor",
      },
      { id: "groups-head", email: "head@example.test", role: "HEAD" },
    ],
  });
  await db.tutee.createMany({
    data: [
      { id: "one", englishName: "Student One", status: "ACTIVE" },
      { id: "two", englishName: "Student Two", status: "ACTIVE" },
    ],
  });
  roomId = (await db.room.create({ data: { name: "Synthetic A101" } })).id;
  await db.timeSlot.createMany({
    data: [
      {
        id: "slot-one",
        label: "Monday",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
      {
        id: "slot-two",
        label: "Tuesday",
        dayOfWeek: 2,
        startMin: 900,
        endMin: 960,
      },
      {
        id: "slot-three",
        label: "Wednesday",
        dayOfWeek: 3,
        startMin: 900,
        endMin: 960,
      },
    ],
  });
  for (const [index, id] of ["a", "b", "c"].entries())
    await db.pairing.create({
      data: {
        id,
        tutorId: "groups-tutor",
        termId: "groups-term",
        subject: ["Math", "Physics", "Chemistry"][index]!,
        roomId,
        scheduleConfirmed: true,
        dayOfWeek: index + 1,
        startMin: 900,
        endMin: 960,
        timeSlotId: ["slot-one", "slot-two", "slot-three"][index],
        tutees: {
          create: [
            { tuteeId: "one" },
            ...(id === "a" ? [{ tuteeId: "two" }] : []),
          ],
        },
      },
    });
  await db.policyDocument.create({
    data: {
      slug: "tutor-policy",
      locale: "en",
      title: "Synthetic policy",
      body: "Synthetic tutor policy",
      version: "1",
    },
  });
  const policy = await currentPolicy(db, "tutor-policy");
  await db.policyAcceptance.create({
    data: {
      userId: "groups-user",
      slug: "tutor-policy",
      revision: policy.revision,
      snapshot: policy.documents,
      signature: "Synthetic Tutor",
    },
  });
});
afterAll(async () => {
  await db.$disconnect();
});

it("persists one coherent group, common schedule and room, preserving subject memberships", async () => {
  const saved = await save();
  expect(saved.groups).toHaveLength(1);
  expect(saved.groups[0]?.pairingIds).toEqual(["a", "b"]);
  const rows = await caller().tutor.myPairings();
  const entry = pairingEntries(rows).find((e) => e.groupId)!;
  expect(entry.pairings).toHaveLength(2);
  expect(
    new Set(entry.pairings.flatMap((p) => p.tutees.map((t) => t.tuteeId))).size,
  ).toBe(2);
  expect(
    entry.pairings.every(
      (p) =>
        p.timeSlotId === "slot-one" && p.roomId === roomId && p.dayOfWeek === 1,
    ),
  ).toBe(true);
  expect((await mine()).groups).toEqual(saved.groups);
  expect(await db.session.count()).toBe(0);
  expect(
    await db.auditLog.count({
      where: { operation: "pairingGroups.save", kind: { not: "ATTEMPT" } },
    }),
  ).toBe(1);
});

it("adds/removes members and can split/rejoin repeatedly without losing assignments", async () => {
  await save();
  await save(["a", "b", "c"]);
  const removed = await save(["b", "c"], "slot-two");
  expect(removed.groups[0]?.pairingIds).toEqual(["b", "c"]);
  expect(await db.pairing.findUnique({ where: { id: "a" } })).toMatchObject({
    groupId: null,
    scheduleConfirmed: false,
    timeSlotId: null,
  });
  await caller().pairingGroups.save({ snapshot: removed.snapshot, groups: [] });
  expect(await db.pairingGroup.count()).toBe(0);
  expect(await db.pairing.count()).toBe(3);
  expect(await db.pairingTutee.count()).toBe(4);
  expect((await save()).groups).toHaveLength(1);
});

it("regroups after attendance without changing saved subjects, attendance, room or credited hours", async () => {
  const group = await save();
  await caller().tutor.submitAttendance({
    pairingId: "a",
    mergePairingIds: ["b"],
    date: new Date("2026-01-05"),
    tutorStatus: "PRESENT",
    startMin: 900,
    endMin: 960,
    tutees: [
      { tuteeId: "one", status: "PRESENT" },
      { tuteeId: "two", status: "PRESENT" },
    ],
    actualRoomId: roomId,
    comments: "Historical group evidence",
    ratingPreparedness: 4,
    ratingParticipation: 4,
    ratingUnderstanding: 4,
    ratingBehavior: 4,
    ratingProgress: 4,
  });
  const before = await db.session.findMany({
    include: { tutees: true },
    orderBy: { id: "asc" },
  });
  expect(before).toHaveLength(2);
  expect(before.reduce((sum, s) => sum + s.shCount, 0)).toBe(3);
  await caller().pairingGroups.save({ snapshot: group.snapshot, groups: [] });
  await save(["b", "c"], "slot-two");
  expect(
    await db.session.findMany({
      include: { tutees: true },
      orderBy: { id: "asc" },
    }),
  ).toEqual(before);
});

it.each([["a"], ["a", "a"], ["a", "b", "c", "d", "e", "f", "g"]])(
  "rejects invalid group membership %j",
  async (...args) => {
    const ids = args as string[];
    await expect(save(ids)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.pairingGroup.count()).toBe(0);
  },
);

it("rejects one assignment in two groups", async () => {
  const state = await mine();
  await expect(
    caller().pairingGroups.save({
      snapshot: state.snapshot,
      groups: [
        { pairingIds: ["a", "b"], slotId: "slot-one" },
        { pairingIds: ["b", "c"], slotId: "slot-two" },
      ],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("rejects another tutor’s assignment and group identity", async () => {
  await db.pairing.update({
    where: { id: "b" },
    data: { tutorId: "other-tutor" },
  });
  await expect(save()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const foreign = await db.pairingGroup.create({
    data: {
      tutorId: "other-tutor",
      termId: "groups-term",
      primaryPairingId: "b",
    },
  });
  const state = await mine();
  await expect(
    caller().pairingGroups.save({
      snapshot: state.snapshot,
      groups: [{ id: foreign.id, pairingIds: ["a", "c"], slotId: "slot-one" }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect((await mine()).groups).toHaveLength(0);
});

it.each(["PENDING", "OPTED_OUT", "GRADUATED", "ARCHIVED"] as const)(
  "denies %s tutor writes",
  async (status) => {
    const state = await mine();
    await db.tutor.update({ where: { id: "groups-tutor" }, data: { status } });
    await expect(
      caller().pairingGroups.save({ snapshot: state.snapshot, groups: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it.each(["VIEWER", "ADMIN", "STUDENT", "CREW"] as const)(
  "does not grant %s a tutor identity by rank alone",
  async (role) => {
    await db.user.update({
      where: { id: "groups-user" },
      data: { role, tutorId: null },
    });
    await expect(caller(role).pairingGroups.mine()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller(role).pairingGroups.save({ snapshot: "0".repeat(64), groups: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it.each(["revoked", "suspended", "departed"] as const)(
  "denies %s participation",
  async (state) => {
    const initial = await mine();
    if (state === "revoked")
      await db.user.update({
        where: { id: "groups-user" },
        data: { tutorAccessRevoked: true },
      });
    if (state === "suspended")
      await db.user.update({
        where: { id: "groups-user" },
        data: { suspendedAt: new Date() },
      });
    if (state === "departed")
      await db.schoolDeparture.create({
        data: { userId: "groups-user", reason: "TRANSFERRED", source: "HEAD" },
      });
    await expect(
      caller().pairingGroups.save({ snapshot: initial.snapshot, groups: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it.each(["roster", "schedule", "period"] as const)(
  "rejects a stale %s preview",
  async (change) => {
    const initial = await mine();
    if (change === "roster")
      await db.pairingTutee.delete({
        where: { pairingId_tuteeId: { pairingId: "a", tuteeId: "two" } },
      });
    if (change === "schedule")
      await db.pairing.update({ where: { id: "b" }, data: { startMin: 930 } });
    if (change === "period")
      await db.term.update({
        where: { id: "groups-term" },
        data: { active: false },
      });
    await expect(
      caller().pairingGroups.save({
        snapshot: initial.snapshot,
        groups: [{ pairingIds: ["a", "b"], slotId: "slot-one" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  },
);

it("serializes competing edits and rejects a replay of an accepted draft", async () => {
  const initial = await mine();
  const input = {
    snapshot: initial.snapshot,
    groups: [{ pairingIds: ["a", "b"], slotId: "slot-one" }],
  };
  const results = await Promise.allSettled([
    caller().pairingGroups.save(input),
    caller().pairingGroups.save(input),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.pairingGroup.count()).toBe(1);
  await expect(caller().pairingGroups.save(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
});

it("rolls back the entire group and schedule on room blackout or other booking conflicts", async () => {
  const initial = await mine();
  await db.roomUnavailability.create({
    data: { roomId, dayOfWeek: 4, startMin: 900, endMin: 960 },
  });
  await db.timeSlot.create({
    data: {
      id: "blocked-slot",
      label: "Blocked",
      dayOfWeek: 4,
      startMin: 900,
      endMin: 960,
    },
  });
  const fresh = await mine();
  await expect(
    caller().pairingGroups.save({
      snapshot: fresh.snapshot,
      groups: [{ pairingIds: ["a", "b"], slotId: "blocked-slot" }],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await mine()).pairings).toEqual(initial.pairings);
  expect(await db.pairingGroup.count()).toBe(0);
  await expect(save(["a", "b"], "slot-three")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect((await mine()).pairings).toEqual(initial.pairings);
});

it("updates every member through the existing slot control and retains the group on catalog edits", async () => {
  await save();
  await caller().tutor.setPairingSlot({ pairingId: "b", slotId: "slot-two" });
  expect((await mine()).groups[0]?.slotId).toBe("slot-two");
  expect(
    (await mine()).pairings
      .filter((p) => p.groupId)
      .every((p) => p.dayOfWeek === 2),
  ).toBe(true);
  await caller("HEAD", "groups-head").admin.updateTimeSlot({
    id: "slot-two",
    label: "Updated Tuesday",
    dayOfWeek: 2,
    startMin: 1020,
    endMin: 1080,
    active: true,
  });
  expect((await mine()).groups).toHaveLength(1);
  expect(
    (await mine()).pairings
      .filter((p) => p.groupId)
      .every((p) => p.startMin === 1020),
  ).toBe(true);
  await caller().tutor.setPairingSlot({ pairingId: "a", slotId: null });
  expect((await mine()).groups[0]?.slotId).toBeNull();
});

it("database guards prevent foreign group membership and unrelated room overlap", async () => {
  const saved = await save();
  const id = saved.groups[0]!.id;
  await expect(
    db.pairing.create({
      data: {
        id: "foreign",
        tutorId: "other-tutor",
        termId: "groups-term",
        groupId: id,
        subject: "Foreign",
        dayOfWeek: 5,
        startMin: 900,
        endMin: 960,
      },
    }),
  ).rejects.toThrow();
  await expect(
    db.pairing.update({
      where: { id: "b" },
      data: { dayOfWeek: 3, timeSlotId: "slot-three" },
    }),
  ).rejects.toThrow();
  await db.pairing.update({
    where: { id: "b" },
    data: { tutorId: "other-tutor", scheduleConfirmed: false },
  });
  expect(await db.pairing.findUnique({ where: { id: "b" } })).toMatchObject({
    groupId: null,
  });
  expect((await mine()).groups).toHaveLength(0);
});

it("an independent management schedule edit releases that member without disturbing its old group", async () => {
  await save(["a", "b", "c"]);
  await db.pairing.update({
    where: { id: "b" },
    data: { dayOfWeek: 5, timeSlotId: null, startMin: 1000, endMin: 1060 },
  });
  expect(await db.pairing.findUnique({ where: { id: "b" } })).toMatchObject({
    groupId: null,
    dayOfWeek: 5,
  });
  expect((await mine()).groups[0]?.pairingIds).toEqual(["a", "c"]);
});
