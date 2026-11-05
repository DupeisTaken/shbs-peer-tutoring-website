import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import { declineLegacySignup } from "~/server/legacy-signup-decline";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import type { TransactionDb } from "~/server/transactions";
import {
  applyRecoveryCheckpoint,
  applyRecoveryCheckpointFromOperator,
  captureRecoveryCheckpoint,
  inspectRecoveryCheckpoint,
} from "./checkpoint";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());
const rollback = "rollback synthetic declined-source checkpoint";
async function setup(tx: TransactionDb) {
  const prefix = `decline-checkpoint-${randomUUID()}`;
  await tx.term.updateMany({
    where: { active: true },
    data: { active: false },
  });
  const term = await tx.term.create({
    data: {
      id: `${prefix}-term`,
      schoolYear: "84-85",
      quarter: "Q1",
      name: "Synthetic checkpoint term",
      active: true,
    },
  });
  const actor = await tx.user.create({
    data: {
      id: `${prefix}-admin`,
      role: "ADMIN",
      email: `${prefix}-admin@example.test`,
      name: "Synthetic reviewer",
    },
  });
  return { prefix, term, actor };
}
async function fixture(
  work: (
    tx: TransactionDb,
    data: Awaited<ReturnType<typeof setup>>,
  ) => Promise<void>,
) {
  await expect(
    db.$transaction(
      async (tx) => {
        await work(tx, await setup(tx));
        throw new Error(rollback);
      },
      { timeout: 40000 },
    ),
  ).rejects.toThrow(rollback);
}
function intent(checkpointId: string, fingerprint: string) {
  return {
    checkpointId,
    expectedFingerprint: fingerprint,
    clientKey: randomUUID(),
    reason: "Synthetic reviewed checkpoint compensation",
  };
}

it("keeps a retained legacy decline terminal for older website and operator checkpoints", async () => {
  await fixture(async (tx, { prefix, term, actor }) => {
    const source = await tx.tutee.create({
      data: {
        id: `${prefix}-legacy-decline`,
        englishName: "Synthetic legacy intake",
        status: "PENDING",
        signupSource: "STAFF",
        intakeTermId: term.id,
      },
    });
    const checkpoint = await captureRecoveryCheckpoint(
      tx,
      {
        adapter: "PARTICIPANT_TUTEE",
        sourceId: source.id,
      },
      actor,
    );
    const before = await inspectRecoveryCheckpoint(tx, checkpoint);
    const declined = await declineLegacySignup(tx, actor.id, {
      id: source.id,
      expectedUpdatedAt: source.updatedAt,
      clientKey: randomUUID(),
    });
    const after = await inspectRecoveryCheckpoint(tx, checkpoint);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.websiteEligible).toBe(false);
    expect(after.blockers.join(" ")).toContain("legacy signup was declined");
    expect(
      await tx.recoveryChange.count({
        where: {
          actionId: checkpoint.actionId,
          entity: "LegacySignupDecline",
          operation: "INSERT",
        },
      }),
    ).toBe(1);
    const input = intent(checkpoint.checkpointId, after.fingerprint);
    await expect(
      applyRecoveryCheckpoint(tx, input, actor),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      applyRecoveryCheckpointFromOperator(tx, input, actor),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      (await tx.tutee.findUniqueOrThrow({ where: { id: source.id } })).status,
    ).toBe("INACTIVE");
    const decision = await tx.legacySignupDecline.findUniqueOrThrow({
      where: { tuteeId: source.id },
    });
    expect(decision.intakeSnapshot).toEqual(declined.decline.snapshot);
    expect(
      await tx.recoveryReceipt.count({
        where: { actionId: checkpoint.actionId },
      }),
    ).toBe(0);
  });
});
