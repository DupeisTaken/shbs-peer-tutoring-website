import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { finalizeDueOptOuts } from "~/server/discipline/removal";
import { databaseScope } from "~/server/db-scope";
import { withAutomaticRecoveryCheckpoint } from "~/server/recovery/checkpoint";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
// Use the operator-selected disposable database, without prescribing its port.
assertIsolatedTestDatabase(process.env.DATABASE_URL);

function barrier<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** The watchdog bounds broken instrumentation; barriers and SQL order the race. */
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error(label)), 8000);
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
}

async function outcome(work: Promise<unknown>) {
  try {
    return { ok: true as const, value: await work };
  } catch (error) {
    return { ok: false as const, error };
  }
}

type Outcome = Awaited<ReturnType<typeof outcome>>;
type Hooks = {
  periodAttempt?: (pid: number) => void;
  pendingRead?: () => Promise<void>;
  recalled?: () => Promise<void>;
};

/** Keep the real transaction, audit, checkpoint, SQL and writes. Only pause at
 * a completed domain read/write or observe the actual period-lock attempt. */
async function scopedTransaction(
  hooks: Hooks,
  work: (tx: TransactionDb) => Promise<unknown>,
) {
  return db.$transaction(
    async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
      SELECT pg_backend_pid() AS pid`;
      const requests = new Proxy(tx.tuteeRemovalRequest, {
        get(target, key): unknown {
          if (key === "findUnique" && hooks.pendingRead) {
            return async (...args: Parameters<typeof target.findUnique>) => {
              const row = await target.findUnique(...args);
              if (row?.state === "PENDING") await hooks.pendingRead!();
              return row;
            };
          }
          if (key === "updateMany" && hooks.recalled) {
            return async (...args: Parameters<typeof target.updateMany>) => {
              const result = await target.updateMany(...args);
              if (result.count && args[0]?.data.state === "RECALLED")
                await hooks.recalled!();
              return result;
            };
          }
          return Reflect.get(target, key);
        },
      });
      const observed = new Proxy(tx, {
        get(target, key): unknown {
          if (key === "tuteeRemovalRequest") return requests;
          if (key === "$executeRaw" && hooks.periodAttempt) {
            return (...args: Parameters<typeof target.$executeRaw>) => {
              if (args.includes("program:period"))
                hooks.periodAttempt!(backend!.pid);
              return target.$executeRaw(...args);
            };
          }
          return Reflect.get(target, key);
        },
      }) as TransactionDb;
      // Nested checkpoint helpers and audited callers must retain these delegates.
      return databaseScope.run(observed, () => work(observed));
    },
    { timeout: 20000 },
  );
}

async function reach<T>(
  gate: Promise<T>,
  writer: Promise<Outcome>,
  label: string,
) {
  return bounded(
    Promise.race([
      gate,
      writer.then((result) => {
        if (!result.ok) throw result.error;
        throw new Error(label);
      }),
    ]),
    label,
  );
}

async function expectPeriodWait(pid: number) {
  // Poll an observed PostgreSQL condition, never infer a lock from elapsed time.
  for (let attempt = 0; attempt < 150; attempt++) {
    const [row] = await db.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM pg_locks
        WHERE pid=${pid} AND locktype='advisory' AND NOT granted
          AND classid=((hashtextextended('program:period',0) >> 32) & 4294967295)::oid
          AND objid=(hashtextextended('program:period',0) & 4294967295)::oid
          AND objsubid=1
      ) AS waiting`;
    if (row?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Competing writer did not queue at the real period fence");
}

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
});

afterAll(async () => {
  await db.$disconnect();
});

async function fixture() {
  const term = await db.term.create({
    data: {
      schoolYear: "26-27",
      quarter: "Q2",
      name: "Synthetic recall period",
      active: true,
    },
  });
  const tutor = await db.tutor.create({
    data: {
      englishName: "Synthetic relay tutor",
      status: "ACTIVE",
    },
  });
  const learner = await db.tutee.create({
    data: {
      englishName: "Synthetic relay learner",
      status: "ACTIVE",
    },
  });
  const user = await db.user.create({
    data: {
      email: "synthetic-recall-tutor@example.test",
      name: "Synthetic relay tutor",
      role: "TUTOR",
      tutorId: tutor.id,
    },
  });
  const pairing = await db.pairing.create({
    data: {
      tutorId: tutor.id,
      termId: term.id,
      subject: "Synthetic mathematics",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 945,
      scheduleConfirmed: true,
      roomMode: "NONE",
      tutees: { create: { tuteeId: learner.id } },
    },
  });
  const request = await db.tuteeRemovalRequest.create({
    data: {
      tuteeId: learner.id,
      pairingId: pairing.id,
      requestedByTutorId: tutor.id,
      kind: "VOLUNTARY",
      eligibleAt: new Date("2000-01-01T00:00:00Z"),
    },
  });
  const caller = createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: user.id },
      role: "TUTOR",
      tutorId: tutor.id,
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  return { term, tutor, learner, pairing, request, caller };
}

it.each(["recall", "finalizer"] as const)(
  "%s wins the shared fence and the queued competitor cannot overwrite its result",
  async (winner) => {
    const { learner, pairing, request, caller } = await fixture();
    expect(
      await db.tuteeRemovalRequest.count({
        where: {
          id: request.id,
          kind: "VOLUNTARY",
          state: "PENDING",
          eligibleAt: { lte: new Date() },
        },
      }),
    ).toBe(1);
    // An existing participant root must keep the ordinary recall/finalizer journal.
    await db.$transaction((tx) =>
      withAutomaticRecoveryCheckpoint(
        tx,
        { adapter: "PARTICIPANT_TUTEE", sourceId: learner.id },
        null,
        async () => undefined,
      ),
    );
    const root = await db.recoveryCheckpoint.findFirstOrThrow({
      where: { sourceId: learner.id, adapter: "PARTICIPANT_TUTEE" },
    });
    const paused = barrier();
    const resume = barrier();
    const attempted = barrier<number>();
    const pause = async () => {
      paused.release();
      await resume.promise;
    };
    const recall = (hooks: Hooks) =>
      scopedTransaction(hooks, () =>
        caller.tutor.recallTuteeRemoval({ requestId: request.id }),
      );
    const finalize = (hooks: Hooks) =>
      scopedTransaction(hooks, finalizeDueOptOuts);
    const leading = outcome(
      winner === "recall"
        ? recall({ recalled: pause })
        : finalize({ pendingRead: pause }),
    );
    let following: Promise<Outcome> | undefined;
    try {
      await reach(
        paused.promise,
        leading,
        "Winning writer missed its domain barrier",
      );
      following = outcome(
        winner === "recall"
          ? finalize({ periodAttempt: attempted.release })
          : recall({ periodAttempt: attempted.release }),
      );
      const pid = await reach(
        attempted.promise,
        following,
        "Competing writer skipped the period fence",
      );
      await expectPeriodWait(pid);
      expect(
        await db.tuteeRemovalRequest.findUniqueOrThrow({
          where: { id: request.id },
        }),
      ).toMatchObject({ state: "PENDING" });
      expect(
        await db.tutee.findUniqueOrThrow({ where: { id: learner.id } }),
      ).toMatchObject({ status: "ACTIVE" });
    } finally {
      // Always drain both transactions, including when an assertion or probe fails.
      resume.release();
      await leading;
      if (following) await following;
    }
    const first = await leading;
    const second = await following;
    if (!first.ok) throw first.error;
    if (winner === "recall") {
      expect(first.value).toEqual({ ok: true });
      expect(second).toEqual({ ok: true, value: 0 });
    } else {
      expect(first.value).toBe(1);
      expect(second).toMatchObject({
        ok: false,
        error: { code: "BAD_REQUEST" },
      });
    }
    const state = winner === "recall" ? "RECALLED" : "APPROVED";
    expect(
      await db.tuteeRemovalRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).toMatchObject({ state });
    expect(
      await db.tutee.findUniqueOrThrow({ where: { id: learner.id } }),
    ).toMatchObject({ status: winner === "recall" ? "ACTIVE" : "INACTIVE" });
    expect(
      await db.pairingTutee.count({
        where: { pairingId: pairing.id, tuteeId: learner.id },
      }),
    ).toBe(winner === "recall" ? 1 : 0);
    const expectedAfter: unknown = expect.objectContaining({
      id: request.id,
      state,
    });
    expect(
      await db.recoveryChange.findMany({
        where: {
          actionId: root.actionId,
          entity: "TuteeRemovalRequest",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "UPDATE",
          after: expectedAfter,
        }),
      ]),
    );
    expect(
      await db.auditLog.count({
        where: {
          operation: "tutor.recallTuteeRemoval",
          details: { path: ["outcome"], equals: "APPLIED" },
        },
      }),
    ).toBe(winner === "recall" ? 1 : 0);
    expect(
      await db.recoveryCheckpoint.count({
        where: {
          sourceId: learner.id,
          adapter: "PARTICIPANT_TUTEE",
        },
      }),
    ).toBe(winner === "recall" ? 1 : 2);
    expect(await finalizeDueOptOuts(db)).toBe(0);
  },
  25000,
);

it.each(["inactive tutor", "removed origin", "old period"] as const)(
  "the existing owner can still recall a pending relay with %s",
  async (scenario) => {
    const { term, tutor, learner, pairing, request, caller } = await fixture();
    if (scenario === "inactive tutor")
      await db.tutor.update({
        where: { id: tutor.id },
        data: { status: "OPTED_OUT" },
      });
    if (scenario === "removed origin")
      await db.pairingTutee.deleteMany({ where: { pairingId: pairing.id } });
    if (scenario === "old period")
      await db.term.update({ where: { id: term.id }, data: { active: false } });
    await expect(
      caller.tutor.recallTuteeRemoval({ requestId: request.id }),
    ).resolves.toEqual({ ok: true });
    expect(await finalizeDueOptOuts(db)).toBe(0);
    expect(
      await db.tuteeRemovalRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).toMatchObject({ state: "RECALLED", resolvedByName: "self" });
    expect(
      await db.tutee.findUniqueOrThrow({ where: { id: learner.id } }),
    ).toMatchObject({ status: "ACTIVE" });
  },
);

it.each([
  "other owner",
  "APPROVED",
  "DENIED",
  "RECALLED",
  "REINSTATED",
  "missing",
] as const)(
  "a relay with %s is rejected without changing participation",
  async (scenario) => {
    const { learner, pairing, request, caller } = await fixture();
    if (scenario === "other owner") {
      const other = await db.tutor.create({
        data: { englishName: "Synthetic other tutor" },
      });
      await db.tuteeRemovalRequest.update({
        where: { id: request.id },
        data: { requestedByTutorId: other.id },
      });
    } else if (scenario === "missing") {
      await db.tuteeRemovalRequest.delete({ where: { id: request.id } });
    } else {
      await db.tuteeRemovalRequest.update({
        where: { id: request.id },
        data: { state: scenario },
      });
    }
    const before = await db.tuteeRemovalRequest.findUnique({
      where: { id: request.id },
    });
    await expect(
      caller.tutor.recallTuteeRemoval({ requestId: request.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No open request to recall.",
    });
    expect(
      await db.tuteeRemovalRequest.findUnique({ where: { id: request.id } }),
    ).toEqual(before);
    expect(
      await db.tutee.findUniqueOrThrow({ where: { id: learner.id } }),
    ).toMatchObject({ status: "ACTIVE" });
    expect(
      await db.pairingTutee.count({
        where: { pairingId: pairing.id, tuteeId: learner.id },
      }),
    ).toBe(1);
  },
);

it("concurrent recalls admit exactly one transition", async () => {
  const { request, caller } = await fixture();
  const results = await Promise.allSettled([
    caller.tutor.recallTuteeRemoval({ requestId: request.id }),
    caller.tutor.recallTuteeRemoval({ requestId: request.id }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected).toMatchObject({ reason: { code: "BAD_REQUEST" } });
  expect(
    await db.tuteeRemovalRequest.findUniqueOrThrow({
      where: { id: request.id },
    }),
  ).toMatchObject({ state: "RECALLED" });
});
