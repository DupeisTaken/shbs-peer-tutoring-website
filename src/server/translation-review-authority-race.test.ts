import type { Session } from "next-auth";
import { Client } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { TranslationDraft } from "../../generated/prisma";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { utcDatabaseUrl } from "~/server/database-url";
import { db } from "~/server/db";

// Validate before fixture setup or the separate lock-holding connection can
// reach a database. Root supplies an isolated local *_test target; no fixed port.
assertIsolatedTestDatabase(process.env.DATABASE_URL);

const accounts = {
  author: { id: "translation-authority-author", role: "STUDENT" },
  reviewer: { id: "translation-authority-reviewer", role: "ADMIN" },
  head: { id: "translation-authority-head", role: "HEAD" },
  coordinator: { id: "translation-authority-coordinator", role: "COORDINATOR" },
} as const;

function caller(actor: keyof typeof accounts) {
  const account = accounts[actor];
  const session: Session = {
    user: { id: account.id, name: "Synthetic translation authority" },
    role: account.role,
    tutorId: null,
    sessionVersion: 0,
    historyAccessRevision: 0,
    expires: "2099-01-01T00:00:00Z",
  };
  return createCaller({ db, headers: new Headers(), session });
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
  await db.user.createMany({
    data: Object.entries(accounts).map(([actor, account]) => ({
      ...account,
      email: `translation-authority-${actor}@example.test`,
      name: "Synthetic translation authority",
      canTranslate: true,
    })),
  });
});

afterAll(async () => {
  await db.$disconnect();
}, 10_000);

const value = "Save authority-reviewed changes";

async function createDraft() {
  await caller("author").localization.setString({
    locale: "en",
    key: "common.save",
    value,
  });
  return db.translationDraft.findFirstOrThrow({
    where: { authorId: accounts.author.id, state: "PENDING" },
  });
}

/** Exercise the actual caller without an outer test transaction or authorization
 * hook. Observing its destination-lock wait proves preauthorization completed.
 * The separate holder can commit the authority change even with a one-slot pool. */
type ActorTransition = {
  actorId: string;
  kind:
    | "demote"
    | "suspend"
    | "session"
    | "history"
    | "promote"
    | "translator-revoke";
};
type SourceTransition = {
  draftId: string;
  kind: "source-version" | "source-terminal";
};

async function requestBehindDestinationLock(
  request: () => Promise<unknown>,
  transition?: ActorTransition | SourceTransition,
) {
  const holder = new Client({
    connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
    connectionTimeoutMillis: 3_000,
    query_timeout: 3_000,
  });
  let holderOpen = false;
  let finished = false;
  let waitingPid: number | undefined;
  let deciding: Promise<PromiseSettledResult<unknown>> | undefined;
  try {
    await holder.connect();
    await holder.query("BEGIN");
    holderOpen = true;
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "translation:destinations",
    ]);
    const holderPid = (
      await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
    ).rows[0]!.pid;

    // Attach both settlement handlers immediately: failure during observation
    // must still release the blocker and drain this real request in finally.
    deciding = request().then(
      (result) => {
        finished = true;
        return { status: "fulfilled" as const, value: result };
      },
      (reason: unknown) => {
        finished = true;
        return { status: "rejected" as const, reason };
      },
    );
    await vi.waitUntil(
      async () => {
        const observation = await holder.query<{ pid: number }>(
          `
        SELECT waiter.pid
        FROM pg_locks AS waiter
        JOIN pg_locks AS held ON waiter.locktype=held.locktype
          AND waiter.database IS NOT DISTINCT FROM held.database
          AND waiter.classid IS NOT DISTINCT FROM held.classid
          AND waiter.objid IS NOT DISTINCT FROM held.objid
          AND waiter.objsubid IS NOT DISTINCT FROM held.objsubid
        WHERE held.pid=$1::int AND held.locktype='advisory' AND held.granted
          AND NOT waiter.granted
          AND $1::int=ANY(pg_blocking_pids(waiter.pid))
        LIMIT 1`,
          [holderPid],
        );
        waitingPid = observation.rows[0]?.pid;
        return waitingPid !== undefined || finished;
      },
      { timeout: 5_000, interval: 20 },
    );
    expect(
      waitingPid,
      "The real review must wait on the held destination lock.",
    ).toBeDefined();
    expect(
      finished,
      "The review cannot finish before its authority transition.",
    ).toBe(false);

    if (transition?.kind === "demote") {
      // A bounded real database authority transition, committed together with
      // release of the actual destination barrier. Translator assignment stays
      // true so a stale reviewer cannot silently become a new draft author.
      const changed = await holder.query<{
        role: string;
        canTranslate: boolean;
      }>(
        `
        UPDATE "public"."User" SET role='STUDENT', "canTranslate"=true
        WHERE id=$1 RETURNING role, "canTranslate"`,
        [transition.actorId],
      );
      expect(changed.rows).toEqual([{ role: "STUDENT", canTranslate: true }]);
    } else if (transition?.kind === "suspend") {
      await holder.query(
        'UPDATE "User" SET "suspendedAt"=CURRENT_TIMESTAMP WHERE id=$1',
        [transition.actorId],
      );
    } else if (transition?.kind === "session") {
      // The actual account trigger rotates sessionVersion; the request retains
      // its explicit pre-wait trusted generation instead of rereading it here.
      await holder.query(
        'UPDATE "User" SET "passwordHash"=\'synthetic-review-rotation\' WHERE id=$1',
        [transition.actorId],
      );
    } else if (transition?.kind === "history") {
      await holder.query(
        'UPDATE "User" SET "historyAccessRevision"="historyAccessRevision"+1 WHERE id=$1',
        [transition.actorId],
      );
    } else if (transition?.kind === "promote") {
      await holder.query("UPDATE \"User\" SET role='ADMIN' WHERE id=$1", [
        transition.actorId,
      ]);
    } else if (transition?.kind === "translator-revoke") {
      await holder.query('UPDATE "User" SET "canTranslate"=false WHERE id=$1', [
        transition.actorId,
      ]);
    } else if (transition?.kind === "source-version") {
      await holder.query(
        'UPDATE "TranslationDraft" SET "updatedAt"="updatedAt"+interval \'1 millisecond\' WHERE id=$1',
        [transition.draftId],
      );
    } else if (transition?.kind === "source-terminal") {
      await holder.query(
        'UPDATE "TranslationDraft" SET state=\'REJECTED\',"reviewedById"=$2,"updatedAt"="updatedAt"+interval \'1 millisecond\' WHERE id=$1',
        [transition.draftId, accounts.head.id],
      );
    }
    await holder.query("COMMIT");
    holderOpen = false;
    return await deciding;
  } finally {
    // No owned connection, blocker or late request can leak into the next case.
    const errors: unknown[] = [];
    try {
      if (holderOpen) await holder.query("ROLLBACK");
    } catch (error) {
      errors.push(error);
    }
    try {
      await holder.end();
    } catch (error) {
      errors.push(error);
    }
    if (deciding) await deciding;
    if (errors.length)
      throw new AggregateError(
        errors,
        "Translation authority barrier cleanup failed.",
      );
  }
}

function reviewBehindDestinationLock(
  draft: TranslationDraft,
  approve: boolean,
  demote: boolean,
) {
  // Construct the authenticated caller before entering the barrier; no expected
  // generation is ever manufactured from a post-wait actor read.
  const reviewer = caller("reviewer");
  return requestBehindDestinationLock(
    () =>
      reviewer.translationReview.decide({
        id: draft.id,
        approve,
        expectedUpdatedAt: draft.updatedAt,
      }),
    demote ? { kind: "demote", actorId: accounts.reviewer.id } : undefined,
  );
}

it("publishes a normal direct review after its destination-lock wait", async () => {
  const draft = await createDraft();
  const outcome = await reviewBehindDestinationLock(draft, true, false);
  expect(outcome).toMatchObject({ status: "fulfilled", value: { ok: true } });
  expect(
    await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }),
  ).toMatchObject({ state: "APPROVED", reviewedById: accounts.reviewer.id });
  expect(await db.translationDraft.count()).toBe(1);
  expect(
    await db.messageOverride.findUniqueOrThrow({
      where: { locale_key: { locale: "en", key: "common.save" } },
    }),
  ).toMatchObject({ value });
  expect(await db.approvalRequest.count()).toBe(0);
}, 30_000);

it.each([
  { decision: "approval", approve: true },
  { decision: "rejection", approve: false },
])(
  "refuses direct $decision after reviewer demotion during the destination-lock wait",
  async ({ approve }) => {
    const draft = await createDraft();
    const before = {
      notifications: await db.notification.count(),
      appliedAudits: await db.auditLog.count({
        where: { kind: { not: "ATTEMPT" } },
      }),
    };
    const outcome = await reviewBehindDestinationLock(draft, approve, true);
    // Soft-check the response so the baseline also exposes any original decision,
    // replacement draft or publication committed by a stale reviewer context.
    expect
      .soft(outcome)
      .toMatchObject({ status: "rejected", reason: { code: "FORBIDDEN" } });
    expect
      .soft(
        await db.translationDraft.findUniqueOrThrow({
          where: { id: draft.id },
        }),
      )
      .toEqual(draft);
    expect.soft(await db.translationDraft.count()).toBe(1);
    expect
      .soft(
        await db.translationDraft.count({
          where: { authorId: accounts.reviewer.id },
        }),
      )
      .toBe(0);
    expect.soft(await db.messageOverride.count()).toBe(0);
    expect.soft(await db.approvalRequest.count()).toBe(0);
    expect.soft(await db.notification.count()).toBe(before.notifications);
    // Existing independent denied/failed ATTEMPT evidence may remain after
    // rollback; no new applied publication or decision evidence may remain.
    expect
      .soft(await db.auditLog.count({ where: { kind: { not: "ATTEMPT" } } }))
      .toBe(before.appliedAudits);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: accounts.reviewer.id } }),
    ).toMatchObject({ role: "STUDENT", canTranslate: true });
  },
  30_000,
);

async function decisionEffects() {
  return {
    drafts: await db.translationDraft.findMany({ orderBy: { id: "asc" } }),
    overrides: await db.messageOverride.findMany({ orderBy: { id: "asc" } }),
    approvals: await db.approvalRequest.findMany({ orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ orderBy: { id: "asc" } }),
    appliedAudits: await db.auditLog.count({
      where: { kind: { not: "ATTEMPT" } },
    }),
  };
}

const decisions = [
  { decision: "approval", approve: true },
  { decision: "rejection", approve: false },
] as const;

it.each(
  (["reviewer", "head"] as const).flatMap((actor) =>
    decisions.map((decision) => ({ actor, ...decision })),
  ),
)(
  "allows retained $actor $decision without Translator assignment after the destination wait",
  async ({ actor, approve }) => {
    const draft = await createDraft();
    await db.user.update({
      where: { id: accounts[actor].id },
      data: { canTranslate: false },
    });
    const reviewer = caller(actor);
    const outcome = await requestBehindDestinationLock(() =>
      reviewer.translationReview.decide({
        id: draft.id,
        approve,
        expectedUpdatedAt: draft.updatedAt,
      }),
    );
    expect(outcome).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(
      await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }),
    ).toMatchObject({
      state: approve ? "APPROVED" : "REJECTED",
      reviewedById: accounts[actor].id,
    });
    expect(await db.translationDraft.count()).toBe(1);
    expect(await db.messageOverride.count()).toBe(approve ? 1 : 0);
    expect(await db.approvalRequest.count()).toBe(0);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: accounts[actor].id } }))
        .canTranslate,
    ).toBe(false);
  },
  30_000,
);

it("retains management review when only Translator assignment is revoked during the destination wait", async () => {
  const draft = await createDraft();
  const reviewer = caller("reviewer");
  const outcome = await requestBehindDestinationLock(
    () =>
      reviewer.translationReview.decide({
        id: draft.id,
        approve: true,
        expectedUpdatedAt: draft.updatedAt,
      }),
    { kind: "translator-revoke", actorId: accounts.reviewer.id },
  );
  expect(outcome).toMatchObject({ status: "fulfilled", value: { ok: true } });
  expect(
    (await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }))
      .state,
  ).toBe("APPROVED");
  expect((await db.messageOverride.findFirstOrThrow()).value).toBe(value);
  expect(await db.translationDraft.count()).toBe(1);
});

it.each(
  (["suspend", "session", "history"] as const).flatMap((kind) =>
    decisions.map((decision) => ({ kind, ...decision })),
  ),
)(
  "refuses direct $decision after $kind changes during the destination wait",
  async ({ kind, approve }) => {
    const draft = await createDraft();
    const before = await decisionEffects();
    const reviewer = caller("reviewer");
    const outcome = await requestBehindDestinationLock(
      () =>
        reviewer.translationReview.decide({
          id: draft.id,
          approve,
          expectedUpdatedAt: draft.updatedAt,
        }),
      { kind, actorId: accounts.reviewer.id },
    );
    expect(outcome).toMatchObject({
      status: "rejected",
      reason: { code: kind === "suspend" ? "FORBIDDEN" : "UNAUTHORIZED" },
    });
    expect(await decisionEffects()).toEqual(before);
  },
  30_000,
);

it.each([false, true])(
  "queues the original Coordinator decision after a real destination wait (promoted=%s)",
  async (promoted) => {
    const draft = await createDraft();
    const coordinator = caller("coordinator");
    const outcome = await requestBehindDestinationLock(
      () =>
        coordinator.translationReview.decide({
          id: draft.id,
          approve: true,
          expectedUpdatedAt: draft.updatedAt,
        }),
      promoted
        ? { kind: "promote", actorId: accounts.coordinator.id }
        : undefined,
    );
    expect(outcome).toMatchObject({
      status: "rejected",
      reason: { code: "PRECONDITION_FAILED" },
    });
    expect(await db.approvalRequest.count()).toBe(1);
    expect(await db.approvalRequest.findFirstOrThrow()).toMatchObject({
      requesterId: accounts.coordinator.id,
      operation: "translationReview.decide",
      state: "PENDING",
    });
    expect(
      await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }),
    ).toEqual(draft);
    expect(await db.translationDraft.count()).toBe(1);
    expect(await db.messageOverride.count()).toBe(0);
  },
  30_000,
);

it.each([
  { kind: "demote", approve: true, code: "FORBIDDEN" },
  { kind: "suspend", approve: false, code: "FORBIDDEN" },
  { kind: "session", approve: true, code: "UNAUTHORIZED" },
  { kind: "history", approve: false, code: "UNAUTHORIZED" },
] as const)(
  "does not queue a Coordinator decision after $kind changes during the destination wait",
  async ({ kind, approve, code }) => {
    const draft = await createDraft();
    const before = await decisionEffects();
    const coordinator = caller("coordinator");
    const outcome = await requestBehindDestinationLock(
      () =>
        coordinator.translationReview.decide({
          id: draft.id,
          approve,
          expectedUpdatedAt: draft.updatedAt,
        }),
      { kind, actorId: accounts.coordinator.id },
    );
    expect(outcome).toMatchObject({ status: "rejected", reason: { code } });
    expect(await decisionEffects()).toEqual(before);
  },
  30_000,
);

it.each(
  (["source-version", "source-terminal"] as const).flatMap((kind) =>
    decisions.map((decision) => ({ kind, ...decision })),
  ),
)(
  "does not queue stale $decision after $kind changes during the destination wait",
  async ({ kind, approve }) => {
    const draft = await createDraft();
    const before = await decisionEffects();
    const coordinator = caller("coordinator");
    const outcome = await requestBehindDestinationLock(
      () =>
        coordinator.translationReview.decide({
          id: draft.id,
          approve,
          expectedUpdatedAt: draft.updatedAt,
        }),
      { kind, draftId: draft.id },
    );
    expect(outcome).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    const after = await decisionEffects();
    expect(after).toEqual({
      ...before,
      drafts: [
        {
          ...draft,
          updatedAt: new Date(draft.updatedAt.getTime() + 1),
          ...(kind === "source-terminal"
            ? { state: "REJECTED", reviewedById: accounts.head.id }
            : {}),
        },
      ],
    });
  },
  30_000,
);

async function queuedDecision(draft: TranslationDraft, approve = true) {
  await expect(
    caller("coordinator").translationReview.decide({
      id: draft.id,
      approve,
      expectedUpdatedAt: draft.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  return db.approvalRequest.findFirstOrThrow({
    where: { operation: "translationReview.decide", state: "PENDING" },
  });
}

it.each(
  (["reviewer", "head"] as const).flatMap((actor) =>
    decisions.map((decision) => ({ actor, ...decision })),
  ),
)(
  "applies queued $decision through retained $actor authority without Translator assignment",
  async ({ actor, approve }) => {
    const draft = await createDraft();
    const approval = await queuedDecision(draft, approve);
    await db.user.update({
      where: { id: accounts[actor].id },
      data: { canTranslate: false },
    });
    const reviewer = caller(actor);
    const outcome = await requestBehindDestinationLock(() =>
      reviewer.approval.decide({
        id: approval.id,
        approve: true,
        note: "Synthetic unchanged queued translation review",
      }),
    );
    expect(outcome).toMatchObject({
      status: "fulfilled",
      value: { state: "APPROVED" },
    });
    expect(
      await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }),
    ).toMatchObject({
      state: approve ? "APPROVED" : "REJECTED",
      reviewedById: accounts[actor].id,
    });
    if (approve)
      expect((await db.messageOverride.findFirstOrThrow()).value).toBe(value);
    else expect(await db.messageOverride.count()).toBe(0);
    expect(await db.translationDraft.count()).toBe(1);
    expect(await db.approvalRequest.count()).toBe(1);
  },
  30_000,
);

it.each([
  { actor: "reviewer", kind: "demote", approve: true },
  { actor: "reviewer", kind: "suspend", approve: false },
  { actor: "reviewer", kind: "session", approve: true },
  { actor: "reviewer", kind: "history", approve: false },
  { actor: "coordinator", kind: "demote", approve: true },
  { actor: "coordinator", kind: "suspend", approve: false },
] as const)(
  "refuses queued decision after original $actor $kind change during replay destination wait (approve=$approve)",
  async ({ actor, kind, approve }) => {
    const draft = await createDraft();
    const approval = await queuedDecision(draft, approve);
    const before = await decisionEffects();
    const reviewer = caller("reviewer");
    const outcome = await requestBehindDestinationLock(
      () =>
        reviewer.approval.decide({
          id: approval.id,
          approve: true,
          note: "Synthetic queued publication must retain live authority",
        }),
      { kind, actorId: accounts[actor].id },
    );
    // The outer generic approval owns a Serializable snapshot. Its post-wait
    // User SHARE fence must refuse that stale snapshot without replaying it.
    expect(outcome).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(await decisionEffects()).toEqual(before);
  },
  30_000,
);
