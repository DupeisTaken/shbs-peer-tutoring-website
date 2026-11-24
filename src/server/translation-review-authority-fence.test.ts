import { Client } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { db } from "~/server/db";
import { utcDatabaseUrl } from "~/server/database-url";
import {
  intentAccounts,
  intentCaller,
  intentWrites,
  resetTranslationIntentFixture,
} from "~/test/translation-intent-fixture";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
beforeEach(resetTranslationIntentFixture);
afterAll(async () => {
  await db.$disconnect();
}, 10_000);

type DecisionProof = {
  state: string;
  reviewedById: string | null;
  publishedValue: string | null;
};
const value = "Save with a held reviewer fence";

it.each([
  { decision: "approval", approve: true },
  { decision: "rejection", approve: false },
])(
  "holds reviewer authority through $decision commit before a waiting role change",
  async ({ approve }) => {
    await db.user.update({
      where: { id: intentAccounts.publisher.id },
      data: { canTranslate: false },
    });
    await intentWrites[0].run(intentCaller("author"), undefined, { value });
    const draft = await db.translationDraft.findFirstOrThrow({
      where: { authorId: intentAccounts.author.id, state: "PENDING" },
    });
    const beforeNotices = await db.notification.count();
    expect(await db.translationIntentReceipt.count()).toBe(0);
    // The genuine authenticated caller captures the fresh fixture's trusted zero
    // generations before either wait. Management review needs no Translator grant.
    const reviewer = intentCaller("publisher");
    const holder = new Client({
      connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
      connectionTimeoutMillis: 3_000,
      query_timeout: 3_000,
    });
    const mutator = new Client({
      connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
      connectionTimeoutMillis: 3_000,
      query_timeout: 15_000,
      statement_timeout: 12_000,
    });
    let holderOpen = false;
    let mutatorOpen = false;
    let reviewerFinished = false;
    let mutatorFinished = false;
    let deciding: Promise<PromiseSettledResult<{ ok: boolean }>> | undefined;
    let mutating:
      | Promise<PromiseSettledResult<{ role: string; proof: DecisionProof }>>
      | undefined;
    try {
      await holder.connect();
      await holder.query("BEGIN");
      holderOpen = true;
      // Hold only this source row, never D. The real decision must pass D and its
      // reviewer authority fence before its terminal source UPDATE reaches us.
      const locked = await holder.query<{ id: string }>(
        'SELECT id FROM "TranslationDraft" WHERE id=$1 FOR UPDATE',
        [draft.id],
      );
      expect(locked.rows).toEqual([{ id: draft.id }]);
      const holderPid = (
        await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid;
      deciding = reviewer.translationReview
        .decide({ id: draft.id, approve, expectedUpdatedAt: draft.updatedAt })
        .then(
          (result) => {
            reviewerFinished = true;
            return { status: "fulfilled" as const, value: result };
          },
          (reason: unknown) => {
            reviewerFinished = true;
            return { status: "rejected" as const, reason };
          },
        );
      let reviewerPid: number | undefined;
      await vi.waitUntil(
        async () => {
          await holder.query("SELECT pg_stat_clear_snapshot()");
          const observation = await holder.query<{ pid: number }>(
            `
        SELECT a.pid FROM pg_stat_activity a
        WHERE a.datname=current_database() AND a.pid<>pg_backend_pid()
          AND a.wait_event_type='Lock' AND a.query LIKE '%TranslationDraft%'
          AND $1::int=ANY(pg_blocking_pids(a.pid))
        LIMIT 1`,
            [holderPid],
          );
          reviewerPid = observation.rows[0]?.pid;
          return reviewerPid !== undefined || reviewerFinished;
        },
        { timeout: 5_000, interval: 20 },
      );
      expect(
        reviewerPid,
        "The actual decision must wait on its original source row after authorization.",
      ).toBeDefined();
      expect(reviewerFinished).toBe(false);

      await mutator.connect();
      const mutatorPid = (
        await mutator.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid;
      await mutator.query("BEGIN");
      mutatorOpen = true;
      // Attach settlement immediately; every path below drains this real UPDATE.
      mutating = (async () => {
        const changed = await mutator.query<{ role: string }>(
          "UPDATE \"User\" SET role='STUDENT' WHERE id=$1 RETURNING role",
          [intentAccounts.publisher.id],
        );
        // A fresh statement after the blocked UPDATE, before its COMMIT, must see
        // the already-committed decision. Do not infer commit order from JS promise
        // settlement or from RETURNING subqueries using the UPDATE's old snapshot.
        const proof = await mutator.query<DecisionProof>(
          `
        SELECT d.state,d."reviewedById",
          (SELECT value FROM "MessageOverride" WHERE locale='en' AND key='common.save') AS "publishedValue"
        FROM "TranslationDraft" d WHERE d.id=$1`,
          [draft.id],
        );
        await mutator.query("COMMIT");
        mutatorOpen = false;
        return { role: changed.rows[0]!.role, proof: proof.rows[0]! };
      })().then(
        (result) => {
          mutatorFinished = true;
          return { status: "fulfilled" as const, value: result };
        },
        (reason: unknown) => {
          mutatorFinished = true;
          return { status: "rejected" as const, reason };
        },
      );
      let mutatorWaiting = false;
      await vi.waitUntil(
        async () => {
          await holder.query("SELECT pg_stat_clear_snapshot()");
          const observation = await holder.query<{ waiting: boolean }>(
            `
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid=$1::int
          AND a.wait_event_type='Lock' AND $2::int=ANY(pg_blocking_pids(a.pid))) AS waiting`,
            [mutatorPid, reviewerPid],
          );
          mutatorWaiting = observation.rows[0]?.waiting === true;
          return mutatorWaiting || mutatorFinished;
        },
        { timeout: 5_000, interval: 20 },
      );
      expect(
        mutatorWaiting,
        "The role UPDATE must wait on the admitted reviewer's held User fence.",
      ).toBe(true);
      expect(mutatorFinished).toBe(false);
      expect(reviewerFinished).toBe(false);

      await holder.query("COMMIT");
      holderOpen = false;
      expect(await deciding).toMatchObject({
        status: "fulfilled",
        value: { ok: true },
      });
      expect(await mutating).toEqual({
        status: "fulfilled",
        value: {
          role: "STUDENT",
          proof: {
            state: approve ? "APPROVED" : "REJECTED",
            reviewedById: intentAccounts.publisher.id,
            publishedValue: approve ? value : null,
          },
        },
      });
      expect(
        await db.translationDraft.findUniqueOrThrow({
          where: { id: draft.id },
        }),
      ).toMatchObject({
        state: approve ? "APPROVED" : "REJECTED",
        reviewedById: intentAccounts.publisher.id,
      });
      expect(await db.translationDraft.count()).toBe(1);
      expect(
        await db.translationDraft.count({
          where: { authorId: intentAccounts.publisher.id },
        }),
      ).toBe(0);
      expect(await db.translationIntentReceipt.count()).toBe(0);
      expect(await db.messageOverride.count()).toBe(approve ? 1 : 0);
      expect(await db.approvalRequest.count()).toBe(0);
      expect(await db.notification.count()).toBe(beforeNotices);
      expect(
        await db.user.findUniqueOrThrow({
          where: { id: intentAccounts.publisher.id },
        }),
      ).toMatchObject({ role: "STUDENT", canTranslate: false });
    } finally {
      // Release the source before draining the real review/mutator. Their server
      // transactions/timeouts bound failure cleanup; no owned lock/request survives.
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
      if (mutating) await mutating;
      try {
        if (mutatorOpen) await mutator.query("ROLLBACK");
      } catch (error) {
        errors.push(error);
      }
      try {
        await mutator.end();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          "Reviewer authority fence fixture cleanup failed.",
        );
    }
  },
  35_000,
);
