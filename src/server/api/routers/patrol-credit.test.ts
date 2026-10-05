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

it("returns the original award for simultaneous identical retries, even after a correction", async () => {
  const original = input();
  const results = await Promise.all(Array.from({ length: 3 }, () => caller().crew.submitPatrol(original)));
  expect(results).toEqual(Array.from({ length: 3 }, () => results[0]));
  expect(results[0]?.hours).toBe(0.5);
  expect(await db.patrol.count()).toBe(1);
  const before = await db.patrol.findUniqueOrThrow({ where: { id: results[0]!.id }, include: { observations: true } });
  await caller(headId, "HEAD").corrections.correctPatrol({
    id: before.id, expectedUpdatedAt: before.updatedAt, reason: "Correct count", note: "Reviewed",
    observations: before.observations.map((row) => ({ id: row.id, roomId, headcount: "TWO", observedAt: row.observedAt })),
  });
  vi.setSystemTime(new Date(Date.now() + PATROL_CREDIT_INTERVAL_MS));
  expect(await caller().crew.submitPatrol(original)).toEqual(results[0]);
  expect(await db.patrol.count()).toBe(1);
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
  vi.setSystemTime(new Date("2026-09-01T08:20:00Z"));
  const original = input();
  const first = await caller(otherId).crew.submitPatrol(original);
  const snapshot = await db.patrol.findUniqueOrThrow({ where: { id: first.id }, include: { observations: true, creditWindows: true } });
  const pair = { survivorId: crewId, duplicateId: otherId };
  const preview = await previewCombine(db, pair);
  expect(preview.conflicts).toEqual([]);
  await caller(headId, "HEAD").accountCombine.combine({ ...pair, fingerprint: preview.fingerprint, confirmPassword: password });
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0);
  expect(await caller().crew.patrolConfig()).toMatchObject({ myHours: 0.5, myPatrols: 2 });
  expect(await db.patrolCreditWindow.findFirst()).toMatchObject({ crewUserId: otherId });
  await expect(caller(otherId).crew.submitPatrol(input())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await db.patrol.findUniqueOrThrow({ where: { id: first.id }, include: { observations: true, creditWindows: true } })).toEqual(snapshot);
  vi.setSystemTime(new Date("2026-09-01T08:40:00Z"));
  expect((await caller().crew.submitPatrol({ ...original, submissionKey: randomUUID() })).hours).toBe(0);
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0.5);
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

it("round-trips corrected credit reservations, with idempotent archive retries and original timestamps", async () => {
  vi.setSystemTime(new Date("2026-09-01T08:20:00Z"));
  const first = await caller().crew.submitPatrol(input());
  const before = await db.patrol.findUniqueOrThrow({ where: { id: first.id }, include: { observations: true } });
  await caller(headId, "HEAD").corrections.correctPatrol({
    id: before.id, expectedUpdatedAt: before.updatedAt, reason: "Correct device clock", note: "Reviewed",
    observations: before.observations.map((row) => ({ id: row.id, roomId, headcount: "TWO", observedAt: new Date("2026-09-01T08:19:59Z") })),
  });
  const saved = await db.patrol.findUniqueOrThrow({ where: { id: first.id }, include: { observations: true, creditWindows: { orderBy: { windowStart: "asc" } } } });
  const staff = caller(headId, "HEAD");
  const archive = await staff.recordTransfer.export({});
  const files = archive.files.filter((file) => ["Patrol.csv", "PatrolObservation.csv", "PatrolCreditWindow.csv"].includes(file.name));
  // Existing archives must compare composite timestamp keys by their database type.
  const retry = await staff.recordTransfer.preview({ files });
  expect(retry.summary.every((row) => row.created === 0)).toBe(true);
  await staff.recordTransfer.import({ files, ticket: retry.ticket });
  // Simulate restoration into empty patrol tables while keeping the explicit account references.
  await db.patrol.deleteMany();
  const restore = await staff.recordTransfer.preview({ files });
  expect(await db.patrol.count()).toBe(0);
  await staff.recordTransfer.import({ files, ticket: restore.ticket });
  const restored = await db.patrol.findUniqueOrThrow({ where: { id: first.id }, include: { observations: true, creditWindows: { orderBy: { windowStart: "asc" } } } });
  expect(restored).toEqual(saved);
  vi.setSystemTime(new Date("2026-09-01T08:40:00Z"));
  expect((await caller().crew.submitPatrol(input(new Date("2026-09-01T08:20:00Z")))).hours).toBe(0);
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0.5);
});

it("rejects an archive reservation assigned to a different patrol author and rolls back", async () => {
  const first = await caller().crew.submitPatrol(input());
  const claim = { crewUserId: otherId, patrolId: first.id, windowStart: "2026-09-01T08:20:00.000Z" };
  const files = [{ name: "PatrolCreditWindow.csv", text: recordCsv(Object.keys(claim), [claim]) }];
  await expect(caller(headId, "HEAD").recordTransfer.preview({ files })).rejects.toThrow(/credit owner must match/);
  expect(await db.patrolCreditWindow.count()).toBe(1);
});

it("restores overlapping legacy awards and an observation-free patrol without changing historical totals", async () => {
  const patrols = [
    { id: "first", crewUserId: crewId, hours: 0.5, createdAt: "2026-09-01T08:10:00.000Z", updatedAt: "2026-09-01T08:30:00.000Z" },
    { id: "duplicate", crewUserId: crewId, hours: 1, createdAt: "2026-09-01T08:11:00.000Z", updatedAt: "2026-09-01T08:11:00.000Z" },
    { id: "empty", crewUserId: crewId, hours: 1.5, createdAt: "2026-09-01T08:20:00.000Z", updatedAt: "2026-09-01T08:20:00.000Z" },
    { id: "zero", crewUserId: otherId, hours: 0, createdAt: "2026-09-01T08:40:00.000Z", updatedAt: "2026-09-01T08:40:00.000Z" },
  ];
  const observations = [
    { id: "first-observation", patrolId: "first", roomId, headcount: "ONE", observedAt: "2026-09-01T08:00:00.000Z" },
    { id: "duplicate-observation", patrolId: "duplicate", roomId, headcount: "TWO", observedAt: "2026-09-01T08:19:59.999Z" },
  ];
  const files = [
    { name: "Patrol.csv", text: recordCsv(Object.keys(patrols[0]!), patrols) },
    { name: "PatrolObservation.csv", text: recordCsv(Object.keys(observations[0]!), observations) },
  ];
  const staff = caller(headId, "HEAD");
  const preview = await staff.recordTransfer.preview({ files });
  await staff.recordTransfer.import({ files, ticket: preview.ticket });
  expect(await db.patrolCreditWindow.findMany({ orderBy: { windowStart: "asc" }, select: { patrolId: true, windowStart: true } })).toEqual([
    { patrolId: "first", windowStart: new Date("2026-09-01T08:00:00Z") },
    { patrolId: "empty", windowStart: new Date("2026-09-01T08:20:00Z") },
  ]);
  for (const patrol of patrols) {
    expect(await db.patrol.findUniqueOrThrow({ where: { id: patrol.id } })).toMatchObject({
      ...patrol, createdAt: new Date(patrol.createdAt), updatedAt: new Date(patrol.updatedAt),
      creditAwardedAt: patrol.hours > 0 ? new Date(patrol.createdAt) : null,
    });
  }
  expect((await caller().crew.patrolConfig()).myHours).toBe(3);
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

it.each(["explicit", "default hours", "default creation time"] as const)("retries explicit-null legacy patrol credit with %s values without reopening evidence or changing timestamps", async (mode) => {
  const patrol = {
    id: "null-credit-patrol", crewUserId: crewId,
    ...(mode === "default hours" ? {} : { hours: 0.5 }),
    creditAwardedAt: null,
    ...(mode === "default creation time" ? {} : { createdAt: new Date().toISOString() }),
    updatedAt: new Date().toISOString(),
  };
  const observation = { id: "null-credit-observation", patrolId: patrol.id, roomId, headcount: "ONE", observedAt: new Date().toISOString() };
  const files = [
    { name: "Patrol.csv", text: recordCsv(Object.keys(patrol), [patrol]) },
    { name: "PatrolObservation.csv", text: recordCsv(Object.keys(observation), [observation]) },
  ];
  const staff = caller(headId, "HEAD");
  const preview = await staff.recordTransfer.preview({ files });
  await staff.recordTransfer.import({ files, ticket: preview.ticket });
  const before = await db.patrol.findUniqueOrThrow({ where: { id: patrol.id }, include: { creditWindows: true } });
  expect(before.creditAwardedAt).toEqual(before.createdAt);
  expect(before.creditWindows).toHaveLength(1);
  expect(before.hours).toBe(0.5);
  expect(before.updatedAt.toISOString()).toBe(patrol.updatedAt);
  const retry = await staff.recordTransfer.preview({ files });
  expect(retry.summary.every((row) => row.created === 0)).toBe(true);
  await staff.recordTransfer.import({ files, ticket: retry.ticket });
  expect(await db.patrol.findUnique({ where: { id: patrol.id }, include: { creditWindows: true } })).toEqual(before);
  expect((await caller().crew.submitPatrol(input())).hours).toBe(0);
  expect(await caller().crew.patrolConfig()).toMatchObject({ myHours: 0.5 });
});

it("retains explicit-null zero-credit archives without inventing award evidence", async () => {
  const patrol = { id: "uncredited-patrol", crewUserId: crewId, hours: 0, creditAwardedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const files = [{ name: "Patrol.csv", text: recordCsv(Object.keys(patrol), [patrol]) }];
  const staff = caller(headId, "HEAD");
  const preview = await staff.recordTransfer.preview({ files });
  await staff.recordTransfer.import({ files, ticket: preview.ticket });
  const retry = await staff.recordTransfer.preview({ files });
  expect(retry.summary).toEqual([{ table: "Patrol", created: 0, skipped: 1 }]);
  await staff.recordTransfer.import({ files, ticket: retry.ticket });
  expect(await db.patrol.findUnique({ where: { id: patrol.id }, include: { creditWindows: true } })).toMatchObject({
    hours: 0, creditAwardedAt: null, creditWindows: [],
  });
  // Omitted columns remain unspecified for existing records, even though new
  // patrols would receive the schema's positive-hours default.
  const { hours: _hours, ...partial } = patrol;
  void _hours;
  expect((await staff.recordTransfer.preview({
    files: [{ name: "Patrol.csv", text: recordCsv(Object.keys(partial), [partial]) }],
  })).summary).toEqual([{ table: "Patrol", created: 0, skipped: 1 }]);
});

it("does not treat explicit-null patrol credit as a wildcard for a different award time", async () => {
  const patrol = await db.patrol.create({ data: {
    id: "different-award", crewUserId: crewId, hours: 0.5,
    createdAt: new Date("2026-09-01T07:00:00Z"), creditAwardedAt: new Date("2026-09-01T08:00:00Z"),
  } });
  const row = { id: patrol.id, crewUserId: crewId, hours: 0.5, creditAwardedAt: null, createdAt: patrol.createdAt.toISOString(), updatedAt: patrol.updatedAt.toISOString() };
  await expect(caller(headId, "HEAD").recordTransfer.preview({
    files: [{ name: "Patrol.csv", text: recordCsv(Object.keys(row), [row]) }],
  })).rejects.toThrow("This ID already exists with different values");
  expect(await db.patrol.findUnique({ where: { id: patrol.id } })).toEqual(patrol);
});
