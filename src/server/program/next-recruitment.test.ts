import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { parseProgramDateTime, programDateTimeInput } from "~/lib/program-time";
import type { PrepareNextRecruitmentInput } from "~/lib/next-recruitment";
import { inTransaction } from "~/server/transactions";
import {
  lockNextRecruitment,
  readNextRecruitment,
  saveNextRecruitment,
  validateNextRecruitmentRefresh,
  validateNextRecruitmentWrite,
} from "./next-recruitment";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const actor = { id: "next-recruitment-helper-head", name: "Preparation Head" };
const head = () => createCaller({ db, headers: new Headers(), session: {
  user: actor, role: "HEAD", tutorId: null, expires: "2099-01-01",
} });
const firstOpening = new Date("2027-01-12T02:00:00.000Z");

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.create({ data: { ...actor, role: "HEAD", username: "preparation-head" } });
  await db.term.create({ data: { id: "source", schoolYear: "26-27", quarter: "Q1",
    name: "26-27 Q1", active: true, signupEnabled: false, tutorSignupOpensAt: firstOpening } });
});
afterAll(() => db.$disconnect());

async function input(audience: "tutor" | "tutee" = "tutor", opensAt: Date | null = firstOpening): Promise<PrepareNextRecruitmentInput> {
  const snapshot = await readNextRecruitment(db);
  return { audience, opensAt, expectedTarget: snapshot.target,
    expectedVersion: snapshot.preparations[audience]?.version ?? 0, expectedTimeZone: snapshot.timeZone };
}

function gate() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
}

/** Observe the actual PostgreSQL wait, rather than assuming a timer proved serialization. */
async function waitForAdvisoryWait(pid: number) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid = ${pid}
        AND wait_event_type = 'Lock' AND wait_event = 'advisory') AS waiting`;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The expected period-lock waiter did not appear.");
}

it("stores independent opening overrides without creating history or altering current intake", async () => {
  const before = await db.term.findUniqueOrThrow({ where: { id: "source" } });
  const tutor = await input("tutor");
  const tutee = await input("tutee", null);
  await saveNextRecruitment(db, tutor, actor);
  // A sibling save changes its own version, never the captured Tutee editor version.
  await saveNextRecruitment(db, tutee, actor);
  expect(await db.term.count()).toBe(1);
  const after = await db.term.findUniqueOrThrow({ where: { id: "source" } });
  expect({ ...after, nextRecruitmentRevision: before.nextRecruitmentRevision }).toEqual(before);
  const snapshot = await readNextRecruitment(db);
  expect(snapshot.preparations.tutor).toMatchObject({ version: 1, opensAt: firstOpening, matchesTarget: true });
  expect(snapshot.preparations.tutee).toMatchObject({ version: 1, opensAt: null, matchesTarget: true });
  expect(await db.auditLog.count({ where: { operation: "program.prepareNextRecruitment" } })).toBe(2);
});

it("distinguishes no override from explicit clear and rejects an old clear after edit", async () => {
  expect((await readNextRecruitment(db)).refreshEvidence.preparations.tutor).toBeNull();
  await saveNextRecruitment(db, await input("tutor", null), actor);
  const old = await input("tutor", null);
  await saveNextRecruitment(db, { ...old, opensAt: firstOpening }, actor);
  await expect(saveNextRecruitment(db, old, actor)).rejects.toMatchObject({ code: "CONFLICT", message: "NEXT_RECRUITMENT_CHANGED" });
  expect((await readNextRecruitment(db)).preparations.tutor).toMatchObject({ version: 2, opensAt: firstOpening });
});

it("validates reused destination closing bounds only for the edited audience", async () => {
  await db.term.create({ data: { schoolYear: "26-27", quarter: "Q2", name: "Existing Q2",
    tutorSignupClosesAt: firstOpening, signupClosesAt: new Date("2027-01-13T02:00:00Z"),
    tutorSignupEnabled: false, signupPreviewUrl: "https://example.test/preview" } });
  await expect(saveNextRecruitment(db, await input(), actor)).rejects.toMatchObject({ message: "NEXT_RECRUITMENT_CLOSING_CONFLICT" });
  await saveNextRecruitment(db, await input("tutee"), actor);
  await saveNextRecruitment(db, await input("tutor", null), actor);
  const snapshot = await readNextRecruitment(db);
  expect(snapshot.refreshEvidence.destination?.tutor.enabled).toBe(false);
  await expect(inTransaction(db, (tx) => validateNextRecruitmentRefresh(tx, snapshot.refreshEvidence))).resolves.toMatchObject({ nextName: "26-27 Q2" });
});

it("retains absolute instants and original conversion evidence after a timezone change", async () => {
  const oldInput = await input("tutee");
  await saveNextRecruitment(db, await input(), actor);
  await head().program.setTimeZone({ expectedTimeZone: "Asia/Shanghai", timeZone: "America/New_York" });
  const snapshot = await readNextRecruitment(db);
  expect(snapshot.preparations.tutor).toMatchObject({ opensAt: firstOpening, timeZone: "Asia/Shanghai", matchesTarget: true });
  expect(programDateTimeInput(snapshot.preparations.tutor!.opensAt!, snapshot.timeZone)).toBe("2027-01-11T21:00");
  await expect(saveNextRecruitment(db, oldInput, actor)).rejects.toMatchObject({ message: "NEXT_RECRUITMENT_TIME_ZONE_CHANGED" });
});

it("uses explicit unambiguous DST conversion and accepts elapsed openings", async () => {
  expect(() => parseProgramDateTime("2026-03-08T02:30", "America/New_York")).toThrow("does not exist");
  expect(() => parseProgramDateTime("2026-11-01T01:30", "America/New_York")).toThrow("occurs twice");
  const elapsed = parseProgramDateTime("2020-01-01T08:00", "Asia/Shanghai");
  await expect(saveNextRecruitment(db, await input("tutor", elapsed), actor)).resolves.toMatchObject({ opensAt: elapsed });
});

it("does not revive stale preparation after mode A-to-B-to-A and permits reviewed replacement", async () => {
  await saveNextRecruitment(db, await input(), actor);
  const before = await readNextRecruitment(db);
  await head().program.setFeaturePending({ key: "QUARTER_SYSTEM", enabled: false });
  expect((await readNextRecruitment(db)).target.destinationQuarter).toBe("Q3");
  await head().program.setFeaturePending({ key: "QUARTER_SYSTEM", enabled: true });
  const returned = await readNextRecruitment(db);
  expect(returned.target.destinationQuarter).toBe("Q2");
  expect(returned.target.modeRevision).toBeGreaterThan(before.target.modeRevision);
  expect(returned.preparations.tutor?.matchesTarget).toBe(false);
  await expect(inTransaction(db, (tx) => validateNextRecruitmentRefresh(tx, returned.refreshEvidence))).rejects.toMatchObject({ message: "NEXT_RECRUITMENT_STALE_TARGET" });
  await saveNextRecruitment(db, await input("tutor", null), actor);
  expect((await readNextRecruitment(db)).preparations.tutor).toMatchObject({ version: 2, opensAt: null, matchesTarget: true });
});

it("rolls preparation, source fence and audit back together and permits the unchanged retry", async () => {
  const write = await input();
  await expect(inTransaction(db, async (tx) => {
    await saveNextRecruitment(tx, write, actor);
    throw new Error("rollback witness");
  })).rejects.toThrow("rollback witness");
  expect(await db.nextRecruitmentPreparation.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  expect((await db.term.findUniqueOrThrow({ where: { id: "source" } })).nextRecruitmentRevision).toBe(0);
  await expect(saveNextRecruitment(db, write, actor)).resolves.toMatchObject({ version: 1 });
});

it("admits exactly one of two simultaneous saves of the same expected audience version", async () => {
  const write = await input();
  const results = await Promise.allSettled([
    saveNextRecruitment(db, write, actor),
    saveNextRecruitment(db, { ...write, opensAt: null }, actor),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
  expect((await readNextRecruitment(db)).preparations.tutor?.version).toBe(1);
});

it.each(["preparation", "mode", "other-module"] as const)(
  "rejects a Serializable review pinned before a committed %s writer even after waiting on the period lock",
  async (writerKind) => {
    const review = await readNextRecruitment(db);
    const snapshotPinned = gate();
    const startReview = gate();
    const writerReady = gate();
    const commitWriter = gate();
    let reviewerPid = 0;
    // Pin a real old snapshot before the writer. The preparation table is empty here,
    // proving the durable source fence also covers the absent-row race.
    const reviewing = db.$transaction(async (tx) => {
      reviewerPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      await tx.term.findUniqueOrThrow({ where: { id: "source" } });
      snapshotPinned.release();
      await startReview.ready;
      return validateNextRecruitmentRefresh(tx, review.refreshEvidence);
    }, { isolationLevel: "Serializable", timeout: 10_000 }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    await snapshotPinned.ready;
    const writing = inTransaction(db, async (tx) => {
      await lockNextRecruitment(tx);
      if (writerKind === "preparation") {
        await saveNextRecruitment(tx, { audience: "tutor", opensAt: firstOpening,
          expectedTarget: review.target, expectedVersion: 0, expectedTimeZone: review.timeZone }, actor);
      } else {
        // Execute the real router through its enclosing database scope so the test
        // covers the production staging writer and its source-fence update.
        const { databaseScope } = await import("~/server/db-scope");
        await databaseScope.run(tx, () => head().program.setFeaturePending({
          key: writerKind === "mode" ? "QUARTER_SYSTEM" : "CREW", enabled: false,
        }));
      }
      writerReady.release();
      await commitWriter.ready;
    }).then(
      () => ({ status: "fulfilled" as const }),
      (reason: unknown) => { writerReady.release(); return { status: "rejected" as const, reason }; },
    );
    let observationError: unknown;
    try {
      await writerReady.ready;
      startReview.release();
      await waitForAdvisoryWait(reviewerPid);
    } catch (error) {
      observationError = error;
    } finally {
      startReview.release();
      commitWriter.release();
    }
    // Even a failed wait observation must settle both owned transactions before
    // the next fixture truncates tables; releasing gates alone does not await them.
    const [writerResult, reviewResult] = await Promise.all([writing, reviewing]);
    expect(observationError).toBeUndefined();
    expect(writerResult).toMatchObject({ status: "fulfilled" });
    expect(reviewResult).toMatchObject({ status: "rejected", reason: { code: "CONFLICT", message: "NEXT_RECRUITMENT_CHANGED" } });
    expect((await db.term.findUniqueOrThrow({ where: { id: "source" } })).active).toBe(true);
  },
);

it("binds saved source identity and validates year/semester destination boundaries", async () => {
  await db.term.update({ where: { id: "source" }, data: { quarter: "Q4" } });
  expect((await readNextRecruitment(db)).target).toMatchObject({ destinationSchoolYear: "27-28", destinationQuarter: "Q1" });
  await head().program.setFeaturePending({ key: "QUARTER_SYSTEM", enabled: false });
  expect((await readNextRecruitment(db)).target).toMatchObject({ semesterMode: true, destinationSchoolYear: "27-28", destinationQuarter: "Q1" });
  await saveNextRecruitment(db, await input(), actor);
  await db.term.update({ where: { id: "source" }, data: { quarter: "Q3" } });
  expect((await readNextRecruitment(db)).preparations.tutor?.matchesTarget).toBe(false);
});

it.each(["demoted", "suspended"])("refuses a %s direct actor after reading the preparation target", async (change) => {
  const write = await input();
  await db.user.update({ where: { id: actor.id }, data: change === "demoted"
    ? { role: "ADMIN" } : { suspendedAt: new Date() } });
  await expect(saveNextRecruitment(db, write, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.nextRecruitmentPreparation.count()).toBe(0);
  expect((await db.term.findUniqueOrThrow({ where: { id: "source" } })).nextRecruitmentRevision).toBe(0);
});

it("validates proposals without writing and rejects changed reused destination evidence", async () => {
  const write = await input();
  await inTransaction(db, (tx) => validateNextRecruitmentWrite(tx, write));
  expect(await db.nextRecruitmentPreparation.count()).toBe(0);
  const snapshot = await readNextRecruitment(db);
  await db.term.create({ data: { schoolYear: "26-27", quarter: "Q2", name: "Newly reused term" } });
  await expect(inTransaction(db, (tx) => validateNextRecruitmentRefresh(tx, snapshot.refreshEvidence))).rejects.toMatchObject({ message: "NEXT_RECRUITMENT_CHANGED" });
});
