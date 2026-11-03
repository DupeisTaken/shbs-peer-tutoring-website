import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { applyAdmissionRecovery, inspectAdmissionRecovery } from "./admission";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());

const rollback = "rollback synthetic scoped compensation";

async function rollbackFixture(work: (tx: TransactionDb) => Promise<void>) {
  // Keep append-only evidence intact: fixtures and assertions share a rolled-back
  // transaction rather than deleting recovery history or resetting other suites.
  await expect(
    db.$transaction(
      async (tx) => {
        await work(tx);
        throw new Error(rollback);
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow(rollback);
}

async function fixture(tx: TransactionDb) {
  const prefix = `scoped-compensation-${randomUUID()}`;
  const user = await tx.user.create({
    data: {
      id: `${prefix}-user`,
      email: `${prefix}-actor@example.test`,
      role: "ADMIN",
      name: "Synthetic original",
    },
  });
  const application = await tx.tutorApplication.create({
    data: {
      id: `${prefix}-application`,
      name: "Synthetic applicant",
      email: `${prefix}@example.test`,
      status: "ACCEPTED",
    },
  });
  const roots = [];
  for (const label of ["own", "overlap", "unrelated"]) {
    roots.push(
      await tx.recoveryAction.create({
        data: {
          id: `${prefix}-${label}`,
          kind: "INITIAL_ADMISSION",
          applicationId: application.id,
          before: {
            application: {
              status: "INTERVIEW",
              decisionComment: null,
              decidedAt: null,
              decidedByTutorId: null,
              promotedTutorId: null,
            },
            tutor: null,
            account: null,
          },
          after: { tutor: null, account: null, codeIds: [] },
        },
      }),
    );
  }
  const [own, overlap, unrelated] = roots;
  if (!own || !overlap || !unrelated)
    throw new Error("Missing synthetic roots");
  await tx.recoveryTrackedEntity.createMany({
    data: [own, overlap].map((root) => ({
      actionId: root.id,
      entity: "User",
      recordId: user.id,
    })),
  });
  await tx.recoveryTrackedEntity.create({
    data: {
      actionId: unrelated.id,
      entity: "User",
      recordId: `${prefix}-other-user`,
    },
  });
  for (const root of roots)
    await tx.recoveryEvent.create({
      data: {
        actionId: root.id,
        kind: "ADMISSION",
        transactionId: "synthetic-admission",
      },
    });
  return { prefix, user, own, overlap, unrelated };
}

it("suppresses only its own root and journals overlapping roots with atomic receipt preservation", async () => {
  await rollbackFixture(async (tx) => {
    const { user, own, overlap, unrelated } = await fixture(tx);
    await tx.$queryRaw`SELECT set_config('shbs.recovery_action', ${own.id}, true), set_config('shbs.recovery_kind', 'ADMISSION', true), set_config('shbs.recovery_compensating', ${own.id}, true)`;
    await tx.user.update({
      where: { id: user.id },
      data: { name: "Synthetic corrected" },
    });
    const receipt = await tx.recoveryReceipt.create({
      data: {
        actionId: own.id,
        actorId: user.id,
        clientKey: randomUUID(),
        inputHash: "synthetic-intent",
        reason: "Synthetic compensation",
        channel: "OPERATOR",
        fingerprint: "synthetic-reviewed-plan",
        evidence: { retained: true },
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { name: "Synthetic final" },
    });
    expect(await tx.recoveryChange.count({ where: { actionId: own.id } })).toBe(
      0,
    );
    expect(
      await tx.recoveryFence.findUnique({ where: { actionId: own.id } }),
    ).toBeNull();
    const changes = await tx.recoveryChange.findMany({
      where: { actionId: overlap.id },
      orderBy: { id: "asc" },
    });
    expect(changes).toHaveLength(2);
    expect(
      changes.every(
        (change) => change.entity === "User" && change.operation === "UPDATE",
      ),
    ).toBe(true);
    expect(
      changes.every(
        (change) =>
          Array.isArray(change.changedFields) &&
          change.changedFields.includes("name"),
      ),
    ).toBe(true);
    const events = await tx.recoveryEvent.findMany({
      where: { actionId: overlap.id, kind: "RECOVERY_COMPENSATION" },
    });
    expect(events).toHaveLength(1);
    expect(changes.every((change) => change.eventId === events[0]!.id)).toBe(
      true,
    );
    expect(
      (
        await tx.recoveryFence.findUniqueOrThrow({
          where: { actionId: overlap.id },
        })
      ).revision,
    ).toBe(2);
    expect(
      await tx.recoveryChange.count({ where: { actionId: unrelated.id } }),
    ).toBe(0);
    expect(
      await tx.recoveryFence.findUnique({ where: { actionId: unrelated.id } }),
    ).toBeNull();
    expect(
      await tx.recoveryReceipt.findUniqueOrThrow({ where: { id: receipt.id } }),
    ).toEqual(receipt);
  });
});

it("invalidates another root's reviewed planner fingerprint and refuses its stale apply", async () => {
  await rollbackFixture(async (tx) => {
    const { user, own, overlap } = await fixture(tx);
    const before = await inspectAdmissionRecovery(tx, { actionId: overlap.id });
    await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating', ${own.id}, true)`;
    await tx.user.update({
      where: { id: user.id },
      data: { name: "Synthetic recovered" },
    });
    await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating', '', true)`;
    const after = await inspectAdmissionRecovery(tx, { actionId: overlap.id });
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.dependentEventCount).toBe(before.dependentEventCount + 1);
    await expect(
      applyAdmissionRecovery(
        tx,
        {
          actionId: overlap.id,
          expectedFingerprint: before.fingerprint,
          clientKey: randomUUID(),
          reason: "Synthetic stale preview must fail",
        },
        { id: user.id },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await tx.recoveryReceipt.count({ where: { actionId: overlap.id } }),
    ).toBe(0);
  });
});

it("retains continuation coverage and privacy while skipping only the compensated root", async () => {
  await rollbackFixture(async (tx) => {
    const { prefix, user, own, overlap, unrelated } = await fixture(tx);
    await tx.$queryRaw`SELECT set_config('shbs.recovery_action', ${own.id}, true), set_config('shbs.recovery_compensating', ${own.id}, true)`;
    const clientKey = randomUUID();
    await tx.studentContinuationReceipt.create({
      data: {
        userId: user.id,
        clientKey,
        inputHash: "private-request-hash",
        surveyId: `${prefix}-survey`,
        result: { signature: "private-consent-payload" },
      },
    });
    const changes = await tx.recoveryChange.findMany({
      where: { actionId: overlap.id },
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entity: "StudentContinuationReceipt",
      operation: "INSERT",
    });
    expect(changes[0]!.recordKey).toHaveProperty("receiptFingerprint");
    const journal = JSON.stringify(changes[0], (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(journal).not.toContain("private-");
    expect(journal).not.toContain(clientKey);
    expect(
      await tx.recoveryEvent.findUniqueOrThrow({
        where: { id: changes[0]!.eventId },
      }),
    ).toMatchObject({ kind: "RECOVERY_COMPENSATION" });
    expect(
      await tx.recoveryChange.count({
        where: { actionId: { in: [own.id, unrelated.id] } },
      }),
    ).toBe(0);
  });
});

it("composes source-request edges from both row versions with scoped continuation compensation", async () => {
  await rollbackFixture(async (tx) => {
    const { prefix, own, overlap, unrelated } = await fixture(tx);
    const tutor = await tx.tutor.create({ data: { englishName: "Synthetic continuation tutor" } });
    const term = await tx.term.create({ data: { name: prefix, schoolYear: "26-27", quarter: "Q2" } });
    const plan = await tx.sessionPlan.create({ data: { generationKey: prefix, tutorId: tutor.id,
      termId: term.id, originalDate: "2026-11-02", timeZone: "Asia/Shanghai", sourceFingerprint: prefix } });
    const beforeSurvey = `${prefix}-original-request`;
    const afterSurvey = `${prefix}-current-request`;
    await tx.recoveryTrackedEntity.createMany({ data: [
      { actionId: overlap.id, entity: "StudentSurvey", recordId: beforeSurvey },
      { actionId: unrelated.id, entity: "StudentSurvey", recordId: afterSurvey },
    ] });
    await tx.$queryRaw`SELECT set_config('shbs.recovery_action', ${own.id}, true),
      set_config('shbs.recovery_compensating', ${own.id}, true)`;
    // The identity stack owns this nullable source column. Keep the regression
    // active so an absent prerequisite fails instead of silently losing evidence.
    await tx.$executeRaw`INSERT INTO "SessionPlanContinuationMember"
      ("planId","pairingId","tuteeId","assignmentId","sourceSurveyId","joinedAt")
      VALUES (${plan.id},${prefix},${prefix},NULL,${beforeSurvey},CURRENT_TIMESTAMP)`;
    await tx.$executeRaw`UPDATE "SessionPlanContinuationMember" SET "sourceSurveyId"=${afterSurvey}
      WHERE "planId"=${plan.id} AND "pairingId"=${prefix} AND "tuteeId"=${prefix}`;
    const changes = await tx.recoveryChange.findMany({ where: {
      actionId: { in: [own.id, overlap.id, unrelated.id] }, entity: "SessionPlanContinuationMember",
    } });
    expect(changes.filter((change) => change.actionId === own.id)).toHaveLength(0);
    expect(changes.filter((change) => change.actionId === overlap.id)).toHaveLength(2);
    expect(changes.filter((change) => change.actionId === unrelated.id)).toHaveLength(1);
    for (const change of changes.filter((change) => change.operation === "UPDATE")) {
      expect(change.before).toHaveProperty("sourceSurveyId", beforeSurvey);
      expect(change.after).toHaveProperty("sourceSurveyId", afterSurvey);
      expect(change.changedFields).toContain("sourceSurveyId");
      expect(await tx.recoveryEvent.findUniqueOrThrow({ where: { id: change.eventId } }))
        .toMatchObject({ kind: "RECOVERY_COMPENSATION" });
    }
  });
});

it.each(["ordinary", "continuation"] as const)(
  "rejects legacy global suppression atomically for %s writes",
  async (path) => {
    await rollbackFixture(async (tx) => {
      const { prefix, user } = await fixture(tx);
      await tx.$executeRawUnsafe("SAVEPOINT legacy_compensation");
      await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating', '1', true)`;
      const write =
        path === "ordinary"
          ? tx.user.update({
              where: { id: user.id },
              data: { name: "Must roll back" },
            })
          : tx.studentContinuationReceipt.create({
              data: {
                userId: user.id,
                clientKey: randomUUID(),
                inputHash: "synthetic",
                surveyId: `${prefix}-survey`,
                result: {},
              },
            });
      await expect(write).rejects.toThrow(
        "Recovery compensation must identify one action",
      );
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT legacy_compensation");
      expect(
        (await tx.user.findUniqueOrThrow({ where: { id: user.id } })).name,
      ).toBe(user.name);
      expect(
        await tx.studentContinuationReceipt.count({
          where: { userId: user.id },
        }),
      ).toBe(0);
    });
  },
);
