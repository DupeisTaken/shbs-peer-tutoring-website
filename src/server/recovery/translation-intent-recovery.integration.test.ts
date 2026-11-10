import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { db } from "~/server/db";
import { decideMembership } from "~/server/membership";
import { reconcileApplication } from "~/server/tutors/application-status";
import {
  intentAccounts,
  intentCaller,
  intentWrites,
  resetTranslationIntentFixture,
} from "~/test/translation-intent-fixture";
import {
  beginAdmissionRecoveryCapture,
  finishAdmissionRecoveryCapture,
} from "./capture";
import {
  applyAdmissionRecoveryFromOperator,
  inspectAdmissionRecovery,
} from "./admission";
import {
  applyRecoveryCheckpointFromOperator,
  inspectRecoveryCheckpoint,
} from "./checkpoint";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
beforeEach(async () => {
  await resetTranslationIntentFixture();
  await db.term.create({
    data: {
      id: "intent-recovery-term",
      name: "Synthetic term",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
});
afterAll(async () => {
  await db.$disconnect();
}, 10_000);

async function terminalRows() {
  const actorId = intentAccounts.author.id;
  await intentWrites[0].run(intentCaller("author"), {
    version: 1,
    id: randomUUID(),
    actorId,
    mode: "DRAFT",
  });
  await intentCaller("author").translationIntent.stop({
    actorId,
    intentId: randomUUID(),
  });
  return db.translationIntentReceipt.findMany({
    orderBy: [{ actorId: "asc" }, { intentId: "asc" }],
  });
}

async function admission() {
  const application = await db.tutorApplication.create({
    data: {
      name: "Synthetic recovery candidate",
      firstName: "Synthetic",
      lastName: "Candidate",
      email: "intent-recovery-candidate@example.test",
      status: "INTERVIEW",
      interviewCompletedAt: new Date("2026-09-18T03:00:00Z"),
      interviewDurationMin: 45,
    },
  });
  const actionId = await db.$transaction(async (tx) => {
    const actionId = await beginAdmissionRecoveryCapture(tx, application.id);
    await tx.tutorApplication.update({
      where: { id: application.id },
      data: {
        status: "ACCEPTED",
        decidedAt: new Date(),
        decisionComment: "Synthetic reviewed admission",
      },
    });
    await reconcileApplication(tx, application.id);
    await finishAdmissionRecoveryCapture(tx, actionId);
    if (!actionId)
      throw new Error("Synthetic initial admission was not captured.");
    return actionId;
  });
  return { actionId };
}

async function checkpoint() {
  const tutor = await db.tutor.create({
    data: {
      id: "intent-recovery-tutor",
      englishName: "Synthetic tutor",
      status: "ACTIVE",
    },
  });
  const request = await db.tutorStatusRequest.create({
    data: { tutorId: tutor.id, kind: "OPT_OUT", eligibleAt: new Date(0) },
  });
  await decideMembership(db, "tutor", request.id, true, {
    id: intentAccounts.publisher.id,
  });
  const checkpoint = await db.recoveryCheckpoint.findFirstOrThrow({
    where: { sourceId: tutor.id, adapter: "PARTICIPANT_TUTOR" },
  });
  return { checkpointId: checkpoint.id, actionId: checkpoint.actionId };
}

it("preserves ACCEPTED and STOPPED metadata through real admission compensation without journaling or adapting translation receipts", async () => {
  const source = await admission();
  const beforeMetadata = await inspectAdmissionRecovery(db, source);
  expect(beforeMetadata.coverage).toBe("COMPLETE");
  const rows = await terminalRows();
  expect(rows.map((row) => row.status).sort()).toEqual(["ACCEPTED", "STOPPED"]);
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan.coverage).toBe("COMPLETE");
  expect(plan.fingerprint).toBe(beforeMetadata.fingerprint);
  await applyAdmissionRecoveryFromOperator(
    db,
    {
      actionId: source.actionId,
      expectedFingerprint: plan.fingerprint,
      clientKey: randomUUID(),
      reason:
        "Synthetic reviewed admission compensation preserving terminal evidence",
    },
    { id: intentAccounts.publisher.id },
  );
  expect(
    await db.translationIntentReceipt.findMany({
      orderBy: [{ actorId: "asc" }, { intentId: "asc" }],
    }),
  ).toEqual(rows);
  expect(
    await db.recoveryChange.count({
      where: { entity: "TranslationIntentReceipt" },
    }),
  ).toBe(0);
});

it("preserves both terminal states through a real participant checkpoint compensation", async () => {
  const source = await checkpoint();
  const beforeMetadata = await inspectRecoveryCheckpoint(db, source);
  expect(beforeMetadata.coverage).toBe("COMPLETE");
  const rows = await terminalRows();
  const plan = await inspectRecoveryCheckpoint(db, source);
  expect(plan.coverage).toBe("COMPLETE");
  expect(plan.fingerprint).toBe(beforeMetadata.fingerprint);
  await applyRecoveryCheckpointFromOperator(
    db,
    {
      checkpointId: source.checkpointId,
      expectedFingerprint: plan.fingerprint,
      clientKey: randomUUID(),
      reason:
        "Synthetic reviewed participant compensation preserving terminal evidence",
    },
    { id: intentAccounts.publisher.id },
  );
  expect(
    await db.tutor.findUniqueOrThrow({
      where: { id: "intent-recovery-tutor" },
    }),
  ).toMatchObject({ status: "ACTIVE" });
  expect(
    await db.translationIntentReceipt.findMany({
      orderBy: [{ actorId: "asc" }, { intentId: "asc" }],
    }),
  ).toEqual(rows);
  expect(
    await db.recoveryChange.count({
      where: { entity: "TranslationIntentReceipt" },
    }),
  ).toBe(0);
});

it("keeps similarly named unreviewed tables outside both exact metadata-only exceptions", async () => {
  const admissionSource = await admission();
  const checkpointSource = await checkpoint();
  const rollback = new Error(
    "Roll back synthetic unreviewed translation metadata table",
  );
  await expect(
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`CREATE TABLE "TranslationIntentReceiptUnreviewed" (id text PRIMARY KEY)`;
        const admissionPlan = await inspectAdmissionRecovery(
          tx,
          admissionSource,
        );
        const checkpointPlan = await inspectRecoveryCheckpoint(
          tx,
          checkpointSource,
        );
        for (const plan of [admissionPlan, checkpointPlan]) {
          expect(plan.coverage).toBe("UNKNOWN");
          expect(plan.blockers.join(" ")).toContain(
            "TranslationIntentReceiptUnreviewed",
          );
        }
        throw rollback;
      },
      { timeout: 20_000 },
    ),
  ).rejects.toBe(rollback);
});
