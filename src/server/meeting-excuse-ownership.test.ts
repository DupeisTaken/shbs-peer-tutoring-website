import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { selfMeetingExcuseIds } from "~/server/meeting-excuse";
import type { TransactionDb } from "~/server/transactions";

const dateMatcher: unknown = expect.any(Date);
let tutorId: string;
const caller = (role: "ADMIN" | "TUTOR", client = db) =>
  createCaller({
    db: client,
    headers: new Headers(),
    session: {
      user: {
        id: role === "ADMIN" ? "meeting-owner-admin" : "meeting-owner-tutor",
        name: `Synthetic ${role}`,
      },
      role,
      tutorId: role === "TUTOR" ? tutorId : null,
      expires: "2099-01-01",
    } satisfies Session,
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => '"' + row.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.term.create({
    data: {
      id: "meeting-owner-term",
      name: "Synthetic meeting period",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  const tutor = await db.tutor.create({
    data: { englishName: "Synthetic Meeting Tutor", status: "ACTIVE" },
  });
  tutorId = tutor.id;
  await db.user.createMany({
    data: [
      {
        id: "meeting-owner-admin",
        email: "meeting-owner-admin@example.test",
        role: "ADMIN",
      },
      {
        id: "meeting-owner-tutor",
        email: "meeting-owner-tutor@example.test",
        role: "TUTOR",
        tutorId,
      },
    ],
  });
  await db.programFeature.create({ data: { key: "MEETINGS", enabled: true } });
});
afterAll(() => db.$disconnect());

const meeting = (minutesAhead = 180) =>
  caller("ADMIN").admin.createMeeting({
    title: "Synthetic staff-owned meeting evidence",
    date: new Date(Date.now() + minutesAhead * 60_000),
  });
const attendance = (meetingId: string) =>
  db.meetingAttendance.findUnique({
    where: { meetingId_tutorId: { meetingId, tutorId } },
  });
type MeetingStatus =
  "PRESENT" | "EXEMPT" | "EXCUSED_ABSENT" | "UNEXCUSED_ABSENT";
const staffStatus = (meetingId: string, status: MeetingStatus) =>
  caller("ADMIN").admin.recordMeetingAttendance({
    meetingId,
    entries: [{ tutorId, status }],
  });

// User guide: staff-recorded statuses require staff correction. The stale client
// may still have Cancel open, but an earlier self-excuse cannot own a later save.
it.each(["PRESENT", "EXEMPT", "EXCUSED_ABSENT", "UNEXCUSED_ABSENT"] as const)(
  "preserves a staff %s correction against a stale self-excuse cancellation",
  async (status) => {
    const row = await meeting();
    await caller("TUTOR").tutor.excuseMeeting({
      meetingId: row.id,
      reason: "Synthetic original self-excuse",
    });
    expect(await attendance(row.id)).toMatchObject({
      status: "EXCUSED_ABSENT",
      excusedAt: dateMatcher,
    });
    await staffStatus(row.id, status);
    const reviewed = await attendance(row.id);
    expect(reviewed).toMatchObject({ status, excusedAt: null, reason: null });
    const staffAudit = await db.auditLog.findFirstOrThrow({
      where: {
        operation: "admin.recordMeetingAttendance",
        details: { path: ["outcome"], equals: "APPLIED" },
      },
    });
    expect(JSON.stringify(staffAudit.details)).not.toContain(
      "Synthetic original self-excuse",
    );

    // Either rejection or an idempotent no-op can preserve ownership; successful
    // deletion of the manager's row is the behavior this audit probe detects.
    await caller("TUTOR")
      .tutor.cancelMeetingExcuse({ meetingId: row.id })
      .catch((error: unknown) => error);
    expect(await attendance(row.id)).toEqual(reviewed);
  },
);

it.each(["PRESENT", "EXEMPT", "EXCUSED_ABSENT", "UNEXCUSED_ABSENT"] as const)(
  "preserves a fresh staff %s record against a new tutor excuse",
  async (status) => {
    const row = await meeting();
    await staffStatus(row.id, status);
    const reviewed = await attendance(row.id);
    expect(reviewed).toMatchObject({ status, excusedAt: null });

    await caller("TUTOR")
      .tutor.excuseMeeting({
        meetingId: row.id,
        reason: "Synthetic attempt after staff review",
      })
      .catch((error: unknown) => error);
    expect(await attendance(row.id)).toEqual(reviewed);
  },
);

it("allows cancellation of the tutor's unchanged self-excuse before the cutoff", async () => {
  const row = await meeting();
  await caller("TUTOR").tutor.excuseMeeting({
    meetingId: row.id,
    reason: "Synthetic current self-excuse",
  });
  expect(await attendance(row.id)).toMatchObject({
    status: "EXCUSED_ABSENT",
    excusedAt: dateMatcher,
  });
  await caller("TUTOR").tutor.cancelMeetingExcuse({ meetingId: row.id });
  expect(await attendance(row.id)).toBeNull();
});

it("keeps a staff-created row when no earlier self-excuse exists", async () => {
  const row = await meeting();
  await staffStatus(row.id, "PRESENT");
  const reviewed = await attendance(row.id);
  expect(reviewed).toMatchObject({ status: "PRESENT", excusedAt: null });
  await caller("TUTOR")
    .tutor.cancelMeetingExcuse({ meetingId: row.id })
    .catch((error: unknown) => error);
  expect(await attendance(row.id)).toEqual(reviewed);
});

it("rejects both self-excuse writes inside the existing sixty-minute cutoff", async () => {
  const soon = await meeting(45);
  await expect(
    caller("TUTOR").tutor.excuseMeeting({ meetingId: soon.id }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await attendance(soon.id)).toBeNull();

  const row = await meeting();
  await caller("TUTOR").tutor.excuseMeeting({ meetingId: row.id });
  await db.tutorMeeting.update({
    where: { id: row.id },
    data: { date: new Date(Date.now() + 45 * 60_000) },
  });
  const before = await attendance(row.id);
  await expect(
    caller("TUTOR").tutor.cancelMeetingExcuse({ meetingId: row.id }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await attendance(row.id)).toEqual(before);
});

function barrier<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
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
  read?: () => Promise<void>;
  periodAttempt?: (pid: number) => void;
  locks?: string[];
};

/** Observe the real audited transaction owner and forward its actual isolation
 * options. A staff waiter must retain Serializable and may safely abort. */
function observedCaller(
  role: "ADMIN" | "TUTOR",
  meetingId: string,
  hooks: Hooks,
) {
  let paused = false;
  const observed = new Proxy(db, {
    get(target, key): unknown {
      if (key !== "$transaction") return Reflect.get(target, key);
      return (
        work: (tx: TransactionDb) => Promise<unknown>,
        options?: Parameters<typeof target.$transaction>[1],
      ) =>
        target.$transaction(
          async (tx) => {
            const [backend] = await tx.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            const records = new Proxy(tx.meetingAttendance, {
              get(delegate, method): unknown {
                if (method !== "findUnique" || !hooks.read)
                  return Reflect.get(delegate, method);
                return async (
                  ...args: Parameters<typeof delegate.findUnique>
                ) => {
                  const row = await delegate.findUnique(...args);
                  if (
                    !paused &&
                    args[0]?.where.meetingId_tutorId?.meetingId === meetingId
                  ) {
                    paused = true;
                    await hooks.read!();
                  }
                  return row;
                };
              },
            });
            const fenced = new Proxy(tx, {
              get(client, method): unknown {
                if (method === "meetingAttendance") return records;
                if (method === "$executeRaw")
                  return (...args: Parameters<typeof client.$executeRaw>) => {
                    for (const value of args)
                      if (typeof value === "string") hooks.locks?.push(value);
                    if (args.includes("program:period"))
                      hooks.periodAttempt?.(backend!.pid);
                    return client.$executeRaw(...args);
                  };
                return Reflect.get(client, method);
              },
            }) as TransactionDb;
            return work(fenced);
          },
          { ...options, timeout: 20000 },
        );
    },
  });
  return caller(role, observed);
}

async function reach<T>(
  gate: Promise<T>,
  writer: Promise<Outcome>,
  label: string,
): Promise<T> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      gate,
      writer.then((result) => {
        if (!result.ok) throw result.error;
        throw new Error(label);
      }),
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error(label)), 8000);
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
}

async function expectPeriodWait(pid: number) {
  // Timers only pace observation. The required condition is a real pending lock.
  for (let attempt = 0; attempt < 150; attempt++) {
    const [row] = await db.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM pg_locks
        WHERE pid=${pid} AND locktype='advisory' AND NOT granted
          AND classid=((hashtextextended('program:period',0) >> 32) & 4294967295)::oid
          AND objid=(hashtextextended('program:period',0) & 4294967295)::oid
          AND objsubid=1) AS waiting`;
    if (row?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    "Competing meeting writer did not queue at the shared period fence",
  );
}

it.each([
  ["excuse", "staff", "PRESENT"],
  ["excuse", "self", "PRESENT"],
  ["cancel", "staff", "PRESENT"],
  ["cancel", "self", "PRESENT"],
  ["excuse", "staff", "EXCUSED_ABSENT"],
  ["excuse", "self", "EXCUSED_ABSENT"],
  ["cancel", "staff", "EXCUSED_ABSENT"],
  ["cancel", "self", "EXCUSED_ABSENT"],
] as const)(
  "%s with %s first preserves the final staff %s ownership",
  async (action, winner, status) => {
    const row = await meeting();
    if (action === "cancel")
      await caller("TUTOR").tutor.excuseMeeting({
        meetingId: row.id,
        reason: "Synthetic self-owned reason before cancellation",
      });
    const paused = barrier();
    const resume = barrier();
    const attempted = barrier<number>();
    const pause = async () => {
      paused.release();
      await resume.promise;
    };
    const runSelf = (hooks: Hooks) => {
      const tutor = observedCaller("TUTOR", row.id, hooks).tutor;
      return action === "cancel"
        ? tutor.cancelMeetingExcuse({ meetingId: row.id })
        : tutor.excuseMeeting({
            meetingId: row.id,
            reason: "Synthetic racing self-excuse",
          });
    };
    const runStaff = (hooks: Hooks) =>
      observedCaller("ADMIN", row.id, hooks).admin.recordMeetingAttendance({
        meetingId: row.id,
        entries: [{ tutorId, status }],
      });
    const leading = outcome(
      winner === "staff" ? runStaff({ read: pause }) : runSelf({ read: pause }),
    );
    let following: Promise<Outcome> | undefined;
    try {
      await reach(
        paused.promise,
        leading,
        "Winning writer did not reach its fenced attendance read",
      );
      following = outcome(
        winner === "staff"
          ? runSelf({ periodAttempt: attempted.release })
          : runStaff({ periodAttempt: attempted.release }),
      );
      const pid = await reach(
        attempted.promise,
        following,
        "Competing writer skipped the shared fence",
      );
      await expectPeriodWait(pid);
    } finally {
      // Release and drain every owned transaction even when instrumentation fails.
      resume.release();
      await leading;
      if (following) await following;
    }
    const first = await leading;
    const second = await following;
    if (!first.ok) throw first.error;
    expect(first.value).toEqual({ ok: true });
    if (winner === "staff") {
      expect(second).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    } else if (!second.ok) {
      // Its authority snapshot may predate the accepted self write. Never weaken
      // Serializable to force two receipts; a fresh staff request owns the retry.
      expect(second.error).toMatchObject({ cause: { code: "P2034" } });
      if (action === "cancel") expect(await attendance(row.id)).toBeNull();
      else
        expect(await attendance(row.id)).toMatchObject({
          status: "EXCUSED_ABSENT",
          excusedAt: dateMatcher,
        });
      await expect(staffStatus(row.id, status)).resolves.toEqual({ ok: true });
    } else {
      expect(second.value).toEqual({ ok: true });
    }
    const reviewed = await attendance(row.id);
    expect(reviewed).toMatchObject({ status, excusedAt: null, reason: null });
    await expect(
      caller("TUTOR").tutor.cancelMeetingExcuse({ meetingId: row.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller("TUTOR").tutor.excuseMeeting({ meetingId: row.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await attendance(row.id)).toEqual(reviewed);
  },
  25000,
);

it.each(["excuse", "cancel"] as const)(
  "historical matching staff evidence protects a marked same-status row from %s",
  async (action) => {
    const row = await meeting();
    await caller("TUTOR").tutor.excuseMeeting({
      meetingId: row.id,
      reason: "Synthetic historical private reason",
    });
    const original = (await attendance(row.id))!;
    await db.auditLog.create({
      data: {
        operation: "admin.recordMeetingAttendance",
        entity: "MeetingAttendance",
        action: "Synthetic pre-fix staff adoption",
        details: {
          outcome: "APPLIED",
          changes: [
            {
              entity: "MeetingAttendance",
              write: "upsert",
              after: [
                {
                  id: original.id,
                  status: "EXCUSED_ABSENT",
                  excusedAt: original.excusedAt!.toISOString(),
                },
              ],
            },
          ],
        },
      },
    });
    const attempt =
      action === "cancel"
        ? caller("TUTOR").tutor.cancelMeetingExcuse({ meetingId: row.id })
        : caller("TUTOR").tutor.excuseMeeting({
            meetingId: row.id,
            reason: "Synthetic stale replacement",
          });
    await expect(attempt).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await attendance(row.id)).toEqual(original);
  },
);

it.each(["different marker", "different row", "queued", "failed"] as const)(
  "%s audit evidence does not claim the current self-excuse generation",
  async (scenario) => {
    const row = await meeting();
    await caller("TUTOR").tutor.excuseMeeting({ meetingId: row.id });
    const original = (await attendance(row.id))!;
    await db.auditLog.create({
      data: {
        operation: "admin.recordMeetingAttendance",
        entity: "MeetingAttendance",
        action: "Synthetic audit counterexample",
        details: {
          outcome:
            scenario === "queued"
              ? "QUEUED"
              : scenario === "failed"
                ? "FAILED"
                : "APPLIED",
          changes: [
            {
              entity: "MeetingAttendance",
              after: [
                {
                  id:
                    scenario === "different row"
                      ? `${original.id}-other`
                      : original.id,
                  excusedAt: new Date(
                    original.excusedAt!.getTime() +
                      (scenario === "different marker" ? 1000 : 0),
                  ).toISOString(),
                },
              ],
            },
          ],
        },
      },
    });
    expect((await selfMeetingExcuseIds(db, [original])).has(original.id)).toBe(
      true,
    );
    await expect(
      caller("TUTOR").tutor.cancelMeetingExcuse({ meetingId: row.id }),
    ).resolves.toEqual({ ok: true });
    expect(await attendance(row.id)).toBeNull();
  },
);

it("staff notes on already staff-owned rows survive another staff save", async () => {
  const row = await meeting();
  await staffStatus(row.id, "PRESENT");
  const original = (await attendance(row.id))!;
  await db.meetingAttendance.update({
    where: { id: original.id },
    data: { reason: "Synthetic staff note" },
  });
  await staffStatus(row.id, "EXCUSED_ABSENT");
  expect(await attendance(row.id)).toMatchObject({
    status: "EXCUSED_ABSENT",
    excusedAt: null,
    reason: "Synthetic staff note",
  });
});

it("staff batches acquire tutor hours fences in stable order", async () => {
  const row = await meeting();
  const others = await Promise.all(
    ["Synthetic B", "Synthetic A"].map((englishName) =>
      db.tutor.create({ data: { englishName, status: "ACTIVE" } }),
    ),
  );
  const locks: string[] = [];
  const ids = [tutorId, ...others.map((tutor) => tutor.id)].sort().reverse();
  await observedCaller("ADMIN", row.id, {
    locks,
  }).admin.recordMeetingAttendance({
    meetingId: row.id,
    entries: ids.map((id) => ({ tutorId: id, status: "PRESENT" })),
  });
  // Reconciliation reacquires these same locks after the complete sorted prelock.
  expect(
    locks
      .filter((key) => key.startsWith("meeting-hours:"))
      .slice(0, ids.length),
  ).toEqual([...ids].sort().map((id) => `meeting-hours:${id}`));
});

it("self excuse/cancel reconciliation preserves manual service-hour adjustments", async () => {
  const adjustment = await db.serviceHourAdjustment.create({
    data: {
      tutorId,
      month: "2026-09",
      schoolYear: "26-27",
      quarter: "Q1",
      type: "EXTRA",
      amount: 1,
      reason: "Synthetic manual adjustment",
    },
  });
  const row = await meeting();
  await caller("TUTOR").tutor.excuseMeeting({ meetingId: row.id });
  await caller("TUTOR").tutor.cancelMeetingExcuse({ meetingId: row.id });
  expect(
    await db.serviceHourAdjustment.findUnique({ where: { id: adjustment.id } }),
  ).toEqual(adjustment);
});
