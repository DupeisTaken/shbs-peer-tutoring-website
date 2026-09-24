import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { readFileSync } from "node:fs";
import pg from "pg";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import * as notifications from "~/server/notifications/create";

function caller(id = "head", role: Session["role"] = "HEAD") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: id, email: `${id}@example.test` },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
}
const send = (
  recipientIds: string[],
  body = "Synthetic private message",
  clientKey = crypto.randomUUID(),
) => ({ recipientIds, body, clientKey, disclosureVersion: 1 as const });
const setGroups = (
  groups: (
    "MANAGEMENT" | "CURRENT_TUTORS" | "PAST_TUTORS" | "SAME_GROUP" | "ALL_USERS"
  )[],
) =>
  caller().messaging.setPermission({
    target: { type: "ROLE", role: "STUDENT" },
    groups,
    reason: "Test role policy",
  });
const contacts = async (id = "alice") =>
  (await caller(id, "STUDENT").messaging.recipients({})).people
    .map((p) => p.id)
    .sort();

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !["/shbs_messaging_test", "/shbs_shipping_test"].includes(url.pathname)
  )
    throw Error(
      "Messaging tests require an isolated allowed local test database",
    );
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
  (
    globalThis as { rateLimitStore?: Map<string, unknown> }
  ).rateLimitStore?.clear();
  await db.term.createMany({
    data: [
      {
        id: "current",
        schoolYear: "26-27",
        quarter: "Q1",
        name: "Current",
        active: true,
      },
      { id: "past", schoolYear: "25-26", quarter: "Q4", name: "Past" },
    ],
  });
  for (const id of ["current-tutor", "past-tutor", "unrelated-tutor"])
    await db.tutor.create({
      data: { id, englishName: id, username: id, email: `${id}@example.test` },
    });
  await db.tutee.createMany({
    data: ["alice-profile", "alice-old", "bob-profile", "other-profile"].map(
      (id) => ({ id, englishName: id }),
    ),
  });
  await db.user.createMany({
    data: [
      ...(["head", "admin", "coordinator", "viewer", "crew"] as const).map(
        (id) => ({
          id,
          name: id,
          username: id,
          email: `${id}@example.test`,
          role: id.toUpperCase() as Session["role"],
        }),
      ),
      ...["current-tutor", "past-tutor", "unrelated-tutor"].map((id) => ({
        id,
        name: id,
        username: id,
        email: `${id}-account@example.test`,
        role: "TUTOR" as const,
        tutorId: id,
      })),
      ...["alice", "bob", "other"].map((id) => ({
        id,
        name: "Same Name",
        username: id,
        email: `${id}@example.test`,
        role: "STUDENT" as const,
        studentId: `${id}-profile`,
      })),
    ],
  });
  await db.studentProfileOwnership.create({
    data: { userId: "alice", tuteeId: "alice-old" },
  });
  for (const [id, tutorId, termId, tutees, dayOfWeek] of [
    ["group", "current-tutor", "current", ["alice-profile", "bob-profile"], 1],
    ["old-group", "past-tutor", "past", ["alice-old"], 2],
    ["other-group", "unrelated-tutor", "current", ["other-profile"], 3],
  ] as const)
    await db.pairing.create({
      data: {
      scheduleConfirmed: true,
        id,
        tutorId,
        termId,
        subject: "Math",
        dayOfWeek,
        startMin: 900,
        endMin: 960,
        tutees: { create: tutees.map((tuteeId) => ({ tuteeId })) },
      },
    });
});
afterAll(async () => db.$disconnect());

it("preserves defaults, applies unions and makes a user override replace its role", async () => {
  expect(await contacts()).toEqual(["admin", "coordinator", "head"]);
  await setGroups(["CURRENT_TUTORS", "SAME_GROUP", "MANAGEMENT"]);
  expect(await contacts()).toEqual([
    "admin",
    "bob",
    "coordinator",
    "current-tutor",
    "head",
  ]);
  await caller().messaging.setPermission({
    target: { type: "USER", userId: "alice" },
    groups: [],
    reason: "Explicit empty override",
  });
  expect(await contacts()).toEqual([]);
  expect(
    await caller().messaging.userPermission({ userId: "alice" }),
  ).toMatchObject({ source: "USER", groups: [] });
  await caller().messaging.setPermission({
    target: { type: "USER", userId: "alice" },
    groups: null,
    reason: "Restore role inheritance",
  });
  expect(await contacts()).toContain("bob");
  expect(
    await caller().messaging.userPermission({ userId: "alice" }),
  ).toMatchObject({ source: "ROLE" });
});
it.each([
  ["MANAGEMENT", ["admin", "coordinator", "head"]],
  ["CURRENT_TUTORS", ["current-tutor"]],
  ["PAST_TUTORS", ["past-tutor"]],
  ["SAME_GROUP", ["bob"]],
] as const)(
  "scopes %s to actual account relationships",
  async (group, expected) => {
    await setGroups([group]);
    expect(await contacts()).toEqual(expected);
  },
);
it("retains past assignment evidence through roster deletion and tutor replacement", async () => {
  await db.pairingTutee.delete({
    where: {
      pairingId_tuteeId: { pairingId: "group", tuteeId: "alice-profile" },
    },
  });
  await db.pairing.delete({ where: { id: "old-group" } });
  await setGroups(["PAST_TUTORS"]);
  expect(await contacts()).toEqual(["current-tutor", "past-tutor"]);
  await db.pairingTutee.create({
    data: { pairingId: "group", tuteeId: "alice-profile" },
  });
  await db.pairing.update({
    where: { id: "group" },
    data: { tutorId: "unrelated-tutor" },
  });
  await setGroups(["CURRENT_TUTORS"]);
  expect(await contacts()).toEqual(["unrelated-tutor"]);
  await setGroups(["PAST_TUTORS"]);
  expect(await contacts()).toEqual(["current-tutor", "past-tutor"]);
});
it("does not confuse a shared timetable or term with the same scheduled group", async () => {
  await db.pairing.update({
    where: { id: "other-group" },
    data: { dayOfWeek: 1 },
  });
  await setGroups(["SAME_GROUP"]);
  expect(await contacts()).toEqual(["bob"]);
  await expect(
    caller("alice").messaging.send(send(["other"])),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("rechecks role, suspension and assignment revocations after search; history remains readable", async () => {
  await setGroups(["SAME_GROUP"]);
  const alice = caller("alice", "STUDENT");
  await alice.messaging.send(send(["bob"]));
  await db.pairingTutee.delete({
    where: {
      pairingId_tuteeId: { pairingId: "group", tuteeId: "bob-profile" },
    },
  });
  await expect(alice.messaging.send(send(["bob"]))).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(await caller("bob", "STUDENT").messaging.inbox({})).toMatchObject([
    { canReply: false },
  ]);
  await db.user.update({ where: { id: "alice" }, data: { role: "VIEWER" } });
  expect(await contacts()).toEqual(["admin", "coordinator", "head"]);
  await db.user.update({
    where: { id: "head" },
    data: { suspendedAt: new Date() },
  });
  expect(await contacts()).not.toContain("head");
  await expect(alice.messaging.send(send(["head"]))).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await db.user.update({
    where: { id: "alice" },
    data: { suspendedAt: new Date() },
  });
  await expect(alice.messaging.inbox({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("paginates beyond fifty and exposes only allowed public identities, including duplicate names", async () => {
  await db.user.createMany({
    data: Array.from({ length: 55 }, (_, i) => ({
      id: `extra-${i}`,
      name: "Duplicate",
      username: `extra-${String(i).padStart(2, "0")}`,
      email: `extra-${i}@example.test`,
      role: "STUDENT",
    })),
  });
  const first = await caller().messaging.recipients({ search: "Duplicate" });
  const second = await caller().messaging.recipients({
    search: "Duplicate",
    page: 1,
  });
  expect(first.people).toHaveLength(50);
  expect(first.more).toBe(true);
  expect(second.people).toHaveLength(5);
  expect(second.more).toBe(false);
  expect(
    new Set([...first.people, ...second.people].map((p) => p.id)).size,
  ).toBe(55);
  expect(first.people[0]).not.toHaveProperty("email");
  expect(
    (await caller("alice").messaging.recipients({ search: "extra" })).people,
  ).toEqual([]);
  expect(
    (await caller().messaging.recipients({ search: "extra-01" })).people,
  ).toHaveLength(1);
});
it("validates the whole batch before sending and deduplicates private deliveries and retries", async () => {
  await setGroups(["MANAGEMENT"]);
  const alice = caller("alice", "STUDENT");
  await expect(
    alice.messaging.send(send(["head", "other"])),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.directMessage.count()).toBe(0);
  expect(await db.messageBatch.count()).toBe(0);
  const input = send(["admin", "head", "admin"]);
  await Promise.all([
    alice.messaging.send(input),
    alice.messaging.send({ ...input, recipientIds: ["head", "admin"] }),
  ]);
  expect(await db.directMessage.count()).toBe(2);
  expect(await db.notification.count()).toBe(2);
  const headInbox = await caller().messaging.inbox({});
  expect(headInbox).toHaveLength(1);
  expect(JSON.stringify(headInbox)).not.toContain('"recipientId":"admin"');
  expect(headInbox[0]).not.toHaveProperty("clientKey");
  await caller("admin", "ADMIN").messaging.send(
    send(["alice"], "Administrator reply only"),
  );
  expect(await caller().messaging.inbox({})).toHaveLength(1);
  expect(await caller("other").messaging.inbox({})).toEqual([]);
  await setGroups([]);
  expect(await alice.messaging.send(input)).toMatchObject({ count: 2 }); // receipt replay sends nothing
  await expect(
    alice.messaging.send({ ...input, body: "Changed body" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.directMessage.count()).toBe(3);
  expect(
    (
      await db.notification.findMany({
        where: { userId: { in: ["head", "admin"] } },
      })
    ).every((n) => n.body === null && n.link === "/messages"),
  ).toBe(true);
});
it("rolls back the batch and its receipt on notification failure so the same retry can deliver once", async () => {
  const input = send(["alice", "bob"]);
  const notify = vi
    .spyOn(notifications, "notifyUsers")
    .mockRejectedValueOnce(new Error("Synthetic notification failure"));
  try {
    await expect(caller().messaging.send(input)).rejects.toThrow(
      "Synthetic notification failure",
    );
    expect(await db.directMessage.count()).toBe(0);
    expect(await db.messageBatch.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
  } finally {
    notify.mockRestore();
  }
  await caller().messaging.send(input);
  await caller().messaging.send(input);
  expect(await db.directMessage.count()).toBe(2);
  expect(await db.notification.count()).toBe(2);
});
it("bounds batch size and counts deliveries across batches", async () => {
  await expect(
    caller().messaging.send(send(Array.from({ length: 21 }, () => "alice"))),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await db.directMessage.createMany({
    data: Array.from({ length: 100 }, (_, i) => ({
      senderId: "head",
      recipientId: "alice",
      clientKey: `quota-${i}`,
      body: "Synthetic",
    })),
  });
  await expect(caller().messaging.send(send(["bob"]))).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
});
it("keeps old-writer inserts private and permits old delivery retries without retroactive supervision", async () => {
  const key = crypto.randomUUID();
  const legacy = await db.directMessage.create({
    data: {
      senderId: "head",
      recipientId: "alice",
      clientKey: key,
      body: "legacy-private-marker",
    },
  });
  expect(legacy.supervisable).toBe(false);
  await caller().messaging.send({
    recipientId: "alice",
    body: legacy.body,
    clientKey: key,
  });
  expect(await db.directMessage.count()).toBe(1);
  await expect(
    caller().messaging.send({
      recipientId: "alice",
      body: "Fresh legacy UI",
      clientKey: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(
    (await caller().messaging.supervision({ search: "legacy-private-marker" }))
      .rows,
  ).toEqual([]);
  expect(
    (await caller().messaging.supervision({ participantId: "alice" })).rows,
  ).toEqual([]);
  await expect(
    caller().messaging.review({ id: legacy.id, reason: "Attempt old review" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    caller().messaging.moderate({
      id: legacy.id,
      hide: true,
      reason: "Attempt old moderation",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await caller("alice").messaging.inbox({})).toMatchObject([
    { body: legacy.body, supervisable: false },
  ]);
});
it.each(["coordinator", "alice", "current-tutor", "viewer", "crew"])(
  "rejects supervision and permission changes from %s even with a stale HEAD session",
  async (id) => {
    const c = caller(id);
    await expect(c.messaging.supervision({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      c.messaging.review({ id: "unknown", reason: "Unauthorized review" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      c.messaging.moderate({
        id: "unknown",
        hide: true,
        reason: "Unauthorized moderation",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      c.messaging.restrict({
        userId: "alice",
        restricted: true,
        reason: "Unauthorized restriction",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      c.messaging.setPermission({
        target: { type: "ROLE", role: "STUDENT" },
        groups: ["ALL_USERS"],
        reason: "Unauthorized settings",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);
it("audits inspection and reversible moderation without touching participant read state", async () => {
  await caller("coordinator", "COORDINATOR").messaging.send(send(["alice"]));
  const message = await db.directMessage.findFirstOrThrow();
  const supervisor = caller("admin", "ADMIN");
  expect(
    (await supervisor.messaging.supervision({ search: "Synthetic" })).rows,
  ).toHaveLength(1);
  expect(
    (await supervisor.messaging.supervision({})).rows[0],
  ).not.toHaveProperty("body");
  expect(
    await supervisor.messaging.review({
      id: message.id,
      reason: "Review reported concern",
    }),
  ).toMatchObject({ body: message.body });
  await supervisor.messaging.markRead({ id: message.id });
  expect(
    (await db.directMessage.findUniqueOrThrow({ where: { id: message.id } }))
      .readAt,
  ).toBeNull();
  const hide = {
    id: message.id,
    hide: true,
    reason: "Inappropriate content confirmed",
  };
  await supervisor.messaging.moderate(hide);
  await supervisor.messaging.moderate(hide);
  expect(await db.messageModeration.count({ where: { action: "HIDE" } })).toBe(
    1,
  );
  expect(await caller("alice").messaging.inbox({})).toMatchObject([
    { body: null },
  ]);
  expect(
    (
      await supervisor.messaging.review({
        id: message.id,
        reason: "Verify retained evidence",
      })
    ).body,
  ).toBe(message.body);
  await supervisor.messaging.moderate({
    ...hide,
    hide: false,
    reason: "Restore after reconsideration",
  });
  expect(await caller("alice").messaging.inbox({})).toMatchObject([
    { body: message.body },
  ]);
  await caller("alice").messaging.markRead({ id: message.id });
  expect(
    (await db.directMessage.findUniqueOrThrow({ where: { id: message.id } }))
      .readAt,
  ).not.toBeNull();
  expect(
    await db.auditLog.count({
      where: { operation: "messaging.moderate", entity: "DirectMessage" },
    }),
  ).toBe(2);
  expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(
    message.body,
  );
});
it("restricts messaging separately from historical reading and restores permissions with evidence", async () => {
  await caller().messaging.send(send(["alice"]));
  const input = {
    userId: "alice",
    restricted: true,
    reason: "Repeated misuse confirmed",
  };
  await caller().messaging.restrict(input);
  await caller().messaging.restrict(input);
  expect(
    await db.messageModeration.count({ where: { action: "RESTRICT" } }),
  ).toBe(1);
  expect(await contacts()).toEqual([]);
  expect(
    (await caller().messaging.recipients({ search: "alice" })).people,
  ).toEqual([]);
  expect(await caller("alice").messaging.inbox({})).toHaveLength(1);
  await expect(
    caller("alice").messaging.send(send(["head"])),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller().messaging.restrict({
    ...input,
    restricted: false,
    reason: "Restriction reviewed and lifted",
  });
  expect(await contacts()).toContain("head");
});
it("filters both directions of one conversation without sibling deliveries or legacy messages", async () => {
  await caller().messaging.send(send(["alice", "bob"]));
  await caller("alice").messaging.send(send(["head"]));
  await caller("admin").messaging.send(send(["alice"]));
  await db.directMessage.create({
    data: {
      senderId: "head",
      recipientId: "alice",
      body: "Historical context remains private",
      clientKey: crypto.randomUUID(),
    },
  });
  const result = await caller("admin").messaging.supervision({
    conversation: { first: "head", second: "alice" },
  });
  expect(result.rows).toHaveLength(2);
  expect(
    result.rows.map((r) => `${r.senderId}:${r.recipientId}`).sort(),
  ).toEqual(["alice:head", "head:alice"]);
});
it("uses retained explicit student ownership across intake pointers, never matching emails", async () => {
  await db.studentProfileOwnership.create({
    data: { userId: "alice", tuteeId: "alice-profile" },
  });
  await db.user.update({ where: { id: "alice" }, data: { studentId: null } });
  await setGroups(["CURRENT_TUTORS", "PAST_TUTORS"]);
  expect(await contacts()).toEqual(["current-tutor", "past-tutor"]);
  await db.tutee.update({
    where: { id: "alice-profile" },
    data: { email: "other@example.test" },
  });
  expect(await contacts("other")).toEqual(["unrelated-tutor"]);
});

it("runs the actual upgrade without exposing existing or old-writer messages and backfills only evidence", async () => {
  const connection = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await connection.connect();
  try {
    // Transactional scratch schema keeps the real isolated test schema untouched by this rehearsal.
    await connection.query(
      "BEGIN; CREATE SCHEMA messaging_upgrade_rehearsal; SET LOCAL search_path TO messaging_upgrade_rehearsal",
    );
    await connection.query(`
      CREATE TABLE "DirectMessage" (id TEXT PRIMARY KEY, body TEXT, "senderId" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "Pairing" (id TEXT PRIMARY KEY, "tutorId" TEXT);
      CREATE TABLE "PairingTutee" ("pairingId" TEXT, "tuteeId" TEXT);
      CREATE TABLE "Session" (id TEXT PRIMARY KEY, "tutorId" TEXT);
      CREATE TABLE "SessionTutee" ("sessionId" TEXT, "tuteeId" TEXT);
      INSERT INTO "DirectMessage" (id, body) VALUES ('before', 'Pre-upgrade private text');
      INSERT INTO "Pairing" VALUES ('p', 'tutor-one');
      INSERT INTO "PairingTutee" VALUES ('p', 'student-one');
      INSERT INTO "Session" VALUES ('s', 'tutor-two');
      INSERT INTO "SessionTutee" VALUES ('s', 'student-two');
    `);
    await connection.query(
      readFileSync(
        "prisma/migrations/20260913020000_supervised_messaging/migration.sql",
        "utf8",
      ),
    );
    await connection.query(
      `INSERT INTO "DirectMessage" (id, body) VALUES ('old-writer', 'Old app after migration')`,
    );
    const messages = await connection.query<{ supervisable: boolean }>(
      'SELECT supervisable FROM "DirectMessage"',
    );
    expect(messages.rows.map((r) => r.supervisable)).toEqual([false, false]);
    const assignments = await connection.query<{ source: string }>(
      'SELECT source FROM "MessageTutorAssignment" ORDER BY source',
    );
    expect(assignments.rows.map((r) => r.source)).toEqual([
      "ATTENDANCE_BACKFILL",
      "PAIRING_BACKFILL",
    ]);
    await connection.query(
      `UPDATE "Pairing" SET "tutorId"='replacement' WHERE id='p'; DELETE FROM "PairingTutee"`,
    );
    expect(
      (await connection.query('SELECT * FROM "MessageTutorAssignment"'))
        .rowCount,
    ).toBe(3);
  } finally {
    await connection.query("ROLLBACK");
    await connection.end();
  }
});
