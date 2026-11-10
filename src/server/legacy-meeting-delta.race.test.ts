import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { recordCsv, type TransferFile } from "~/lib/record-transfer";
import { utcDatabaseUrl } from "~/server/database-url";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

const headId = "meeting-delta-race-head";
const retainedDate = new Date("2024-09-24T06:00:00.000Z");
const retainedReason = "Synthetic retained meeting deduction";
let currentTermId: string;
let oldTermId: string;

const fixtureId = () => `c${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const deductionId = (meetingId: string, tutorId: string) =>
  `mtgabs_${meetingId}_${tutorId}`;
const staff = () => createCaller({
  db,
  headers: new Headers(),
  session: {
    user: { id: headId, name: "Synthetic race reviewer" },
    role: "HEAD",
    tutorId: null,
    sessionVersion: 0,
    historyAccessRevision: 0,
    expires: "2099-01-01T00:00:00Z",
  },
});

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " + tables.map(({ tablename }) =>
      '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE",
  );
  await db.user.create({ data: {
    id: headId, email: "meeting-delta-race-head@example.test", role: "HEAD",
    sessionVersion: 0, historyAccessRevision: 0,
  } });
  await db.programSettings.create({ data: {
    timeZone: "Asia/Shanghai", emailNotificationsEnabled: false,
  } });
  await db.programFeature.createMany({ data: [
    { key: "MEETINGS", enabled: true },
    { key: "SERVICE_HOURS", enabled: true },
    { key: "QUARTER_SYSTEM", enabled: true },
  ] });
  currentTermId = fixtureId();
  oldTermId = fixtureId();
  await db.term.createMany({ data: [
    { id: currentTermId, schoolYear: "26-27", quarter: "Q2", name: "Race current", active: true },
    { id: oldTermId, schoolYear: "24-25", quarter: "Q1", name: "Race retained" },
  ] });
});

afterAll(() => db.$disconnect());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function deadline<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 8_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const outcome = <T>(promise: Promise<T>): Promise<Outcome<T>> => promise.then(
  (value) => ({ ok: true as const, value }),
  (error: unknown) => ({ ok: false as const, error }),
);
function succeeded<T>(result: Outcome<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** Only driver transaction-conflict codes permit the separately asserted fresh
 * operation below. Ordinary CONFLICT, timeout, uniqueness and deadlock errors
 * are not accepted as a successful serial outcome. */
function serializationRejected(error: unknown): boolean {
  const codes: string[] = [];
  const inspect = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 5) return;
    const record = value as Record<string, unknown>;
    for (const key of ["code", "originalCode"]) {
      const code = record[key];
      if (typeof code === "string") codes.push(code);
    }
    for (const key of ["cause", "meta", "driverAdapterError"])
      inspect(record[key], depth + 1);
  };
  inspect(error, 0);
  // P2034 alone can also represent a deadlock. Require the actual serialization
  // SQLSTATE; an opaque conflict needs root diagnosis rather than a silent pass.
  return !codes.includes("40P01") && codes.includes("40001");
}

/** Pause the first genuine API transaction after its source/effects but before
 * commit. Observe the second backend actually blocked by it; no elapsed sleep
 * is accepted as evidence of overlap. The observer uses its own owned socket,
 * while the two API transactions require two Prisma pool connections.
 * The five composed-boundary cases intentionally use ReadCommitted outer
 * ownership, overriding nested API isolation options. They do not certify the
 * normal Serializable staff admission; the separate SSI case retains it. */
async function raceAtCommit<A, B>(
  firstWork: () => Promise<A>,
  secondWork: () => Promise<B>,
  firstIsolation: "ReadCommitted" | "Serializable" = "ReadCommitted",
  secondIsolation: "ReadCommitted" | "Serializable" = "ReadCommitted",
): Promise<{ first: Outcome<A>; second: Outcome<B> }> {
  const observer = new Client({
    connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
    connectionTimeoutMillis: 3_000,
    query_timeout: 3_000,
  });
  const held = deferred<number>();
  const release = deferred<void>();
  const started = deferred<number>();
  let first: Promise<Outcome<A>> | undefined;
  let second: Promise<Outcome<B>> | undefined;
  let secondFinished = false;
  let secondResult: Outcome<B> | undefined;
  try {
    await observer.connect();
    first = outcome(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '8s'");
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const value = await databaseScope.run(tx, firstWork);
      held.resolve(backend!.pid);
      await deadline(release.promise, "first transaction release");
      return value;
    }, { isolationLevel: firstIsolation, timeout: 15_000, maxWait: 5_000 }));
    const blockerPid = await deadline(Promise.race([
      held.promise,
      first.then((result) => {
        succeeded(result);
        throw new Error("First transaction finished before its commit barrier.");
      }),
    ]), "first API transaction reaching its commit barrier");

    second = outcome(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '8s'");
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      started.resolve(backend!.pid);
      return databaseScope.run(tx, secondWork);
    }, { isolationLevel: secondIsolation, timeout: 15_000, maxWait: 5_000 }));
    void second.then((result) => {
      secondResult = result;
      secondFinished = true;
    });
    const waiterPid = await deadline(Promise.race([
      started.promise,
      second.then((result) => {
        succeeded(result);
        throw new Error("Second transaction finished before its observation barrier.");
      }),
    ]), "second API transaction starting");
    await vi.waitUntil(async () => {
      if (secondFinished) {
        succeeded(secondResult!);
        throw new Error("Second API transaction did not wait for the first writer.");
      }
      const observation = await observer.query<{ waiting: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE pid=$1::int AND locktype='advisory' AND NOT granted
            AND $2::int=ANY(pg_blocking_pids($1::int))
        ) AS waiting`, [waiterPid, blockerPid]);
      return observation.rows[0]?.waiting === true;
    }, { timeout: 5_000, interval: 20 });
    expect(secondFinished).toBe(false);
    release.resolve();
    return { first: await first, second: await second };
  } finally {
    // Release before draining even when the wait assertion fails. Outcomes have
    // rejection handlers from admission, so no request leaks into the next reset.
    release.resolve();
    await Promise.all([...(first ? [first] : []), ...(second ? [second] : [])]);
    await observer.end();
  }
}

const nativeTutor = (lastName: string) => staff().admin.createTutor({
  firstName: "Synthetic", lastName, status: "ACTIVE",
});
const nativeMeeting = (index: number) => staff().admin.createMeeting({
  title: `Synthetic race meeting ${index}`,
  termId: currentTermId,
  date: new Date(Date.UTC(2026, 8, index + 1, 4)),
});

async function threeAbsences(tutorIds: string[]) {
  const meetings = [];
  for (let index = 0; index < 3; index++) {
    const meeting = await nativeMeeting(index);
    meetings.push(meeting);
    await staff().admin.recordMeetingAttendance({
      meetingId: meeting.id,
      entries: tutorIds.map((tutorId) => ({ tutorId, status: "UNEXCUSED_ABSENT" as const })),
    });
  }
  return meetings;
}

async function retainedControls(tutorIds: string[]) {
  const other = await nativeTutor("Untouched");
  const owners = [...tutorIds, other.id];
  const meetingIds = Array.from({ length: 4 }, fixtureId);
  await db.tutorMeeting.createMany({ data: meetingIds.map((id, index) => ({
    id, title: `Synthetic old race control ${index}`, termId: oldTermId,
    date: new Date(Date.UTC(2024, 8, 2 + index * 7, 4)),
  })) });
  await db.meetingAttendance.createMany({ data: owners.flatMap((tutorId) =>
    meetingIds.map((meetingId) => ({ meetingId, tutorId, status: "UNEXCUSED_ABSENT" as const }))) });
  const adjustmentIds: string[] = [];
  for (const tutorId of owners) {
    const retained = await db.serviceHourAdjustment.create({ data: {
      id: deductionId(meetingIds[3]!, tutorId), tutorId, month: "2024-09",
      schoolYear: "24-25", quarter: "Q1", type: "PUNISHMENT", amount: 1.5,
      reason: retainedReason, createdAt: retainedDate,
    } });
    const manual = await staff().admin.createAdjustment({
      tutorId, month: "2026-09", type: "EXTRA", amount: 0.75,
      reason: "Synthetic independent race credit",
    });
    adjustmentIds.push(retained.id, manual.id);
  }
  const attendance = await db.meetingAttendance.findMany({
    where: { meetingId: { in: meetingIds } }, orderBy: { id: "asc" },
  });
  const adjustments = await db.serviceHourAdjustment.findMany({
    where: { id: { in: adjustmentIds } }, orderBy: { id: "asc" },
  });
  return async () => {
    expect(await db.meetingAttendance.findMany({
      where: { meetingId: { in: meetingIds } }, orderBy: { id: "asc" },
    })).toEqual(attendance);
    expect(await db.serviceHourAdjustment.findMany({
      where: { id: { in: adjustmentIds } }, orderBy: { id: "asc" },
    })).toEqual(adjustments);
  };
}

async function expectCurrentDeductions(tutorIds: string[], meetingIds: string[]) {
  const rows = await db.serviceHourAdjustment.findMany({ where: {
    tutorId: { in: tutorIds }, schoolYear: "26-27", id: { startsWith: "mtgabs_" },
  } });
  expect(rows).toHaveLength(tutorIds.length * meetingIds.length);
  expect(rows).toEqual(expect.arrayContaining(tutorIds.flatMap((tutorId) =>
    meetingIds.map((meetingId): unknown => expect.objectContaining({
      id: deductionId(meetingId, tutorId), tutorId, type: "PUNISHMENT", amount: 0.25,
    })))));
}

it("[LMA25.staff-staff] serializes two real absence saves without rebuilding retained evidence", async () => {
  const tutor = await nativeTutor("StaffRace");
  const checkControls = await retainedControls([tutor.id]);
  await threeAbsences([tutor.id]);
  const fourth = await nativeMeeting(3);
  const fifth = await nativeMeeting(4);
  const save = (meetingId: string) => staff().admin.recordMeetingAttendance({
    meetingId, entries: [{ tutorId: tutor.id, status: "UNEXCUSED_ABSENT" }],
  });
  const result = await raceAtCommit(() => save(fourth.id), () => save(fifth.id));
  expect(succeeded(result.first)).toEqual({ ok: true });
  expect(succeeded(result.second)).toEqual({ ok: true });
  await expectCurrentDeductions([tutor.id], [fourth.id, fifth.id]);
  await checkControls();
}, 30_000);

it("[LMA25.delete-save] rereads a deleted parent after waiting and never resurrects its attendance", async () => {
  const tutor = await nativeTutor("DeleteRace");
  const checkControls = await retainedControls([tutor.id]);
  const meetings = await threeAbsences([tutor.id]);
  const fourth = await nativeMeeting(3);
  await staff().admin.recordMeetingAttendance({
    meetingId: fourth.id, entries: [{ tutorId: tutor.id, status: "UNEXCUSED_ABSENT" }],
  });
  const result = await raceAtCommit(
    () => staff().admin.deleteMeeting({ id: meetings[0]!.id }),
    () => staff().admin.recordMeetingAttendance({
      meetingId: meetings[0]!.id, entries: [{ tutorId: tutor.id, status: "PRESENT" }],
    }),
  );
  expect(succeeded(result.first).id).toBe(meetings[0]!.id);
  expect(result.second.ok).toBe(false);
  if (result.second.ok) throw new Error("Save resurrected a deleted meeting.");
  expect(result.second.error).toMatchObject({ code: "NOT_FOUND" });
  expect(await db.meetingAttendance.count({ where: { meetingId: meetings[0]!.id } })).toBe(0);
  await expectCurrentDeductions([tutor.id], []);
  await checkControls();
}, 30_000);

it("[LMA25.self-staff] staff saves the state committed by an overlapping self-excuse", async () => {
  const tutor = await nativeTutor("SelfRace");
  const checkControls = await retainedControls([tutor.id]);
  const user = await db.user.create({ data: {
    email: "meeting-delta-race-tutor@example.test", role: "TUTOR", tutorId: tutor.id,
    sessionVersion: 0, historyAccessRevision: 0,
  } });
  const self = createCaller({ db, headers: new Headers(), session: {
    user: { id: user.id, name: "Synthetic race tutor" }, role: "TUTOR", tutorId: tutor.id,
    sessionVersion: 0, historyAccessRevision: 0,
    expires: "2099-01-01T00:00:00Z",
  } }).tutor;
  const meeting = await staff().admin.createMeeting({
    title: "Synthetic upcoming race meeting", termId: currentTermId,
    date: new Date(Date.now() + 2 * 86_400_000),
  });
  const result = await raceAtCommit(
    () => self.excuseMeeting({ meetingId: meeting.id, reason: "Synthetic class" }),
    () => staff().admin.recordMeetingAttendance({
      meetingId: meeting.id, entries: [{ tutorId: tutor.id, status: "PRESENT" }],
    }),
  );
  expect(succeeded(result.first)).toEqual({ ok: true });
  expect(succeeded(result.second)).toEqual({ ok: true });
  expect(await db.meetingAttendance.findUnique({
    where: { meetingId_tutorId: { meetingId: meeting.id, tutorId: tutor.id } },
  })).toMatchObject({ status: "PRESENT" });
  // Staff-adoption/marker ownership belongs to the separately composed root fix.
  await expectCurrentDeductions([tutor.id], []);
  await checkControls();
}, 30_000);

it("[LMA25.import-native] observes committed import provenance before a waiting native absence save", async () => {
  const tutor = await nativeTutor("ImportRace");
  const checkControls = await retainedControls([tutor.id]);
  await threeAbsences([tutor.id]);
  const fourth = await nativeMeeting(3);
  const importedIds = Array.from({ length: 4 }, fixtureId);
  const archiveId = deductionId(importedIds[3]!, tutor.id);
  const file = (table: string, rows: Record<string, unknown>[]): TransferFile => ({
    name: `${table}.csv`, text: recordCsv(Object.keys(rows[0]!), rows),
  });
  const files = [
    file("TutorMeeting", importedIds.map((id, index) => ({
      id, title: `Synthetic imported race meeting ${index}`, termId: currentTermId,
      date: new Date(Date.UTC(2026, 7, index + 1, 4)).toISOString(),
    }))),
    file("MeetingAttendance", importedIds.map((meetingId) => ({
      id: fixtureId(), meetingId, tutorId: tutor.id, status: "UNEXCUSED_ABSENT",
    }))),
    file("ServiceHourAdjustment", [{
      id: archiveId, tutorId: tutor.id, month: "2026-08", schoolYear: "26-27",
      quarter: "Q2", type: "PUNISHMENT", amount: 1.5,
      reason: retainedReason, createdAt: retainedDate.toISOString(),
    }]),
  ];
  const preview = await staff().recordTransfer.preview({ files });
  expect(preview.summary.reduce((count, row) => count + row.created, 0)).toBe(9);
  expect(await db.importedRecordProvenance.count()).toBe(0);
  const result = await raceAtCommit(
    () => staff().recordTransfer.import({ files, ticket: preview.ticket }),
    () => staff().admin.recordMeetingAttendance({
      meetingId: fourth.id, entries: [{ tutorId: tutor.id, status: "UNEXCUSED_ABSENT" }],
    }),
    "Serializable",
  );
  expect(succeeded(result.first).summary).toEqual(preview.summary);
  expect(succeeded(result.second)).toEqual({ ok: true });
  const archive = await db.serviceHourAdjustment.findUniqueOrThrow({ where: { id: archiveId } });
  expect(archive).toMatchObject({ amount: 1.5, reason: retainedReason, createdAt: retainedDate });
  expect(await db.importedRecordProvenance.count()).toBe(9);
  const current = await db.serviceHourAdjustment.findMany({ where: {
    tutorId: tutor.id, schoolYear: "26-27", id: { startsWith: "mtgabs_" },
  } });
  expect(current).toHaveLength(2);
  expect(current).toEqual(expect.arrayContaining([
    archive,
    expect.objectContaining({ id: deductionId(fourth.id, tutor.id), amount: 0.25 }),
  ]));
  await checkControls();
}, 30_000);

it("[LMA25.reversed-batch] serializes reversed multi-tutor batches with one effect per source", async () => {
  const tutors = [await nativeTutor("AlphaRace"), await nativeTutor("BetaRace")];
  const tutorIds = tutors.map(({ id }) => id);
  const checkControls = await retainedControls(tutorIds);
  await threeAbsences(tutorIds);
  const fourth = await nativeMeeting(3);
  const fifth = await nativeMeeting(4);
  const save = (meetingId: string, ids: string[]) => staff().admin.recordMeetingAttendance({
    meetingId, entries: ids.map((tutorId) => ({ tutorId, status: "UNEXCUSED_ABSENT" as const })),
  });
  const result = await raceAtCommit(
    () => save(fourth.id, tutorIds),
    () => save(fifth.id, [...tutorIds].reverse()),
  );
  expect(succeeded(result.first)).toEqual({ ok: true });
  expect(succeeded(result.second)).toEqual({ ok: true });
  await expectCurrentDeductions(tutorIds, [fourth.id, fifth.id]);
  await checkControls();
}, 30_000);

it("[LMA25.staff-staff-ssi] retains Serializable admission and retries only a confirmed serialization rollback", async () => {
  const tutor = await nativeTutor("StaffSsiRace");
  const checkControls = await retainedControls([tutor.id]);
  await threeAbsences([tutor.id]);
  const fourth = await nativeMeeting(3);
  const fifth = await nativeMeeting(4);
  const save = (meetingId: string) => staff().admin.recordMeetingAttendance({
    meetingId, entries: [{ tutorId: tutor.id, status: "UNEXCUSED_ABSENT" }],
  });
  const result = await raceAtCommit(
    () => save(fourth.id), () => save(fifth.id), "Serializable", "Serializable",
  );
  expect(succeeded(result.first)).toEqual({ ok: true });
  if (result.second.ok) {
    expect(result.second.value).toEqual({ ok: true });
  } else {
    if (!serializationRejected(result.second.error)) throw result.second.error;
    // raceAtCommit has awaited the rejected outer transaction. Prove its
    // source/effects rolled back before issuing a distinct, fresh API request.
    expect(await db.meetingAttendance.findUnique({
      where: { meetingId_tutorId: { meetingId: fifth.id, tutorId: tutor.id } },
    })).toBeNull();
    await expectCurrentDeductions([tutor.id], [fourth.id]);
    await checkControls();
    expect(await save(fifth.id)).toEqual({ ok: true });
  }
  await expectCurrentDeductions([tutor.id], [fourth.id, fifth.id]);
  await checkControls();
}, 30_000);
