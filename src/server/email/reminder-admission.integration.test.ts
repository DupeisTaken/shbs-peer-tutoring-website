import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import type { TransactionDb } from "~/server/transactions";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("./sender", () => ({
  emailSender: { send: vi.fn() },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => false,
  verifyEmailTransport: vi.fn(),
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { databaseScope } from "~/server/db-scope";
import { utcDatabaseUrl } from "~/server/database-url";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  eventReminderSource,
  queueEventReminders,
  reminderKey,
  validateEventReminder,
} from "./event-reminders";
import {
  admitReminderNotice,
  finishIdentityNotice,
} from "./identity-notice-admission";
import { readPairingGroups, savePairingGroups } from "~/server/pairing-groups";

// Real PostgreSQL source and outbox locks, real supported mutation callers and
// admission code. SMTP is never contacted; finishing an admitted attempt below
// supplies only a synthetic acceptance result, separately from ordering evidence.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const startsAt = new Date("2096-10-29T07:30:00.000Z");
const now = new Date(startsAt.getTime() - 3_600_000);
const lease = new Date(now.getTime() + 300_000);
type Family = "meeting" | "interview" | "tutoring";
const families: Family[] = ["meeting", "interview", "tutoring"];
const cleanupTasks: Array<() => Promise<void>> = [];

async function independentWriter() {
  const client = new Client({
    connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
    connectionTimeoutMillis: 2000,
    statement_timeout: 3000,
    application_name: "shbs-reminder-admission-interleaving-test",
  });
  await client.connect();
  return client;
}

function signal<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(() => assertIsolatedTestDatabase(process.env.DATABASE_URL));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanupTasks.splice(0).reverse()) await cleanup();
});
afterAll(() => db.$disconnect());

async function fixture(family: Family) {
  const suffix = randomUUID();
  await db.programSettings.upsert({
    where: { id: "program" },
    create: {
      id: "program",
      emailNotificationsEnabled: true,
      timeZone: "Asia/Shanghai",
    },
    update: {
      emailNotificationsEnabled: true,
      timeZone: "Asia/Shanghai",
      notificationLocks: {},
    },
  });
  for (const key of ["MEETINGS", "INTERVIEWS"] as const)
    await db.programFeature.upsert({
      where: { key },
      create: { key, enabled: true },
      update: { enabled: true },
    });
  const tutor = await db.tutor.create({
    data: { englishName: "Reminder fence synthetic", status: "ACTIVE" },
  });
  const user = await db.user.create({
    data: {
      email: `reminder-fence-${suffix}@example.test`,
      role: "ADMIN",
      tutorId: tutor.id,
      emailVerifiedAt: now,
      emailEventReminders: true,
    },
  });
  const term = await db.term.create({
    data: {
      schoolYear: suffix,
      name: "Reminder fence synthetic",
      quarter: "Q1",
      active: true,
    },
  });
  const meeting =
    family === "meeting"
      ? await db.tutorMeeting.create({
          data: { title: "Synthetic meeting", date: startsAt, termId: term.id },
        })
      : null;
  const application =
    family === "interview"
      ? await db.tutorApplication.create({
          data: {
            name: "Synthetic applicant",
            email: `applicant-${suffix}@example.test`,
            status: "INTERVIEW",
            interviewAt: startsAt,
            interviewers: { create: { tutorId: tutor.id, isHead: true } },
          },
        })
      : null;
  const tutee =
    family === "tutoring"
      ? await db.tutee.create({
          data: { englishName: "Synthetic learner", status: "ACTIVE" },
        })
      : null;
  const pairing = tutee
    ? await db.pairing.create({
        data: {
          tutorId: tutor.id,
          termId: term.id,
          subject: "Mathematics",
          scheduleConfirmed: true,
          dayOfWeek: new Date("2096-10-29T12:00:00Z").getUTCDay(),
          startMin: 930,
          endMin: 975,
          tutees: { create: { tuteeId: tutee.id } },
        },
      })
    : null;
  cleanupTasks.push(async () => {
    await db.emailDelivery.deleteMany({ where: { userId: user.id } });
    await db.notification.deleteMany({ where: { userId: user.id } });
    if (application) {
      await db.interviewAssignment.deleteMany({
        where: { applicationId: application.id },
      });
      await db.tutorApplication.deleteMany({ where: { id: application.id } });
    }
    if (meeting)
      await db.tutorMeeting.deleteMany({ where: { id: meeting.id } });
    if (pairing) {
      await db.pairingTutee.deleteMany({ where: { pairingId: pairing.id } });
      await db.pairing.deleteMany({ where: { id: pairing.id } });
    }
    await db.user.delete({ where: { id: user.id } });
    if (tutee) await db.tutee.delete({ where: { id: tutee.id } });
    await db.tutor.delete({ where: { id: tutor.id } });
    await db.term.delete({ where: { id: term.id } });
  });
  const actor = () =>
    createCaller({
      db,
      headers: new Headers(),
      session: {
        user: { id: user.id, name: "Synthetic chair" },
        role: "ADMIN",
        tutorId: tutor.id,
        expires: "2099-01-01T00:00:00Z",
      },
    });
  const mutate = () =>
    family === "meeting"
      ? actor().admin.deleteMeeting({ id: meeting!.id })
      : family === "interview"
        ? actor().tutor.setInterviewTime({
            applicationId: application!.id,
            interviewAt: null,
          })
        : actor().admin.deletePairing({ id: pairing!.id });
  await queueEventReminders(db, now);
  const row = await db.emailDelivery.findFirstOrThrow({
    where: { userId: user.id, category: "reminder" },
  });
  expect(await validateEventReminder(db, row, now)).toBe(true);
  await db.emailDelivery.update({
    where: { id: row.id },
    data: { leaseUntil: lease },
  });
  const read = () =>
    db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
  const reschedule = () =>
    family === "meeting"
      ? db.tutorMeeting.update({
          where: { id: meeting!.id },
          data: { date: new Date(startsAt.getTime() + 3_600_000) },
        })
      : family === "interview"
        ? actor().tutor.setInterviewTime({
            applicationId: application!.id,
            interviewAt: new Date(startsAt.getTime() + 3_600_000),
          })
        : db.pairing.update({
            where: { id: pairing!.id },
            data: { startMin: 990, endMin: 1035 },
          });
  return { row, mutate, read, reschedule, user, tutor, term, pairing, meeting };
}

async function waitUntilBlocked(pid: number) {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const [result] = await db.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
    if (result?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Supported source writer did not reach the admission fence");
}

it.each(families)(
  "%s: a committed source cancellation invalidates a previously eligible receipt",
  async (family) => {
    const f = await fixture(family);
    await f.mutate();
    expect(await admitReminderNotice(db, f.row.id, lease, null)).toBeNull();
    expect(await f.read()).toMatchObject({
      status: "SKIPPED",
      attempts: 0,
      attemptStartedAt: null,
      leaseUntil: null,
    });
  },
);

it.each(families)(
  "%s: an uncommitted source writer defers admission without spending an attempt",
  async (family) => {
    const f = await fixture(family);
    const changed = signal(),
      commit = signal();
    const writer = db.$transaction(
      async (tx) => {
        await databaseScope.run(tx, f.mutate);
        changed.resolve();
        await commit.promise;
      },
      { timeout: 10_000 },
    );
    try {
      await Promise.race([
        changed.promise,
        writer.then(() => {
          throw new Error("Writer ended without a change signal");
        }),
      ]);
      expect(await admitReminderNotice(db, f.row.id, lease, null)).toBeNull();
      expect(await f.read()).toMatchObject({
        status: "PENDING",
        attempts: 0,
        attemptStartedAt: null,
        leaseUntil: null,
      });
    } finally {
      commit.resolve();
      await writer;
    }
    await db.emailDelivery.update({
      where: { id: f.row.id },
      data: { leaseUntil: lease },
    });
    expect(await admitReminderNotice(db, f.row.id, lease, null)).toBeNull();
    expect((await f.read()).status).toBe("SKIPPED");
  },
);

it.each(families)(
  "%s: admission wins before cancellation, then retains truthful accepted evidence",
  async (family) => {
    const f = await fixture(family);
    const admitted = signal<string>(),
      release = signal(),
      writerPid = signal<number>();
    const admission = db.$transaction(
      async (tx) => {
        const attempt = await admitReminderNotice(tx, f.row.id, lease, null);
        if (!attempt)
          throw new Error("Synthetic current reminder was not admitted");
        admitted.resolve(attempt);
        await release.promise;
        return attempt;
      },
      { timeout: 10_000 },
    );
    let writer: Promise<unknown> | undefined;
    try {
      await Promise.race([
        admitted.promise,
        admission.then(() => {
          throw new Error("No admission signal");
        }),
      ]);
      writer = db.$transaction(
        async (tx: TransactionDb) => {
          const [pid] = await tx.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          writerPid.resolve(pid!.pid);
          return databaseScope.run(tx, f.mutate);
        },
        { timeout: 10_000 },
      );
      await waitUntilBlocked(await writerPid.promise);
    } finally {
      release.resolve();
      await admission;
    }
    await writer;
    const attempt = await admitted.promise;
    expect(await f.read()).toMatchObject({
      status: "SENDING",
      attempts: 1,
      attemptId: attempt,
    });
    await finishIdentityNotice(db, f.row.id, attempt, true);
    expect((await f.read()).status).toBe("SENT");
    expect(await admitReminderNotice(db, f.row.id, lease, attempt)).toBeNull();
  },
);

it.each(families)(
  "%s: a reschedule after preflight cannot admit the earlier reminder clock",
  async (family) => {
    const f = await fixture(family);
    // Interview uses its supported chair mutation. Meeting has no edit endpoint;
    // meeting and legacy pairing rows also exercise database/import writer safety.
    await f.reschedule();
    expect(await admitReminderNotice(db, f.row.id, lease, null)).toBeNull();
    expect(await f.read()).toMatchObject({
      status: "SKIPPED",
      attempts: 0,
      attemptStartedAt: null,
    });
  },
);

it.each(families)(
  "%s: an unrelated account display-name change preserves the reminder",
  async (family) => {
    const f = await fixture(family);
    await db.user.update({
      where: { id: f.user.id },
      data: { name: "Different synthetic account display name" },
    });
    expect(await admitReminderNotice(db, f.row.id, lease, null)).toEqual(
      expect.any(String),
    );
    expect(await f.read()).toMatchObject({ status: "SENDING", attempts: 1 });
  },
);

it("nested source contention rolls back only admission, restores timeout and releases lock prefixes", async () => {
  const f = await fixture("meeting");
  const changed = signal(),
    commit = signal();
  const writer = db.$transaction(
    async (tx) => {
      // Hold only the leaf meeting row so admission acquires the full lock
      // prefix (program:period, email-notifications-setting, HistoryRowOwnership)
      // before hitting contention on TutorMeeting FOR UPDATE NOWAIT.
      await tx.$queryRaw`SELECT id FROM "TutorMeeting" WHERE id=${f.meeting!.id} FOR UPDATE`;
      changed.resolve();
      await commit.promise;
    },
    { timeout: 10_000 },
  );
  try {
    await Promise.race([
      changed.promise,
      writer.then(() => {
        throw new Error("No source writer signal");
      }),
    ]);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '1750ms'`;
      expect(await admitReminderNotice(tx, f.row.id, lease, null)).toBeNull();
      const [state] = await tx.$queryRaw<
        Array<{ timeout: string; healthy: number }>
      >`
        SELECT current_setting('lock_timeout') AS timeout, 1 AS healthy`;
      expect(state).toEqual({ timeout: "1750ms", healthy: 1 });
      await db.$transaction(async (independent) => {
        const [period] = await independent.$queryRaw<
          Array<{ locked: boolean }>
        >`
          SELECT pg_try_advisory_xact_lock(hashtextextended('program:period', 0)) AS locked`;
        expect(period?.locked).toBe(true);
        const [settings] = await independent.$queryRaw<
          Array<{ locked: boolean }>
        >`
          SELECT pg_try_advisory_xact_lock(hashtextextended('email-notifications-setting', 0)) AS locked`;
        expect(settings?.locked).toBe(true);
        await independent.$executeRaw`LOCK TABLE "HistoryRowOwnership" IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
      });
      expect(
        await tx.emailDelivery.findUniqueOrThrow({ where: { id: f.row.id } }),
      ).toMatchObject({
        status: "PENDING",
        attempts: 0,
        attemptStartedAt: null,
        leaseUntil: null,
      });
    });
  } finally {
    commit.resolve();
    await writer;
  }
});

it("a supported group split invalidates its old grouped reminder", async () => {
  const f = await fixture("tutoring");
  const original = await db.pairing.findUniqueOrThrow({
    where: { id: f.pairing!.id },
    include: { tutees: true },
  });
  const group = await db.pairingGroup.create({
    data: {
      tutorId: f.tutor.id,
      termId: f.term.id,
      primaryPairingId: original.id,
    },
  });
  await db.pairing.update({
    where: { id: original.id },
    data: { groupId: group.id },
  });
  const learner = await db.tutee.create({
    data: { englishName: "Synthetic group learner", status: "ACTIVE" },
  });
  const second = await db.pairing.create({
    data: {
      tutorId: f.tutor.id,
      termId: f.term.id,
      groupId: group.id,
      subject: "Mathematics",
      scheduleConfirmed: true,
      dayOfWeek: original.dayOfWeek,
      startMin: original.startMin,
      endMin: original.endMin,
      tutees: { create: { tuteeId: learner.id } },
    },
  });
  cleanupTasks.push(async () => {
    await db.pairing.updateMany({
      where: { groupId: group.id },
      data: { groupId: null },
    });
    await db.pairingTutee.deleteMany({ where: { pairingId: second.id } });
    await db.pairing.deleteMany({ where: { id: second.id } });
    await db.pairingGroup.deleteMany({ where: { id: group.id } });
    await db.tutee.delete({ where: { id: learner.id } });
  });
  await queueEventReminders(db, now);
  const row = await db.emailDelivery.findFirstOrThrow({
    where: {
      userId: f.user.id,
      category: "reminder",
      context: { path: ["sourceId"], equals: group.id },
    },
  });
  expect(await validateEventReminder(db, row, now)).toBe(true);
  await db.emailDelivery.update({
    where: { id: row.id },
    data: { leaseUntil: lease },
  });
  const state = await readPairingGroups(db, f.tutor.id);
  await savePairingGroups(db, f.tutor.id, {
    snapshot: state.snapshot,
    groups: [],
  });
  expect(await admitReminderNotice(db, row.id, lease, null)).toBeNull();
  expect(
    await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({ status: "SKIPPED", attempts: 0, attemptStartedAt: null });
});

it("a source missing at its lock lookup cannot be replaced under the same ID during admission", async () => {
  const f = await fixture("meeting");
  await f.mutate();
  let restored = false;
  const independent = await independentWriter();
  try {
    await db.$transaction(async (tx) => {
      const controlled = new Proxy(tx, {
        get(target, key): unknown {
          if (key !== "$queryRaw") {
            const value: unknown = Reflect.get(target, key);
            return typeof value === "function"
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value;
          }
          return async (
            parts: TemplateStringsArray,
            ...parameters: unknown[]
          ) => {
            const rows = await target.$queryRaw<Array<{ id: string }>>(
              parts,
              ...parameters,
            );
            if (
              parts.join("?").includes('FROM "TutorMeeting"') &&
              !rows.length &&
              !restored
            ) {
              await independent.query(
                'INSERT INTO "TutorMeeting" (id,title,date,"termId") VALUES ($1,$2,$3,$4)',
                [
                  f.meeting!.id,
                  f.meeting!.title,
                  f.meeting!.date.toISOString(),
                  f.term.id,
                ],
              );
              restored = true;
            }
            return rows;
          };
        },
      });
      // Prisma 7 transaction clients expose nested $transaction. Bind the
      // composition scope explicitly so inTransaction cannot replace this
      // controlled client with an uninstrumented nested transaction client.
      await databaseScope.run(controlled, async () => {
        expect(
          await admitReminderNotice(controlled, f.row.id, lease, null),
        ).toBeNull();
      });
    });
  } finally {
    await independent.end();
  }
  expect(restored).toBe(true);
  expect(await f.read()).toMatchObject({
    status: "SKIPPED",
    attempts: 0,
    attemptStartedAt: null,
  });
});

it("outbox selector drift cannot admit an account that was not source-fenced", async () => {
  const f = await fixture("meeting");
  const secondTutor = await db.tutor.create({
    data: { englishName: "Synthetic replacement recipient", status: "ACTIVE" },
  });
  const secondUser = await db.user.create({
    data: {
      email: `selector-fence-${randomUUID()}@example.test`,
      role: "TUTOR",
      tutorId: secondTutor.id,
      emailVerifiedAt: now,
      emailEventReminders: true,
    },
  });
  cleanupTasks.push(async () => {
    await db.emailDelivery.deleteMany({ where: { userId: secondUser.id } });
    await db.user.delete({ where: { id: secondUser.id } });
    await db.tutor.delete({ where: { id: secondTutor.id } });
  });
  let changed = false;
  const independent = await independentWriter();
  try {
    await db.$transaction(async (tx) => {
      const controlled = new Proxy(tx, {
        get(target, key): unknown {
          if (key !== "$queryRaw") {
            const value: unknown = Reflect.get(target, key);
            return typeof value === "function"
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value;
          }
          return async (
            parts: TemplateStringsArray,
            ...parameters: unknown[]
          ) => {
            if (
              parts.join("?").includes('FROM "EmailDelivery"') &&
              parts.join("?").includes("FOR UPDATE") &&
              !changed
            ) {
              const context = eventReminderSource(f.row.context)!;
              await independent.query(
                'UPDATE "EmailDelivery" SET "userId"=$1,recipient=$2,"reminderKey"=$3 WHERE id=$4',
                [
                  secondUser.id,
                  secondUser.email,
                  reminderKey(context, secondUser.id, secondUser.email),
                  f.row.id,
                ],
              );
              const replacement = await target.emailDelivery.findUniqueOrThrow({
                where: { id: f.row.id },
              });
              // This account is independently eligible. The failure must be the
              // lost selector fence, not a fabricated ineligible replacement.
              expect(
                await validateEventReminder(target, replacement, now),
              ).toBe(true);
              changed = true;
            }
            return target.$queryRaw(parts, ...parameters);
          };
        },
      });
      await databaseScope.run(controlled, async () => {
        expect(
          await admitReminderNotice(controlled, f.row.id, lease, null),
        ).toBeNull();
      });
    });
  } finally {
    await independent.end();
  }
  expect(changed).toBe(true);
  expect(await f.read()).toMatchObject({
    status: "SKIPPED",
    attempts: 0,
    attemptStartedAt: null,
  });
});
