import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

async function caller(id: string, role: Session["role"] = "ADMIN") {
  const account = await db.user.findUniqueOrThrow({ where: { id }, select: { historyAccessRevision: true } });
  return createCaller({ db, headers: new Headers(), session: {
    user: { id, name: `Synthetic ${id}`, email: `${id}@example.test` },
    role, tutorId: null, expires: "2099-01-01", historyAccessRevision: account.historyAccessRevision,
  } });
}

async function clearFixture() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
}

async function assign(sourceUserId: string, readerUserId: string | null) {
  const state = readerUserId ? "ASSIGNED" : "QUARANTINED";
  await db.retiredHistoryOwnership.upsert({
    where: { sourceUserId }, create: { sourceUserId, readerUserId, state },
    update: { readerUserId, state, revision: { increment: 1 } },
  });
}

beforeEach(async () => {
  await clearFixture();
  (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore?.clear();
  await db.term.create({ data: { id: "term", name: "Synthetic current term", schoolYear: "26-27", quarter: "Q1", active: true } });
  for (const id of ["head", "D", "C", "unrelated"])
    await db.user.create({ data: { id, email: `${id}@example.test`, username: `synthetic-${id.toLowerCase()}`, name: `Synthetic ${id}`, role: id === "head" ? "HEAD" : "ADMIN" } });
  await db.user.create({ data: { id: "A", email: "a@example.test", name: "Original A", username: "original-a", role: "STUDENT" } });
  await db.user.create({ data: { id: "B", email: "b@example.test", name: "Original B", username: "original-b", role: "STUDENT", mergedIntoId: "A" } });
  await db.user.update({ where: { id: "A" }, data: { mergedIntoId: "D" } });
  await assign("A", "D");
  await assign("B", "D");
  await db.directMessage.createMany({ data: [
    { id: "from-b", senderId: "B", recipientId: "head", body: "Synthetic original B conversation", clientKey: randomUUID(), supervisable: true },
    { id: "to-b", senderId: "head", recipientId: "B", body: "Synthetic private reply to original B", clientKey: randomUUID(), supervisable: true },
    { id: "from-a", senderId: "A", recipientId: "head", body: "Synthetic independent A conversation", clientKey: randomUUID(), supervisable: true },
  ] });
});
afterAll(async () => { await clearFixture(); await db.$disconnect(); });

it("moves only reviewed private messages while retaining the exact original authors and recipients", async () => {
  const originals = await db.directMessage.findMany({ orderBy: { id: "asc" } });
  expect((await (await caller("D")).messaging.inbox({})).map((row) => row.id).sort()).toEqual(["from-a", "from-b", "to-b"]);
  expect(await (await caller("C")).messaging.inbox({})).toEqual([]);
  await assign("B", "C");
  expect((await (await caller("D")).messaging.inbox({})).map((row) => row.id)).toEqual(["from-a"]);
  expect((await (await caller("C")).messaging.inbox({})).map((row) => row.id).sort()).toEqual(["from-b", "to-b"]);
  expect(await (await caller("unrelated")).messaging.inbox({})).toEqual([]);
  expect(await db.directMessage.findMany({ orderBy: { id: "asc" } })).toEqual(originals);
  await expect((await caller("B", "STUDENT")).messaging.inbox({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("routes replies to the corrected live reader while displaying the immutable sender identity", async () => {
  await assign("B", "C");
  const inbox = await (await caller("head", "HEAD")).messaging.inbox({});
  expect(inbox.find((row) => row.id === "from-b")).toMatchObject({ senderId: "B", sender: "Original B", senderUsername: "original-b", recipientId: "head", replyRecipientId: "C", canReply: true });
  expect(inbox.find((row) => row.id === "from-a")).toMatchObject({ senderId: "A", replyRecipientId: "D", canReply: true });
  const original = await db.directMessage.findUniqueOrThrow({ where: { id: "from-b" } });
  await (await caller("head", "HEAD")).messaging.send({ recipientIds: ["C"], body: "Synthetic new reply", clientKey: randomUUID(), disclosureVersion: 1 });
  expect(await db.directMessage.count({ where: { senderId: "head", recipientId: "C", body: "Synthetic new reply" } })).toBe(1);
  expect(await db.directMessage.findUniqueOrThrow({ where: { id: "from-b" } })).toEqual(original);
});

it("quarantines private access and reply destinations without hiding a correspondent's own message", async () => {
  await assign("B", null);
  expect((await (await caller("D")).messaging.inbox({})).map((row) => row.id)).toEqual(["from-a"]);
  expect(await (await caller("C")).messaging.inbox({})).toEqual([]);
  const original = (await (await caller("head", "HEAD")).messaging.inbox({})).find((row) => row.id === "from-b");
  expect(original).toMatchObject({ senderId: "B", sender: "Original B", replyRecipientId: null, canReply: false, body: "Synthetic original B conversation" });
});

it("only lets the corrected recipient mark original inbound messages read", async () => {
  await assign("B", "C");
  await (await caller("D")).messaging.markRead({ id: "to-b" });
  expect((await db.directMessage.findUniqueOrThrow({ where: { id: "to-b" } })).readAt).toBeNull();
  await (await caller("C")).messaging.markRead({ id: "to-b" });
  const read = await db.directMessage.findUniqueOrThrow({ where: { id: "to-b" } });
  expect(read.readAt).not.toBeNull();
  expect(read).toMatchObject({ senderId: "head", recipientId: "B", body: "Synthetic private reply to original B" });
  await (await caller("C")).messaging.markRead({ id: "from-b" });
  expect((await db.directMessage.findUniqueOrThrow({ where: { id: "from-b" } })).readAt).toBeNull();
});

it("rechecks current messaging restrictions independently from corrected history access", async () => {
  await assign("B", "C");
  await db.messageRestriction.create({ data: { userId: "C", restricted: true } });
  const original = (await (await caller("head", "HEAD")).messaging.inbox({})).find((row) => row.id === "from-b");
  expect(original).toMatchObject({ senderId: "B", replyRecipientId: "C", canReply: false });
  expect(await (await caller("C")).messaging.inbox({})).toHaveLength(2);
  await expect((await caller("head", "HEAD")).messaging.send({ recipientIds: ["C"], body: "Synthetic blocked reply", clientKey: randomUUID(), disclosureVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.directMessage.count()).toBe(3);
});

it("rejects a frozen pre-correction session for private reads and writes until reauthentication", async () => {
  const oldReader = await caller("D");
  const oldRecipient = await caller("C");
  await assign("B", "C");
  await expect(oldReader.messaging.inbox({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(oldReader.messaging.markRead({ id: "to-b" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(oldRecipient.messaging.inbox({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect((await db.directMessage.findUniqueOrThrow({ where: { id: "to-b" } })).readAt).toBeNull();
  const freshReader = await caller("D");
  const freshRecipient = await caller("C");
  expect((await freshReader.messaging.inbox({})).map((row) => row.id)).toEqual(["from-a"]);
  expect((await freshRecipient.messaging.inbox({})).map((row) => row.id).sort()).toEqual(["from-b", "to-b"]);
});
