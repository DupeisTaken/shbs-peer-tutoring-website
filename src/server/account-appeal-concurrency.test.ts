import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import superjson from "superjson";
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { ApprovalQueued } from "./approvals";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

function gate<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function bounded<T>(
  promise: Promise<T>,
  label: string,
  timeout = 8000,
): Promise<T> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error(label)), timeout);
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
type Statement = {
  entity: "user" | "accountAppeal";
  method: string;
  args: unknown[];
  result: unknown;
};

/** Keep the real caller's default audited transaction, SQL, authorization and
 * notifications. Observe completed statements without replacing domain results
 * or preinstalling an outer databaseScope. The PID read only identifies the real
 * competing backend; it does not change isolation or acquire a fixture lock. */
function observeTransaction(options: {
  afterStatement?: (statement: Statement) => Promise<void>;
  onBegin?: (pid: number) => void;
}) {
  return new Proxy(db, {
    get(target, key) {
      if (key !== "$transaction") {
        const value: unknown = Reflect.get(target, key);
        return value;
      }
      return <T>(
        work: (tx: TransactionDb) => Promise<T>,
        config?: Parameters<typeof db.$transaction>[1],
      ) =>
        target.$transaction(async (tx) => {
          const [backend] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid()::integer AS pid`;
          if (!backend) throw new Error("Missing fixture transaction backend");
          options.onBegin?.(backend.pid);
          const delegate = (entity: Statement["entity"]) =>
            new Proxy(tx[entity], {
              get(model, method) {
                const value: unknown = Reflect.get(model, method);
                if (
                  ![
                    "findFirst",
                    "findUnique",
                    "findUniqueOrThrow",
                    "update",
                  ].includes(String(method))
                ) {
                  const bound: unknown =
                    typeof value === "function" ? value.bind(model) : value;
                  return bound;
                }
                return async (...args: unknown[]) => {
                  const result: unknown = await Reflect.apply(
                    value as (...input: unknown[]) => Promise<unknown>,
                    model,
                    args,
                  );
                  await options.afterStatement?.({
                    entity,
                    method: String(method),
                    args,
                    result,
                  });
                  return result;
                };
              },
            });
          const appeals = delegate("accountAppeal");
          const users = delegate("user");
          return work(
            new Proxy(tx, {
              get(transaction, method) {
                if (method === "accountAppeal") return appeals;
                if (method === "user") return users;
                const value: unknown = Reflect.get(transaction, method);
                const bound: unknown =
                  typeof value === "function" ? value.bind(transaction) : value;
                return bound;
              },
            }),
          );
        }, config);
    },
  });
}

function caller(id: string, client = db) {
  const role: Session["role"] =
    id === "appeal-head"
      ? "HEAD"
      : id === "appeal-admin"
        ? "ADMIN"
        : id === "appeal-coordinator"
          ? "COORDINATOR"
          : "VIEWER";
  return createCaller({
    db: client,
    headers: new Headers(),
    session: {
      user: { id, name: `Synthetic ${id}` },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
}
type Caller = ReturnType<typeof caller>;
async function queued(work: Promise<unknown>) {
  const result = await outcome(work);
  if (result.ok)
    throw new Error("Expected an approval proposal, not a live decision");
  const cause = (result.error as { cause?: unknown }).cause;
  expect(cause).toBeInstanceOf(ApprovalQueued);
  if (!(cause instanceof ApprovalQueued)) throw result.error;
  return db.approvalRequest.findUniqueOrThrow({
    where: { id: cause.approvalId },
  });
}
const acceptedDecisionAudits = () =>
  db.auditLog.count({
    where: {
      operation: "admin.decideAppeal",
      OR: [
        { details: { path: ["outcome"], equals: "APPLIED" } },
        { details: { path: ["outcome"], equals: "QUEUED" } },
      ],
    },
  });

/** An old implementation can finish the competing write while the first read
 * is held. Correct locking must instead make that backend actually wait for the
 * first transaction. Waiting for two post-lock reads would deadlock the fix;
 * merely observing transaction entry could let a broken implementation serialize
 * accidentally. This rendezvous handles both without assuming a lock key. */
async function competingProgress(
  work: Promise<Outcome>,
  backend: Promise<number>,
  owner: number,
) {
  let finished = false;
  const completion = work.then(() => {
    finished = true;
    return null;
  });
  const pid = await bounded(
    Promise.race([backend, completion]),
    "Competing caller did not start its transaction",
  );
  if (pid === null) return;
  const deadline = Date.now() + 8000;
  while (!finished) {
    const [state] = await db.$queryRaw<{ blocked: boolean }[]>`
      SELECT ${owner}::integer = ANY(pg_blocking_pids(${pid}::integer)) AS blocked`;
    if (state?.blocked) return;
    if (Date.now() >= deadline)
      throw new Error(
        "Competing transaction neither settled nor waited for the held caller",
      );
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function raceHeldStatement(
  match: (statement: Statement) => boolean,
  first: (client: Caller) => Promise<unknown>,
  second: (client: Caller) => Promise<unknown>,
  firstActor = "appeal-viewer",
  secondActor = "appeal-viewer",
) {
  const held = gate();
  const resume = gate();
  const secondBackend = gate<number>();
  let firstBackend = 0;
  let paused = false;
  const firstWork = outcome(
    first(
      caller(
        firstActor,
        observeTransaction({
          onBegin: (pid) => {
            firstBackend = pid;
          },
          afterStatement: async (statement) => {
            if (paused || !match(statement)) return;
            paused = true;
            held.release();
            await resume.promise;
          },
        }),
      ),
    ),
  );
  let secondWork: Promise<Outcome> | undefined;
  try {
    await bounded(
      held.promise,
      "First caller did not reach the real protected domain statement",
    );
    secondWork = outcome(
      second(
        caller(
          secondActor,
          observeTransaction({ onBegin: secondBackend.release }),
        ),
      ),
    );
    await competingProgress(secondWork, secondBackend.promise, firstBackend);
  } finally {
    // Always release the fixture barrier before observing completion; no pending
    // request or test-owned lock is intentionally left for the next fixture.
    resume.release();
    await bounded(
      Promise.all([firstWork, ...(secondWork ? [secondWork] : [])]),
      "Appeal callers did not settle after barrier release",
      22000,
    );
  }
  return { first: await firstWork, second: await secondWork };
}

const emptyPendingRead = ({ entity, method, args, result }: Statement) => {
  const input = args[0] as { where?: { userId?: string; state?: string } };
  return (
    entity === "accountAppeal" &&
    method === "findFirst" &&
    input.where?.userId === "appeal-viewer" &&
    input.where.state === "PENDING" &&
    result === null
  );
};
function pendingDecisionRead(appealId: string) {
  return ({ entity, method, args, result }: Statement) => {
    const input = args[0] as {
      where?: { id?: string };
      select?: { state?: boolean; createdAt?: boolean };
    };
    const row = result as { state?: string } | null;
    // Exclude userId-only routing preflight and generic audit projections: this
    // is the resolver's full decision read after its target-account/appeal locks.
    return (
      entity === "accountAppeal" &&
      method === "findUniqueOrThrow" &&
      input.where?.id === appealId &&
      !!input.select?.state &&
      !!input.select.createdAt &&
      row?.state === "PENDING"
    );
  };
}
const suspendedUserRead = ({ entity, method, args }: Statement) => {
  const input = args[0] as {
    where?: { id?: string };
    select?: { suspendedAt?: boolean; name?: boolean };
  };
  return (
    entity === "user" &&
    method === "findUniqueOrThrow" &&
    input.where?.id === "appeal-viewer" &&
    !!input.select?.suspendedAt &&
    !!input.select.name
  );
};
function suspensionWrite(suspended: boolean) {
  return ({ entity, method, args }: Statement) => {
    const input = args[0] as {
      where?: { id?: string };
      data?: { suspendedAt?: Date | null };
    };
    return (
      entity === "user" &&
      method === "update" &&
      input.where?.id === "appeal-viewer" &&
      input.data?.suspendedAt !== undefined &&
      Boolean(input.data.suspendedAt) === suspended
    );
  };
}
const outcomeNotices = () =>
  db.notification.findMany({
    where: {
      userId: "appeal-viewer",
      event: { in: ["account_appeal_approved", "account_appeal_declined"] },
    },
    select: { event: true },
  });
const viewer = () =>
  db.user.findUniqueOrThrow({ where: { id: "appeal-viewer" } });
async function accountSideEffects() {
  const where = {
    userId: "appeal-viewer",
    event: {
      in: ["security_changed", "information_changed", "account_reinstated"],
    },
  };
  const [notifications, deliveries] = await Promise.all([
    db.notification.findMany({ where, orderBy: { id: "asc" } }),
    db.emailDelivery.findMany({ where, orderBy: { id: "asc" } }),
  ]);
  return { notifications, deliveries };
}
/** Capture a deliberate review before starting its request. Competing decisions
 * reuse this exact capture; stale cases never refresh it implicitly. */
async function reviewSnapshot(appealId: string) {
  const appeal = await db.accountAppeal.findUniqueOrThrow({
    where: { id: appealId },
    select: { userId: true },
  });
  const account = await db.user.findUniqueOrThrow({
    where: { id: appeal.userId },
    select: { refreshAuthorityRevision: true },
  });
  return {
    appealId,
    expectedAuthorityRevision: account.refreshAuthorityRevision,
  };
}
async function expectDecisionAudit(
  appealId: string,
  ids: string[],
  accessRestored: boolean,
) {
  const records = await db.auditLog.findMany({
    where: {
      entity: "AccountAppeal",
      entityId: appealId,
      details: { path: ["effects", "accessRestored"], equals: accessRestored },
    },
    select: { details: true },
  });
  expect(records).toHaveLength(1);
  expect(records[0]!.details).toMatchObject({
    effects: { coResolvedAppealIds: [...ids].sort(), accessRestored },
  });
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
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
  for (const [id, role] of [
    ["appeal-head", "HEAD"],
    ["appeal-admin", "ADMIN"],
    ["appeal-coordinator", "COORDINATOR"],
    ["appeal-viewer", "VIEWER"],
  ] as const)
    await db.user.create({
      data: {
        id,
        role,
        name: `Synthetic ${id}`,
        email: `${id}@example.test`,
        ...(role === "VIEWER"
          ? { suspendedAt: new Date(), suspendedReason: "Synthetic review" }
          : {}),
      },
    });
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

it.each([true, false])(
  "refuses a sequential duplicate and sends one Admin-first/Head-fallback notice (active Admin: %s)",
  async (adminAvailable) => {
    if (!adminAvailable)
      await db.user.update({
        where: { id: "appeal-admin" },
        data: { suspendedAt: new Date() },
      });
    await expect(
      caller("appeal-viewer").account.submitAppeal({
        message: "Synthetic first appeal",
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      caller("appeal-viewer").account.submitAppeal({
        message: "Synthetic duplicate appeal",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await db.accountAppeal.count({
        where: { userId: "appeal-viewer", state: "PENDING" },
      }),
    ).toBe(1);
    expect(
      await db.notification.findMany({
        where: { event: "account_appeal_requested" },
        select: { userId: true },
      }),
    ).toEqual([{ userId: adminAvailable ? "appeal-admin" : "appeal-head" }]);
  },
);

it("serializes concurrent submissions into one appeal and one reviewer notice", async () => {
  const results = await raceHeldStatement(
    emptyPendingRead,
    (client) => client.account.submitAppeal({ message: "Synthetic tab one" }),
    (client) => client.account.submitAppeal({ message: "Synthetic tab two" }),
  );
  expect(results.first.ok).toBe(true);
  expect(results.second).toMatchObject({
    ok: false,
    error: { code: "BAD_REQUEST" },
  });
  expect({
    accepted: [results.first, results.second].filter((result) => result.ok)
      .length,
    pending: await db.accountAppeal.count({
      where: { userId: "appeal-viewer", state: "PENDING" },
    }),
    notices: await db.notification.count({
      where: { event: "account_appeal_requested" },
    }),
    suspended: Boolean((await viewer()).suspendedAt),
  }).toEqual({ accepted: 1, pending: 1, notices: 1, suspended: true });
}, 40000);

it.each(["APPROVE", "DENY"] as const)(
  "keeps a sequential %s decision terminal",
  async (action) => {
    const appeal = await db.accountAppeal.create({
      data: { userId: "appeal-viewer", message: "Synthetic appeal" },
    });
    const review = await reviewSnapshot(appeal.id);
    await caller("appeal-head").admin.decideAppeal({ ...review, action });
    // Terminal state wins even when approval changed the captured authority epoch.
    await expect(
      caller("appeal-admin").admin.decideAppeal({
        ...review,
        action: action === "APPROVE" ? "DENY" : "APPROVE",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }))
        .state,
    ).toBe(action === "APPROVE" ? "APPROVED" : "DENIED");
    expect(Boolean((await viewer()).suspendedAt)).toBe(action === "DENY");
    expect(await outcomeNotices()).toHaveLength(1);
  },
);

it.each(["APPROVE", "DENY"] as const)(
  "keeps the first locked %s decision authoritative against its concurrent opposite",
  async (action) => {
    const appeal = await db.accountAppeal.create({
      data: { userId: "appeal-viewer", message: "Synthetic appeal" },
    });
    const opposite = action === "APPROVE" ? "DENY" : "APPROVE";
    const review = await reviewSnapshot(appeal.id);
    const results = await raceHeldStatement(
      pendingDecisionRead(appeal.id),
      (client) => client.admin.decideAppeal({ ...review, action }),
      (client) => client.admin.decideAppeal({ ...review, action: opposite }),
      action === "APPROVE" ? "appeal-head" : "appeal-admin",
      opposite === "APPROVE" ? "appeal-head" : "appeal-admin",
    );
    expect(results.first.ok).toBe(true);
    expect(results.second).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST" },
    });
    expect({
      state: (
        await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } })
      ).state,
      suspended: Boolean((await viewer()).suspendedAt),
      approvedNotices: await db.notification.count({
        where: { userId: "appeal-viewer", event: "account_appeal_approved" },
      }),
      deniedNotices: await db.notification.count({
        where: { userId: "appeal-viewer", event: "account_appeal_declined" },
      }),
    }).toEqual({
      state: action === "APPROVE" ? "APPROVED" : "DENIED",
      suspended: action === "DENY",
      approvedNotices: action === "APPROVE" ? 1 : 0,
      deniedNotices: action === "DENY" ? 1 : 0,
    });
  },
  40000,
);

it("does not strand an appeal when reinstatement races after submission's empty pending read", async () => {
  const results = await raceHeldStatement(
    emptyPendingRead,
    (client) =>
      client.account.submitAppeal({
        message: "Synthetic request before reinstatement",
      }),
    (client) => client.admin.reinstateUser({ userId: "appeal-viewer" }),
    "appeal-viewer",
    "appeal-head",
  );
  expect(results.first.ok).toBe(true);
  expect(results.second.ok).toBe(true);
  expect(Boolean((await viewer()).suspendedAt)).toBe(false);
  expect(
    await db.accountAppeal.findMany({
      where: { userId: "appeal-viewer" },
      select: { state: true },
    }),
  ).toEqual([{ state: "APPROVED" }]);
  expect(
    await db.notification.count({
      where: { event: "account_appeal_requested" },
    }),
  ).toBe(1);
  expect(
    await db.notification.count({
      where: { userId: "appeal-viewer", event: "account_reinstated" },
    }),
  ).toBe(1);
}, 40000);

it("rechecks suspension after a reinstatement which already owns the target row", async () => {
  const results = await raceHeldStatement(
    suspensionWrite(false),
    (client) => client.admin.reinstateUser({ userId: "appeal-viewer" }),
    (client) =>
      client.account.submitAppeal({
        message: "Synthetic stale suspended page",
      }),
    "appeal-head",
    "appeal-viewer",
  );
  expect(results.first.ok).toBe(true);
  expect(results.second).toMatchObject({
    ok: false,
    error: { code: "BAD_REQUEST" },
  });
  expect(Boolean((await viewer()).suspendedAt)).toBe(false);
  expect(await db.accountAppeal.count()).toBe(0);
  expect(
    await db.notification.count({
      where: { event: "account_appeal_requested" },
    }),
  ).toBe(0);
}, 40000);

it("reads a newly committed suspension before admitting its queued appeal", async () => {
  await db.user.update({
    where: { id: "appeal-viewer" },
    data: { suspendedAt: null, suspendedReason: null },
  });
  const results = await raceHeldStatement(
    suspensionWrite(true),
    (client) =>
      client.admin.suspendUser({
        userId: "appeal-viewer",
        reason: "Synthetic new suspension",
      }),
    (client) =>
      client.account.submitAppeal({ message: "Synthetic queued appeal" }),
    "appeal-head",
    "appeal-viewer",
  );
  expect(results.first.ok).toBe(true);
  expect(results.second.ok).toBe(true);
  expect((await viewer()).suspendedReason).toBe("Synthetic new suspension");
  expect(await db.accountAppeal.count({ where: { state: "PENDING" } })).toBe(1);
  expect(
    await db.notification.count({
      where: { event: "account_appeal_requested" },
    }),
  ).toBe(1);
}, 40000);

it("does not reuse a stale suspended read to submit after a concurrent approval", async () => {
  const appeal = await db.accountAppeal.create({
    data: {
      userId: "appeal-viewer",
      message: "Synthetic existing pending appeal",
    },
  });
  const review = await reviewSnapshot(appeal.id);
  const results = await raceHeldStatement(
    suspendedUserRead,
    (client) =>
      client.account.submitAppeal({
        message: "Synthetic tab with stale suspension",
      }),
    (client) => client.admin.decideAppeal({ ...review, action: "APPROVE" }),
    "appeal-viewer",
    "appeal-head",
  );
  expect(results.first).toMatchObject({
    ok: false,
    error: { code: "BAD_REQUEST" },
  });
  expect(results.second.ok).toBe(true);
  expect(Boolean((await viewer()).suspendedAt)).toBe(false);
  expect(await db.accountAppeal.count({ where: { state: "PENDING" } })).toBe(0);
  expect(await db.accountAppeal.count()).toBe(1);
  expect(
    await db.notification.count({
      where: { event: "account_appeal_requested" },
    }),
  ).toBe(0);
  expect(await outcomeNotices()).toEqual([
    { event: "account_appeal_approved" },
  ]);
}, 40000);

it.each(["APPROVE", "DENY"] as const)(
  "uses fresh account/pending state when a %s review owns the row before a new submission",
  async (action) => {
    const appeal = await db.accountAppeal.create({
      data: { userId: "appeal-viewer", message: "Synthetic prior appeal" },
    });
    const review = await reviewSnapshot(appeal.id);
    const results = await raceHeldStatement(
      pendingDecisionRead(appeal.id),
      (client) => client.admin.decideAppeal({ ...review, action }),
      (client) =>
        client.account.submitAppeal({
          message: "Synthetic explicit follow-up appeal",
        }),
      action === "APPROVE" ? "appeal-head" : "appeal-admin",
      "appeal-viewer",
    );
    expect(results.first.ok).toBe(true);
    if (action === "APPROVE")
      expect(results.second).toMatchObject({
        ok: false,
        error: { code: "BAD_REQUEST" },
      });
    else expect(results.second.ok).toBe(true);
    expect(Boolean((await viewer()).suspendedAt)).toBe(action === "DENY");
    expect(await db.accountAppeal.count({ where: { state: "PENDING" } })).toBe(
      action === "DENY" ? 1 : 0,
    );
    expect(
      await db.notification.count({
        where: { event: "account_appeal_requested" },
      }),
    ).toBe(action === "DENY" ? 1 : 0);
    expect(await outcomeNotices()).toEqual([
      {
        event:
          action === "APPROVE"
            ? "account_appeal_approved"
            : "account_appeal_declined",
      },
    ]);
  },
  40000,
);

it("co-resolves legacy duplicate pending appeals on approval while preserving their bodies and historical denial", async () => {
  const selected = await db.accountAppeal.create({
    data: {
      userId: "appeal-viewer",
      message: "Synthetic selected pending appeal",
    },
  });
  const duplicate = await db.accountAppeal.create({
    data: {
      userId: "appeal-viewer",
      message: "Synthetic legacy duplicate body",
    },
  });
  const denied = await db.accountAppeal.create({
    data: {
      userId: "appeal-viewer",
      message: "Synthetic historical denied body",
      state: "DENIED",
      decidedAt: new Date("2025-01-01T00:00:00Z"),
      decidedByName: "Synthetic earlier reviewer",
    },
  });
  const review = await reviewSnapshot(selected.id);
  const result = await caller("appeal-head").admin.decideAppeal({
    ...review,
    action: "APPROVE",
  });
  expect(result).toMatchObject({
    ok: true,
    coResolvedAppealIds: [selected.id, duplicate.id].sort(),
    accessRestored: true,
  });
  await expectDecisionAudit(selected.id, [selected.id, duplicate.id], true);
  const decidedAt: unknown = expect.any(Date);
  for (const appeal of [selected, duplicate]) {
    expect(
      await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }),
    ).toMatchObject({
      message: appeal.message,
      state: "APPROVED",
      decidedByName: "Synthetic appeal-head",
      decidedAt,
    });
  }
  expect(
    await db.accountAppeal.findUniqueOrThrow({ where: { id: denied.id } }),
  ).toEqual(denied);
  expect(await db.accountAppeal.count({ where: { state: "PENDING" } })).toBe(0);
  expect(Boolean((await viewer()).suspendedAt)).toBe(false);
  expect(await outcomeNotices()).toEqual([
    { event: "account_appeal_approved" },
  ]);
  await expect(
    caller("appeal-admin").admin.decideAppeal({
      ...review,
      appealId: duplicate.id,
      action: "DENY",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await outcomeNotices()).toEqual([
    { event: "account_appeal_approved" },
  ]);
});

it("does not reopen a historical denied appeal when a different appeal is pending", async () => {
  const denied = await db.accountAppeal.create({
    data: {
      userId: "appeal-viewer",
      message: "Synthetic historical denial",
      state: "DENIED",
      decidedAt: new Date("2025-01-01T00:00:00Z"),
      decidedByName: "Synthetic earlier reviewer",
    },
  });
  const pending = await db.accountAppeal.create({
    data: {
      userId: "appeal-viewer",
      message: "Synthetic current pending appeal",
    },
  });
  await expect(
    caller("appeal-head").admin.decideAppeal({
      ...(await reviewSnapshot(denied.id)),
      action: "APPROVE",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.accountAppeal.findUniqueOrThrow({ where: { id: pending.id } }))
      .state,
  ).toBe("PENDING");
  expect(Boolean((await viewer()).suspendedAt)).toBe(true);
  expect(await outcomeNotices()).toEqual([]);
  await caller("appeal-head").admin.decideAppeal({
    ...(await reviewSnapshot(pending.id)),
    action: "APPROVE",
  });
  expect(
    await db.accountAppeal.findUniqueOrThrow({ where: { id: denied.id } }),
  ).toEqual(denied);
  expect(
    (await db.accountAppeal.findUniqueOrThrow({ where: { id: pending.id } }))
      .state,
  ).toBe("APPROVED");
  expect(await outcomeNotices()).toEqual([
    { event: "account_appeal_approved" },
  ]);
});

it("prevents a concurrent denial of a duplicate row from contradicting approval's account-wide closure", async () => {
  const selected = await db.accountAppeal.create({
    data: {
      userId: "appeal-viewer",
      message: "Synthetic selected pending appeal",
    },
  });
  const duplicate = await db.accountAppeal.create({
    data: {
      userId: "appeal-viewer",
      message: "Synthetic duplicate pending appeal",
    },
  });
  const review = await reviewSnapshot(selected.id);
  const results = await raceHeldStatement(
    pendingDecisionRead(selected.id),
    (client) => client.admin.decideAppeal({ ...review, action: "APPROVE" }),
    (client) =>
      client.admin.decideAppeal({
        ...review,
        appealId: duplicate.id,
        action: "DENY",
      }),
    "appeal-head",
    "appeal-admin",
  );
  expect(results.first.ok).toBe(true);
  expect(results.second).toMatchObject({
    ok: false,
    error: { code: "BAD_REQUEST" },
  });
  expect(await db.accountAppeal.count({ where: { state: "APPROVED" } })).toBe(
    2,
  );
  expect(await db.accountAppeal.count({ where: { state: "PENDING" } })).toBe(0);
  expect(Boolean((await viewer()).suspendedAt)).toBe(false);
  expect(await outcomeNotices()).toEqual([
    { event: "account_appeal_approved" },
  ]);
}, 40000);

it("closes legacy pending appeals on an already-active account without changing any account authority", async () => {
  const selected = await db.accountAppeal.create({
    data: {
      userId: "appeal-viewer",
      message: "Synthetic legacy pending appeal",
    },
  });
  const duplicate = await db.accountAppeal.create({
    data: { userId: "appeal-viewer", message: "Synthetic second legacy body" },
  });
  await db.user.update({
    where: { id: "appeal-viewer" },
    data: { suspendedAt: null, suspendedReason: null },
  });
  const before = await viewer();
  const effectsBefore = await accountSideEffects();
  const result = await caller("appeal-head").admin.decideAppeal({
    ...(await reviewSnapshot(selected.id)),
    action: "APPROVE",
  });
  expect(result).toMatchObject({
    ok: true,
    coResolvedAppealIds: [selected.id, duplicate.id].sort(),
    accessRestored: false,
  });
  await expectDecisionAudit(selected.id, [selected.id, duplicate.id], false);
  expect(await viewer()).toEqual(before);
  expect(await accountSideEffects()).toEqual(effectsBefore);
  for (const appeal of [selected, duplicate]) {
    expect(
      await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }),
    ).toMatchObject({ message: appeal.message, state: "APPROVED" });
  }
  expect(await db.accountAppeal.count({ where: { state: "PENDING" } })).toBe(0);
  expect(await outcomeNotices()).toEqual([
    { event: "account_appeal_approved" },
  ]);
  expect(
    await db.notification.count({
      where: { userId: "appeal-viewer", event: "account_reinstated" },
    }),
  ).toBe(0);
  const notice = await db.notification.findFirstOrThrow({
    where: { userId: "appeal-viewer", event: "account_appeal_approved" },
  });
  expect(notice.body).toMatch(/already active.*unchanged/i);
  expect(notice.body).not.toMatch(/access (?:was|has been) restored/i);
  const detail = (notice.context as { inAppDetail?: { en?: string } })
    .inAppDetail;
  expect(detail?.en).toMatch(/already active.*unchanged/i);
  for (const delivery of await db.emailDelivery.findMany({
    where: { userId: "appeal-viewer", event: "account_appeal_approved" },
  })) {
    expect(
      (delivery.context as { emailDetail?: { en?: string } }).emailDetail?.en,
    ).toMatch(/already active.*unchanged/i);
  }
});

it("refuses an active-account denial without changing pending history, authority or notices", async () => {
  const appeal = await db.accountAppeal.create({
    data: { userId: "appeal-viewer", message: "Synthetic pending cleanup" },
  });
  await db.user.update({
    where: { id: "appeal-viewer" },
    data: { suspendedAt: null, suspendedReason: null },
  });
  const before = await viewer();
  const message: unknown = expect.stringMatching(
    /already active.*Reload.*approve/i,
  );
  await expect(
    caller("appeal-head").admin.decideAppeal({
      ...(await reviewSnapshot(appeal.id)),
      action: "DENY",
    }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message,
  });
  expect(await viewer()).toEqual(before);
  expect(
    await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }),
  ).toEqual(appeal);
  expect(await outcomeNotices()).toEqual([]);
});

it.each([
  ["appeal-head", "APPROVE"],
  ["appeal-head", "DENY"],
  ["appeal-admin", "APPROVE"],
  ["appeal-admin", "DENY"],
] as const)(
  "requires an explicit restriction review for an old %s client %s request",
  async (actor, action) => {
    const appeal = await db.accountAppeal.create({
      data: { userId: "appeal-viewer", message: "Synthetic pending review" },
    });
    const before = await viewer();
    const message: unknown = expect.stringMatching(
      /Reload.*current account restriction review/i,
    );
    await expect(
      caller(actor).admin.decideAppeal({ appealId: appeal.id, action }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message,
    });
    expect(await viewer()).toEqual(before);
    expect(
      await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }),
    ).toEqual(appeal);
    expect(await outcomeNotices()).toEqual([]);
  },
);

it.each(["new-suspension", "role-change", "role-roundtrip"] as const)(
  "rejects the retained old authority review after %s",
  async (change) => {
    await db.user.update({
      where: { id: "appeal-viewer" },
      data: { suspendedAt: new Date("2025-01-01T00:00:00Z") },
    });
    const appeal = await db.accountAppeal.create({
      data: {
        userId: "appeal-viewer",
        message: "Synthetic original restriction appeal",
      },
    });
    const oldReview = await reviewSnapshot(appeal.id);
    if (change === "new-suspension") {
      await caller("appeal-head").admin.suspendUser({
        userId: "appeal-viewer",
        reason: "Synthetic independent newer suspension",
      });
    } else {
      await db.user.update({
        where: { id: "appeal-viewer" },
        data: { role: "STUDENT" },
      });
      if (change === "role-roundtrip")
        await db.user.update({
          where: { id: "appeal-viewer" },
          data: { role: "VIEWER" },
        });
    }
    const changed = await viewer();
    expect(changed.refreshAuthorityRevision).toBeGreaterThan(
      oldReview.expectedAuthorityRevision,
    );
    const message: unknown = expect.stringMatching(
      /restriction changed.*Reload/i,
    );
    await expect(
      caller("appeal-head").admin.decideAppeal({
        ...oldReview,
        action: "APPROVE",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message,
    });
    expect(await viewer()).toEqual(changed);
    expect(
      await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }),
    ).toEqual(appeal);
    expect(await outcomeNotices()).toEqual([]);
    if (change === "new-suspension") {
      const currentReview = await reviewSnapshot(appeal.id);
      expect(
        (await caller("appeal-head").admin.appeals()).find(
          (row) => row.id === appeal.id,
        )?.restriction,
      ).toMatchObject({
        suspendedAt: changed.suspendedAt,
        reason: "Synthetic independent newer suspension",
        authorityRevision: currentReview.expectedAuthorityRevision,
      });
      await expect(
        caller("appeal-head").admin.decideAppeal({
          ...currentReview,
          action: "APPROVE",
        }),
      ).resolves.toMatchObject({ ok: true, accessRestored: true });
      expect(Boolean((await viewer()).suspendedAt)).toBe(false);
      expect(await outcomeNotices()).toEqual([
        { event: "account_appeal_approved" },
      ]);
    }
  },
);

it.each(["timestamp-change", "same-millisecond-reason"] as const)(
  "advances suspension review authority exactly once for %s",
  async (change) => {
    await db.user.update({
      where: { id: "appeal-viewer" },
      data: {
        suspendedAt: new Date("2025-01-01T00:00:00Z"),
        suspendedReason: "Synthetic original restriction",
      },
    });
    const appeal = await db.accountAppeal.create({
      data: {
        userId: "appeal-viewer",
        message: "Synthetic captured restriction appeal",
      },
    });
    const before = await viewer();
    const review = await reviewSnapshot(appeal.id);
    if (change === "same-millisecond-reason") {
      // Freeze Date only: the real database driver and concurrency watchdog timers
      // must keep running while reproducing the equal-timestamp restriction edit.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(before.suspendedAt!);
    }
    await caller("appeal-head").admin.suspendUser({
      userId: "appeal-viewer",
      reason: "Synthetic separately reviewed restriction",
    });
    const after = await viewer();
    expect(after.refreshAuthorityRevision).toBe(
      before.refreshAuthorityRevision + 1,
    );
    expect(after.suspendedReason).toBe(
      "Synthetic separately reviewed restriction",
    );
    if (change === "same-millisecond-reason")
      expect(after.suspendedAt).toEqual(before.suspendedAt);
    else expect(after.suspendedAt).not.toEqual(before.suspendedAt);
    await expect(
      caller("appeal-head").admin.decideAppeal({
        ...review,
        action: "APPROVE",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await viewer()).toEqual(after);
    expect(
      (await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }))
        .state,
    ).toBe("PENDING");
    expect(await outcomeNotices()).toEqual([]);
  },
);

it("rejects a Coordinator's missing review before queueing any proposal or accepted decision audit", async () => {
  const appeal = await db.accountAppeal.create({
    data: { userId: "appeal-viewer", message: "Synthetic pending request" },
  });
  const before = await viewer();
  await expect(
    caller("appeal-coordinator").admin.decideAppeal({
      appealId: appeal.id,
      action: "APPROVE",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await acceptedDecisionAudits()).toBe(0);
  expect(await viewer()).toEqual(before);
  expect(
    await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }),
  ).toEqual(appeal);
  expect(await outcomeNotices()).toEqual([]);
});

it("rejects a Coordinator's stale pending restriction review before queueing", async () => {
  const appeal = await db.accountAppeal.create({
    data: { userId: "appeal-viewer", message: "Synthetic pending request" },
  });
  const review = await reviewSnapshot(appeal.id);
  await caller("appeal-head").admin.suspendUser({
    userId: "appeal-viewer",
    reason: "Synthetic later independent restriction",
  });
  const afterRestriction = await viewer();
  await expect(
    caller("appeal-coordinator").admin.decideAppeal({
      ...review,
      action: "APPROVE",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await acceptedDecisionAudits()).toBe(0);
  expect(await viewer()).toEqual(afterRestriction);
  expect(
    await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }),
  ).toEqual(appeal);
  expect(await outcomeNotices()).toEqual([]);
});

it("rejects a Coordinator's already-terminal captured source before queueing", async () => {
  const appeal = await db.accountAppeal.create({
    data: { userId: "appeal-viewer", message: "Synthetic pending request" },
  });
  const review = await reviewSnapshot(appeal.id);
  await caller("appeal-head").admin.decideAppeal({
    ...review,
    action: "APPROVE",
  });
  const after = await viewer();
  const audits = await acceptedDecisionAudits();
  await expect(
    caller("appeal-coordinator").admin.decideAppeal({
      ...review,
      action: "DENY",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await acceptedDecisionAudits()).toBe(audits);
  expect(await viewer()).toEqual(after);
  expect(await outcomeNotices()).toEqual([
    { event: "account_appeal_approved" },
  ]);
});

it.each([false, true])(
  "keeps the Coordinator's captured restriction revision in its proposal and rechecks it at execution (later change: %s)",
  async (changed) => {
    const appeal = await db.accountAppeal.create({
      data: {
        userId: "appeal-viewer",
        message: "Synthetic reviewed pending source",
      },
    });
    const review = await reviewSnapshot(appeal.id);
    const request = await queued(
      caller("appeal-coordinator").admin.decideAppeal({
        ...review,
        action: "APPROVE",
      }),
    );
    expect(request).toMatchObject({
      requesterId: "appeal-coordinator",
      operation: "admin.decideAppeal",
      state: "PENDING",
    });
    const payload: unknown = superjson.deserialize(
      request.payload as unknown as Parameters<typeof superjson.deserialize>[0],
    );
    expect(payload).toEqual({ ...review, action: "APPROVE" });
    expect(
      (await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }))
        .state,
    ).toBe("PENDING");
    expect(Boolean((await viewer()).suspendedAt)).toBe(true);
    expect(await outcomeNotices()).toEqual([]);
    if (changed) {
      await caller("appeal-head").admin.suspendUser({
        userId: "appeal-viewer",
        reason: "Synthetic change after proposal",
      });
      const newer = await viewer();
      await expect(
        caller("appeal-head").approval.decide({
          id: request.id,
          approve: true,
          note: "Synthetic explicit reviewer check",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await viewer()).toEqual(newer);
      expect(
        (await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }))
          .state,
      ).toBe("PENDING");
      expect(
        (
          await db.approvalRequest.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).state,
      ).toBe("PENDING");
      expect(await outcomeNotices()).toEqual([]);
    } else {
      await caller("appeal-head").approval.decide({
        id: request.id,
        approve: true,
        note: "Synthetic unchanged restriction reviewed",
      });
      expect(Boolean((await viewer()).suspendedAt)).toBe(false);
      expect(
        (await db.accountAppeal.findUniqueOrThrow({ where: { id: appeal.id } }))
          .state,
      ).toBe("APPROVED");
      expect(
        (
          await db.approvalRequest.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).state,
      ).toBe("APPROVED");
      expect(await outcomeNotices()).toEqual([
        { event: "account_appeal_approved" },
      ]);
    }
  },
);
