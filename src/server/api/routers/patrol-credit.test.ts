import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { PATROL_CREDIT_INTERVAL_MS } from "~/server/crew/patrol-credit";
import { hashPassword } from "~/server/auth/password";
import { previewCombine } from "~/server/combine-accounts";
import * as credit from "~/server/crew/patrol-credit";
import { recordCsv } from "~/lib/record-transfer";
import * as transactions from "~/server/transactions";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test") throw Error("Use shbs_shipping_test");
let crewId: string, otherId: string, headId: string, roomId: string, otherRoomId: string;
const password = "Patrol-test-password!";
const caller = (id = crewId, role: Session["role"] = "CREW") => createCaller({
  db, headers: new Headers(), session: { user: { id }, role, tutorId: null, expires: "2099-01-01" },
});
const input = (time: Date | undefined = new Date()) => ({
  submissionKey: randomUUID(), observations: [{ roomId, headcount: "ONE" as const, observedAt: time }],
});
// Test barriers use the project's existing Promise library target, not newer runtime-only APIs.
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => { resolve = ready; });
  return { promise, resolve };
}
beforeEach(async () => {
  // Network and driver timers remain real. Only the server clock advances between awards.
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-01T08:19:59Z"));
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  const crew = await db.user.create({ data: { email: "crew@example.test", role: "CREW", crewStatus: "ACTIVE", passwordHash: hashPassword(password), emailVerifiedAt: new Date() } });
  crewId = crew.id;
  otherId = (await db.user.create({ data: { email: "other@example.test", role: "CREW", crewStatus: "ACTIVE" } })).id;
  headId = (await db.user.create({ data: { email: "head@example.test", role: "HEAD", passwordHash: hashPassword(password) } })).id;
  roomId = (await db.room.create({ data: { name: "First" } })).id;
  otherRoomId = (await db.room.create({ data: { name: "Second" } })).id;
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

it("retains same-key retries, rejects changed retry payloads and awards fresh-key replays no hours", async () => {
  const original = input();
  const first = await caller().crew.submitPatrol(original);
  expect(first.hours).toBe(0.5);
  expect(await caller().crew.submitPatrol(original)).toEqual(first);
  await expect(caller().crew.submitPatrol({ ...original, note: "changed" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await caller().crew.submitPatrol({ ...original, submissionKey: randomUUID(), note: "different", observations: [{ ...original.observations[0]!, headcount: "FOUR_PLUS" }] })).hours).toBe(0);
  expect(await db.patrol.count()).toBe(2);
  expect(await caller().crew.patrolConfig()).toMatchObject({ myPatrols: 2, myHours: 0.5 });
  expect((await caller(headId, "HEAD").admin.crewRoster()).find((row) => row.id === crewId)).toMatchObject({ patrols: 2, hours: 0.5 });
  expect(await caller(headId, "HEAD").admin.crewSummary()).toMatchObject({ patrols: 2, hours: 0.5 });
});

it("serializes fresh-key concurrent awards and leaves another crew member independent", async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => caller().crew.submitPatrol(input())));
  expect(results.reduce((sum, row) => sum + row.hours, 0)).toBe(0.5);
  expect(await db.patrolCreditWindow.count({ where: { crewUserId: crewId } })).toBe(1);
  expect((await caller(otherId).crew.submitPatrol(input())).hours).toBe(0.5);
});

it("uses server elapsed time for omitted/backdated timestamps and blocks boundary splitting", async () => {
  const omitted = { submissionKey: randomUUID(), observations: [{ roomId, headcount: "ONE" as const }] };
  expect((await caller().crew.submitPatrol(omitted)).hours).toBe(0.5);
  vi.setSystemTime(new Date("2026-09-01T08:20:00Z"));
  expect((await caller().crew.submitPatrol({ ...omitted, submissionKey: randomUUID() })).hours).toBe(0);
  for (const time of ["2026-08-01", "2026-09-01T08:10:00Z"])
    expect((await caller().crew.submitPatrol(input(new Date(time)))).hours).toBe(0);
  vi.setSystemTime(new Date("2026-09-01T08:39:59Z"));
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0.5);
  expect((await caller().crew.patrolConfig()).myHours).toBe(1);
});

it("keeps historical evidence without automatic awards, and keeps the future-time guard", async () => {
  expect((await caller().crew.submitPatrol(input(new Date("2020-01-01")))).hours).toBe(0);
  expect(await db.patrolObservation.count()).toBe(1);
  await expect(caller().crew.submitPatrol(input(new Date(Date.now() + 60_001)))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0.5); // old evidence consumed no award
});

it("reserves all intervals of a multi-room sweep for just one credit and prevents subset replays", async () => {
  vi.setSystemTime(new Date("2026-09-01T08:20:00Z"));
  const observations = [
    { roomId, headcount: "ONE" as const, observedAt: new Date("2026-09-01T08:19:59Z") },
    { roomId: otherRoomId, headcount: "TWO" as const, observedAt: new Date("2026-09-01T08:20:00Z") },
  ];
  expect((await caller().crew.submitPatrol({ submissionKey: randomUUID(), observations })).hours).toBe(0.5);
  expect(await db.patrolCreditWindow.count()).toBe(2);
  vi.setSystemTime(new Date("2026-09-01T08:40:00Z"));
  expect((await caller().crew.submitPatrol({ submissionKey: randomUUID(), observations: [observations[1]!] })).hours).toBe(0);
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0.5);
});

it("corrections preserve hours and old reservations while reserving corrected evidence", async () => {
  const first = await caller().crew.submitPatrol(input());
  vi.setSystemTime(new Date(Date.now() + PATROL_CREDIT_INTERVAL_MS));
  const before = await db.patrol.findUniqueOrThrow({ where: { id: first.id }, include: { observations: true } });
  await caller(headId, "HEAD").corrections.correctPatrol({
    id: before.id, expectedUpdatedAt: before.updatedAt, reason: "Corrected observation clock", note: null,
    observations: before.observations.map((row) => ({ id: row.id, roomId: row.roomId, headcount: "TWO", observedAt: new Date() })),
  });
  expect(await db.patrolCreditWindow.count()).toBe(2);
  const after = await db.patrol.findUniqueOrThrow({ where: { id: first.id } });
  expect(after.hours).toBe(before.hours);
  expect(after.creditAwardedAt).toEqual(before.creditAwardedAt);
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0);
});

it("checks combined account history without rewriting original authors or reopening credit", async () => {
  await caller(otherId).crew.submitPatrol(input());
  const pair = { survivorId: crewId, duplicateId: otherId };
  const preview = await previewCombine(db, pair);
  expect(preview.conflicts).toEqual([]);
  await caller(headId, "HEAD").accountCombine.combine({ ...pair, fingerprint: preview.fingerprint, confirmPassword: password });
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0);
  expect(await caller().crew.patrolConfig()).toMatchObject({ myHours: 0.5, myPatrols: 2 });
  expect(await db.patrolCreditWindow.findFirst()).toMatchObject({ crewUserId: otherId });
  await expect(caller(otherId).crew.submitPatrol(input())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("rolls back award time, reservations and observations together when later work fails", async () => {
  const reserve = credit.reservePatrolEvidence;
  const spy = vi.spyOn(credit, "reservePatrolEvidence").mockImplementationOnce(async (...args) => {
    await reserve(...args);
    throw Error("Injected failure after reserving evidence");
  });
  try {
    await expect(caller().crew.submitPatrol(input())).rejects.toThrow(/Injected failure/);
  } finally { spy.mockRestore(); }
  expect(await db.patrol.count()).toBe(0);
  expect(await db.patrolCreditWindow.count()).toBe(0);
  expect(await db.patrolObservation.count()).toBe(0);
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0.5);
});

it("exports credit history and backfills legacy archive reservations without rewriting timestamps", async () => {
  const oldPatrol = { id: "archived-patrol", crewUserId: crewId, hours: 0.5, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const oldObservation = { id: "archived-observation", patrolId: oldPatrol.id, roomId, headcount: "ONE", observedAt: new Date().toISOString() };
  const files = [
    { name: "Patrol.csv", text: recordCsv(Object.keys(oldPatrol), [oldPatrol]) },
    { name: "PatrolObservation.csv", text: recordCsv(Object.keys(oldObservation), [oldObservation]) },
  ];
  const staff = caller(headId, "HEAD");
  const preview = await staff.recordTransfer.preview({ files });
  expect(await db.patrol.count()).toBe(0);
  expect(await db.patrolCreditWindow.count()).toBe(0);
  await staff.recordTransfer.import({ files, ticket: preview.ticket });
  expect(await db.patrolCreditWindow.count()).toBe(1);
  const saved = await db.patrol.findUniqueOrThrow({ where: { id: oldPatrol.id } });
  expect(saved.updatedAt.toISOString()).toBe(oldPatrol.updatedAt);
  expect(saved.creditAwardedAt?.toISOString()).toBe(oldPatrol.createdAt);
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0);
  const archive = await staff.recordTransfer.export({});
  expect(archive.files.find((file) => file.name === "PatrolCreditWindow.csv")?.text).toContain(oldPatrol.id);
});

it("waits for an in-flight correction before deciding whether its corrected interval can earn credit", async () => {
  const first = await caller().crew.submitPatrol(input());
  vi.setSystemTime(new Date(Date.now() + PATROL_CREDIT_INTERVAL_MS));
  const before = await db.patrol.findUniqueOrThrow({ where: { id: first.id }, include: { observations: true } });
  const held = signal();
  const release = signal();
  const submitting = signal();
  const lockOwner = credit.lockPatrolCreditOwner;
  // Pause a real transaction after acquiring its account locks, before reserving new evidence.
  const spy = vi.spyOn(credit, "lockPatrolCreditOwner").mockImplementation(async (...args) => {
    if (!args[2]) submitting.resolve();
    const ids = await lockOwner(...args);
    if (args[2]) { held.resolve(); await release.promise; }
    return ids;
  });
  const correction = caller(headId, "HEAD").corrections.correctPatrol({
    id: before.id, expectedUpdatedAt: before.updatedAt, reason: "Correct observation time", note: null,
    observations: before.observations.map((row) => ({ id: row.id, roomId, headcount: "TWO", observedAt: new Date() })),
  });
  let submission: ReturnType<ReturnType<typeof caller>["crew"]["submitPatrol"]> | undefined;
  let completed = false;
  try {
    await held.promise;
    submission = caller().crew.submitPatrol(input()).then((result) => { completed = true; return result; });
    await submitting.promise;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(completed).toBe(false);
    release.resolve();
    await correction;
    expect((await submission).hours).toBe(0);
    expect((await caller().crew.patrolConfig()).myHours).toBe(0.5);
  } finally {
    release.resolve(); await Promise.allSettled([correction, ...(submission ? [submission] : [])]); spy.mockRestore();
  }
});

it("fences a correction waiting behind account combination, then permits retry with the retained author", async () => {
  const first = await caller(otherId).crew.submitPatrol(input());
  const before = await db.patrol.findUniqueOrThrow({ where: { id: first.id }, include: { observations: true } });
  const pair = { survivorId: crewId, duplicateId: otherId };
  const preview = await previewCombine(db, pair);
  const held = signal();
  const release = signal();
  const correcting = signal();
  const lockEntity = transactions.lockEntity;
  let firstLock = true;
  const spy = vi.spyOn(transactions, "lockEntity").mockImplementation(async (tx, key) => {
    const pause = key === `account-profile:${otherId}` && firstLock;
    if (pause) firstLock = false;
    else if (key === `account-profile:${otherId}`) correcting.resolve();
    await lockEntity(tx, key);
    if (pause) { held.resolve(); await release.promise; }
  });
  const combining = caller(headId, "HEAD").accountCombine.combine({ ...pair, fingerprint: preview.fingerprint, confirmPassword: password });
  const correctionInput = {
    id: before.id, expectedUpdatedAt: before.updatedAt, reason: "Correct count after account combine", note: null,
    observations: before.observations.map((row) => ({ id: row.id, roomId, headcount: "TWO" as const, observedAt: row.observedAt })),
  };
  let correction: Promise<{ ok: true } | { error: unknown }> | undefined;
  let completed = false;
  try {
    await held.promise;
    correction = caller(headId, "HEAD").corrections.correctPatrol(correctionInput)
      .then(() => { completed = true; return { ok: true as const }; }, (error: unknown) => ({ error }));
    await correcting.promise;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(completed).toBe(false);
    release.resolve();
    await combining;
    expect(await correction).toMatchObject({ error: { code: "CONFLICT" } });
    await caller(headId, "HEAD").corrections.correctPatrol(correctionInput);
    expect((await caller().crew.submitPatrol(input())).hours).toBe(0);
    expect((await caller().crew.patrolConfig()).myHours).toBe(0.5);
    expect(await db.patrol.findUnique({ where: { id: first.id } })).toMatchObject({ crewUserId: otherId });
  } finally {
    release.resolve(); await Promise.allSettled([combining, ...(correction ? [correction] : [])]); spy.mockRestore();
  }
});
