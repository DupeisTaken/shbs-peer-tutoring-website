import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { db } from "~/server/db";
import { utcDatabaseUrl } from "~/server/database-url";
import {
  intentAccounts,
  intentBusinessSnapshot,
  intentCaller,
  intentWrites,
  resetTranslationIntentFixture,
  type IntentEnvelope,
} from "~/test/translation-intent-fixture";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
beforeEach(resetTranslationIntentFixture);
afterAll(async () => {
  await db.$disconnect();
}, 10_000);
const own = (intent: IntentEnvelope) => ({
  actorId: intent.actorId,
  intentId: intent.id,
});
const envelope = (
  actor: "author" | "publisher" = "author",
): IntentEnvelope => ({
  version: 1,
  id: randomUUID(),
  actorId: intentAccounts[actor].id,
  mode: actor === "author" ? "DRAFT" : "PUBLISH",
});

/** Actual pg locks arbitrate all ordering. Bounded polling observes real backend
 * waits; no fixed sleep or production hook stands in for authorization timing. */
async function barrier<T>(
  key: string,
  work: (control: {
    holder: Client;
    holderPid: number;
    start: (
      request: Promise<unknown>,
    ) => Promise<PromiseSettledResult<unknown>>;
    wait: (blockerPid: number) => Promise<number>;
    release: () => Promise<void>;
  }) => Promise<T>,
) {
  const holder = new Client({
    connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
    connectionTimeoutMillis: 3_000,
    query_timeout: 3_000,
  });
  let open = false;
  const pending: Promise<unknown>[] = [];
  try {
    await holder.connect();
    await holder.query("BEGIN");
    open = true;
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      key,
    ]);
    const holderPid = (
      await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
    ).rows[0]!.pid;
    return await work({
      holder,
      holderPid,
      start(request: Promise<unknown>) {
        const settled = request.then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        );
        pending.push(settled);
        return settled;
      },
      async wait(blockerPid) {
        let pid: number | undefined;
        await vi.waitUntil(
          async () => {
            const rows = await holder.query<{ pid: number }>(
              `
            SELECT waiter.pid FROM pg_locks waiter
            JOIN pg_locks held ON waiter.locktype=held.locktype
              AND waiter.database IS NOT DISTINCT FROM held.database
              AND waiter.classid IS NOT DISTINCT FROM held.classid
              AND waiter.objid IS NOT DISTINCT FROM held.objid
              AND waiter.objsubid IS NOT DISTINCT FROM held.objsubid
            WHERE held.pid=$1::int AND held.locktype='advisory' AND held.granted
              AND NOT waiter.granted AND $1::int=ANY(pg_blocking_pids(waiter.pid))
            LIMIT 1`,
              [blockerPid],
            );
            pid = rows.rows[0]?.pid;
            return pid !== undefined;
          },
          { timeout: 5_000, interval: 20 },
        );
        return pid!;
      },
      async release() {
        await holder.query("COMMIT");
        open = false;
      },
    });
  } finally {
    const errors: unknown[] = [];
    try {
      if (open) await holder.query("ROLLBACK");
    } catch (error) {
      errors.push(error);
    }
    try {
      await holder.end();
    } catch (error) {
      errors.push(error);
    }
    await Promise.all(pending);
    if (errors.length)
      throw new AggregateError(
        errors,
        "Translation intent barrier cleanup failed.",
      );
  }
}

it.each(
  intentWrites.flatMap((write) =>
    (["author", "publisher"] as const).map((actor) => ({ write, actor })),
  ),
)(
  "serializes simultaneous identical $write.operation intent for $actor into one original effect and notice fan-out",
  async ({ write, actor }) => {
    const intent = envelope(actor);
    const beforeNotices = await db.notification.count();
    await barrier(
      "translation:destinations",
      async ({ holderPid, start, wait, release }) => {
        const first = start(write.run(intentCaller(actor), intent));
        const firstPid = await wait(holderPid); // first holds N and is waiting for D
        const second = start(write.run(intentCaller(actor), intent));
        await wait(firstPid); // second really waits on first's N, not a timer guess
        await release();
        expect(await first).toMatchObject({
          status: "fulfilled",
          value: { receipt: { replayed: false } },
        });
        expect(await second).toMatchObject({
          status: "fulfilled",
          value: { receipt: { replayed: true } },
        });
      },
    );
    expect(
      await db.translationDraft.count({
        where: { operation: write.operation },
      }),
    ).toBe(actor === "author" ? 1 : 0);
    expect(await db.translationIntentReceipt.count()).toBe(1);
    expect(await db.notification.count()).toBe(
      beforeNotices + (actor === "author" ? 1 : 0),
    );
  },
  35_000,
);

it.each(["stop-first", "write-first"] as const)(
  "binds %s as the first terminal result and fences a late original POST",
  async (order) => {
    const intent = envelope();
    await barrier(
      "translation:destinations",
      async ({ holderPid, start, wait, release }) => {
        const first = start(
          order === "stop-first"
            ? intentCaller("author").translationIntent.stop(own(intent))
            : intentWrites[0].run(intentCaller("author"), intent),
        );
        const firstPid = await wait(holderPid);
        const second = start(
          order === "stop-first"
            ? intentWrites[0].run(intentCaller("author"), intent)
            : intentCaller("author").translationIntent.stop(own(intent)),
        );
        await wait(firstPid);
        await release();
        if (order === "stop-first") {
          expect(await first).toMatchObject({
            status: "fulfilled",
            value: { status: "STOPPED" },
          });
          expect(await second).toMatchObject({
            status: "rejected",
            reason: { code: "CONFLICT" },
          });
        } else {
          expect(await first).toMatchObject({
            status: "fulfilled",
            value: { receipt: { status: "ACCEPTED", replayed: false } },
          });
          expect(await second).toMatchObject({
            status: "fulfilled",
            value: { status: "ACCEPTED", outcome: "DRAFT_SUBMITTED" },
          });
        }
      },
    );
    const beforeLate = await intentBusinessSnapshot();
    if (order === "stop-first") {
      expect(beforeLate.drafts).toHaveLength(0);
      expect(beforeLate.notices).toHaveLength(0);
      await expect(
        intentWrites[0].run(intentCaller("author"), intent),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } else {
      expect(beforeLate.drafts).toHaveLength(1);
      expect(beforeLate.notices).toHaveLength(1);
      await expect(
        intentWrites[0].run(intentCaller("author"), intent),
      ).resolves.toMatchObject({ receipt: { replayed: true } });
    }
    expect(await intentBusinessSnapshot()).toEqual(beforeLate);
  },
  35_000,
);

it("does not report a paused unaccepted POST as terminal and binds only the first successful payload", async () => {
  const intent = envelope();
  await barrier(
    "translation:destinations",
    async ({ holderPid, start, wait, release }) => {
      const first = start(intentWrites[0].run(intentCaller("author"), intent));
      const firstPid = await wait(holderPid);
      await expect(
        intentCaller("author").translationIntent.get(own(intent)),
      ).resolves.toMatchObject({ status: "NOT_RECORDED" });
      const changed = start(
        intentWrites[0].run(intentCaller("author"), intent, {
          value: "Changed racing text",
        }),
      );
      await wait(firstPid);
      await release();
      expect(await first).toMatchObject({
        status: "fulfilled",
        value: { receipt: { replayed: false } },
      });
      expect(await changed).toMatchObject({
        status: "rejected",
        reason: { code: "CONFLICT" },
      });
    },
  );
  expect(await db.translationDraft.count()).toBe(1);
  expect((await db.translationDraft.findFirstOrThrow()).payload).toMatchObject({
    value: "Save synthetic intent",
  });
  expect(await db.translationIntentReceipt.count()).toBe(1);
}, 35_000);

it.each(["session", "history"] as const)(
  "rejects a captured %s generation changed while keyed admission waits and allows a fresh login to stop the same UUID",
  async (generation) => {
    const intent = envelope();
    await barrier(
      "identity:username-namespace",
      async ({ holder, holderPid, start, wait, release }) => {
        const writing = start(
          intentWrites[0].run(intentCaller("author"), intent),
        );
        await wait(holderPid); // passed middleware, blocked before its actor recheck
        if (generation === "session")
          await holder.query(
            `UPDATE "User" SET "passwordHash"='synthetic-rotated-credential' WHERE id=$1`,
            [intent.actorId],
          );
        else
          await holder.query(
            `UPDATE "User" SET "historyAccessRevision"="historyAccessRevision"+1 WHERE id=$1`,
            [intent.actorId],
          );
        await release();
        expect(await writing).toMatchObject({
          status: "rejected",
          reason: { code: "UNAUTHORIZED" },
        });
      },
    );
    expect(await db.translationDraft.count()).toBe(0);
    expect(await db.translationIntentReceipt.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
    const user = await db.user.findUniqueOrThrow({
      where: { id: intent.actorId },
    });
    const fresh = intentCaller("author", {
      sessionVersion: user.sessionVersion,
      historyAccessRevision: user.historyAccessRevision,
    });
    await expect(
      fresh.translationIntent.get(own(intent)),
    ).resolves.toMatchObject({ status: "NOT_RECORDED" });
    await expect(
      fresh.translationIntent.stop(own(intent)),
    ).resolves.toMatchObject({ status: "STOPPED" });
    await expect(
      intentWrites[0].run(intentCaller("author"), intent),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(intentWrites[0].run(fresh, intent)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  },
  35_000,
);

it.each(["session", "history"] as const)(
  "rejects a captured %s generation changed while own stop waits",
  async (generation) => {
    const intent = envelope();
    await barrier(
      "identity:username-namespace",
      async ({ holder, holderPid, start, wait, release }) => {
        const stopping = start(
          intentCaller("author").translationIntent.stop(own(intent)),
        );
        await wait(holderPid);
        if (generation === "session")
          await holder.query(
            `UPDATE "User" SET "passwordHash"='synthetic-stop-session-rotation' WHERE id=$1`,
            [intent.actorId],
          );
        else
          await holder.query(
            `UPDATE "User" SET "historyAccessRevision"="historyAccessRevision"+1 WHERE id=$1`,
            [intent.actorId],
          );
        await release();
        expect(await stopping).toMatchObject({
          status: "rejected",
          reason: { code: "UNAUTHORIZED" },
        });
      },
    );
    expect(await db.translationIntentReceipt.count()).toBe(0);
    const user = await db.user.findUniqueOrThrow({
      where: { id: intent.actorId },
    });
    const fresh = intentCaller("author", {
      sessionVersion: user.sessionVersion,
      historyAccessRevision: user.historyAccessRevision,
    });
    await expect(
      fresh.translationIntent.stop(own(intent)),
    ).resolves.toMatchObject({ status: "STOPPED" });
    expect(await db.translationDraft.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
  },
  35_000,
);

it.each(["revoked", "suspended", "retired", "voided", "mode"] as const)(
  "rechecks %s authority after a real namespace wait before first admission",
  async (change) => {
    const intent = envelope();
    await barrier(
      "identity:username-namespace",
      async ({ holder, holderPid, start, wait, release }) => {
        const writing = start(
          intentWrites[0].run(intentCaller("author"), intent),
        );
        await wait(holderPid);
        const statements = {
          revoked: 'UPDATE "User" SET "canTranslate"=false WHERE id=$1',
          suspended:
            'UPDATE "User" SET "suspendedAt"=CURRENT_TIMESTAMP WHERE id=$1',
          retired:
            'UPDATE "User" SET "mergedIntoId"=\'intent-other\' WHERE id=$1',
          voided:
            'UPDATE "User" SET "recoveryVoidedAt"=CURRENT_TIMESTAMP WHERE id=$1',
          mode: "UPDATE \"User\" SET role='ADMIN' WHERE id=$1",
        };
        await holder.query(statements[change], [intent.actorId]);
        await release();
        const code =
          change === "mode"
            ? "CONFLICT"
            : ["retired", "voided"].includes(change)
              ? "UNAUTHORIZED"
              : "FORBIDDEN";
        expect(await writing).toMatchObject({
          status: "rejected",
          reason: { code },
        });
      },
    );
    expect(await db.translationDraft.count()).toBe(0);
    expect(await db.translationIntentReceipt.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
  },
  35_000,
);
