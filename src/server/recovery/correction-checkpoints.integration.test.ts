import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { correctAttendance } from "~/server/corrections/attendance";
import { reviewCard } from "~/server/corrections/card";
import {
  inspectRecoveryCheckpoint,
  applyRecoveryCheckpoint,
  applyRecoveryCheckpointFromOperator,
  captureRecoveryCheckpoint,
} from "./checkpoint";
import { readRecoveryReceipt } from "./receipt";

const actor = { id: "recovery-head", name: "Synthetic reviewer" };
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use the serial shbs_shipping_test database");
  const tables = await db.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((row) => '"' + row.tablename.replaceAll('"', '""') + '"').join(",")} CASCADE`,
  );
  await db.user.create({
    data: { id: actor.id, email: "recovery-head@example.test", role: "HEAD" },
  });
  await db.term.create({
    data: {
      id: "term",
      name: "Synthetic quarter",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.tutor.create({
    data: { id: "tutor", englishName: "Synthetic tutor", status: "ACTIVE" },
  });
  await db.tutee.create({
    data: { id: "learner", englishName: "Synthetic learner", status: "ACTIVE" },
  });
  await db.pairing.create({
    data: {
      id: "pairing",
      tutorId: "tutor",
      termId: "term",
      subject: "Synthetic subject",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  await db.programFeature.upsert({
    where: { key: "DISCIPLINE" },
    create: { key: "DISCIPLINE", enabled: true },
    update: { enabled: true },
  });
});
afterAll(() => db.$disconnect());

async function attendance() {
  return db.session.create({
    data: {
      id: "primary",
      tutorId: "tutor",
      pairingId: "pairing",
      date: new Date("2026-10-05T00:00:00Z"),
      schoolYear: "26-27",
      quarter: "Q1",
      month: "2026-10",
      startMin: 900,
      endMin: 960,
      durationMin: 60,
      shFactor: 2,
      shCount: 2,
      online: true,
      tutorStatus: "PRESENT",
      ratingPreparedness: 3,
      ratingParticipation: 3,
      ratingUnderstanding: 3,
      ratingBehavior: 3,
      ratingProgress: 3,
      tutees: { create: { tuteeId: "learner", status: "PRESENT" } },
    },
  });
}
const intent = (
  plan: Awaited<ReturnType<typeof inspectRecoveryCheckpoint>>,
) => ({
  checkpointId: plan.checkpointId,
  expectedFingerprint: plan.fingerprint,
  clientKey: randomUUID(),
  reason: "Restore the reviewed synthetic before-state",
});

it("restoring an older manual checkpoint stops shared correction notices and preserves independent mail", async () => {
  await db.programSettings.upsert({ where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true } });
  await db.user.update({ where: { id: actor.id },
    data: { emailVerifiedAt: new Date(), emailInfo: true } });
  const original = await attendance();
  const manual = await captureRecoveryCheckpoint(db,
    { adapter: "ATTENDANCE", sourceId: original.id }, actor);
  const independent = await db.notification.create({ data: {
    userId: actor.id, title: "Synthetic independent notice", link: "/admin/audit",
  } });
  const independentMail = await db.emailDelivery.findMany({ where: {
    userId: actor.id, status: "PENDING",
  }, select: { id: true } });
  expect(independentMail.length).toBeGreaterThan(0);
  await correctAttendance(db, { ...original, expectedUpdatedAt: original.updatedAt,
    endMin: 990, reason: "Synthetic mistaken duration",
    tutees: [{ tuteeId: "learner", status: "PRESENT", absenceReason: null }],
  }, actor);
  const automatic = await db.recoveryCheckpoint.findFirstOrThrow({ where: {
    adapter: "ATTENDANCE", sourceId: original.id, id: { not: manual.checkpointId },
  } });
  const manualPlan = await inspectRecoveryCheckpoint(db, manual);
  const automaticPlan = await inspectRecoveryCheckpoint(db, { checkpointId: automatic.id });
  expect(manualPlan.blockers).toEqual([]);
  expect(manualPlan.dependentEventCount).toBe(1);
  expect(automaticPlan.blockers).toEqual([]);
  const physical = (plan: typeof manualPlan) => plan.delivery.effects.map((effect) =>
    `${effect.notificationId ?? ""}:${effect.deliveryId ?? ""}`).sort();
  expect(manualPlan.delivery.effects.some((effect) => !!effect.deliveryId)).toBe(true);
  expect(physical(manualPlan)).toEqual(physical(automaticPlan));
  const restored = await applyRecoveryCheckpoint(db, intent(manualPlan), actor);
  expect((await db.session.findUniqueOrThrow({ where: { id: original.id } })).endMin).toBe(960);
  const mailIds = manualPlan.delivery.effects.flatMap((effect) => effect.deliveryId ? [effect.deliveryId] : []);
  expect(await db.emailDelivery.count({ where: { id: { in: mailIds }, status: "CANCELLED" } }))
    .toBe(new Set(mailIds).size);
  for (const effect of manualPlan.delivery.effects.filter((effect) => !effect.deliveryId)) {
    expect(effect.notificationId).not.toBeNull();
    expect((await db.notification.findUniqueOrThrow({ where: { id: effect.notificationId! } })).recoveryWithdrawnAt)
      .not.toBeNull();
  }
  expect((await db.notification.findUniqueOrThrow({ where: { id: independent.id } })).recoveryWithdrawnAt).toBeNull();
  expect(await db.emailDelivery.count({ where: { id: { in: independentMail.map((row) => row.id) }, status: "PENDING" } }))
    .toBe(independentMail.length);
  const receipt = await readRecoveryReceipt(db, restored.receiptId);
  expect(receipt.deliveries?.effects.length).toBeGreaterThan(0);
  await expect(applyRecoveryCheckpoint(db, intent(automaticPlan), actor))
    .rejects.toMatchObject({ code: "CONFLICT" });
});

it("card preview reflects the current discipline feature instead of advertising an apply the writer forbids", async () => {
  const card = await db.disciplinaryCard.create({ data: { id: "feature-card", tuteeId: "learner", color: "YELLOW", reviewStatus: "PENDING" } });
  await reviewCard(db, { id: card.id, expectedUpdatedAt: card.updatedAt, reviewStatus: "VALID" }, actor);
  const checkpoint = await db.recoveryCheckpoint.findFirstOrThrow({ where: { adapter: "CARD", sourceId: card.id } });
  const before = await inspectRecoveryCheckpoint(db, { checkpointId: checkpoint.id });
  expect(before.blockers).toEqual([]);
  await db.programFeature.update({ where: { key: "DISCIPLINE" }, data: { enabled: false } });
  const after = await inspectRecoveryCheckpoint(db, { checkpointId: checkpoint.id });
  expect(after.blockers.join(" ")).toContain("discipline module");
  expect(after.fingerprint).not.toBe(before.fingerprint);
  await expect(applyRecoveryCheckpoint(db, intent(after), actor)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await db.disciplinaryCard.findUniqueOrThrow({ where: { id: card.id } })).reviewStatus).toBe("VALID");
  expect(await db.recoveryReceipt.count()).toBe(0);
});

it("ordinary attendance correction captures before-state atomically and recovery recomputes merged credit", async () => {
  const original = await attendance();
  await db.session.create({
    data: {
      ...original,
      id: "sibling",
      mergeGroupId: "primary",
      shCount: 0,
      shFactor: 0,
      tutees: { create: { tuteeId: "learner", status: "PRESENT" } },
    },
  });
  await correctAttendance(
    db,
    {
      ...original,
      expectedUpdatedAt: original.updatedAt,
      endMin: 990,
      reason: "Synthetic mistaken duration",
      tutees: [{ tuteeId: "learner", status: "PRESENT", absenceReason: null }],
    },
    actor,
  );
  const checkpoint = await db.recoveryCheckpoint.findFirstOrThrow({
    where: { adapter: "ATTENDANCE" },
  });
  const plan = await inspectRecoveryCheckpoint(db, {
    checkpointId: checkpoint.id,
  });
  expect(
    plan.blockers,
    JSON.stringify(
      await db.recoveryChange.findMany({
        where: { actionId: checkpoint.actionId },
        select: {
          entity: true,
          operation: true,
          changedFields: true,
          recordKey: true,
        },
      }),
    ),
  ).toEqual([]);
  expect(plan.dependentEventCount).toBe(0);
  expect(
    (await db.session.findUniqueOrThrow({ where: { id: "primary" } })).shCount,
  ).toBe(3);
  const input = {
    ...intent(plan),
    reason: "Reviewed recovery justification. ".repeat(40),
  };
  const result = await applyRecoveryCheckpoint(db, input, actor);
  expect(await applyRecoveryCheckpoint(db, input, actor)).toMatchObject({
    receiptId: result.receiptId,
    replayed: true,
  });
  expect(
    await db.session.findUniqueOrThrow({ where: { id: "primary" } }),
  ).toMatchObject({ endMin: 960, shCount: 2 });
  expect(
    await db.session.findUniqueOrThrow({ where: { id: "sibling" } }),
  ).toMatchObject({ endMin: 960, shCount: 0, mergeGroupId: "primary" });
  expect(await db.recoveryCheckpoint.count()).toBe(1);
  const receipt = await readRecoveryReceipt(db, result.receiptId);
  expect(receipt.evidenceVersion).toBe(1);
  expect(receipt.authorityScope.credentialRestoration).toBe(false);
});

it("attendance restoration preserves a later independent card judgment", async () => {
  const original = await attendance();
  await correctAttendance(
    db,
    {
      ...original,
      expectedUpdatedAt: original.updatedAt,
      endMin: 990,
      reason: "Synthetic mistaken duration",
      tutees: [{ tuteeId: "learner", status: "PRESENT", absenceReason: null }],
    },
    actor,
  );
  const checkpoint = await db.recoveryCheckpoint.findFirstOrThrow({
    where: { adapter: "ATTENDANCE" },
  });
  await db.disciplinaryCard.create({
    data: {
      id: "independent-card",
      tuteeId: "learner",
      color: "YELLOW",
      source: "TUTOR",
      reviewStatus: "VALID",
    },
  });
  const plan = await inspectRecoveryCheckpoint(db, {
    checkpointId: checkpoint.id,
  });
  expect(plan.blockers).toEqual([]);
  await applyRecoveryCheckpoint(db, intent(plan), actor);
  expect(
    (
      await db.disciplinaryCard.findUniqueOrThrow({
        where: { id: "independent-card" },
      })
    ).reviewStatus,
  ).toBe("VALID");
  expect(
    (await db.session.findUniqueOrThrow({ where: { id: original.id } })).endMin,
  ).toBe(960);
});

it("failed ordinary correction rolls back automatic checkpoint and domain evidence together", async () => {
  const original = await attendance();
  await expect(
    correctAttendance(
      db,
      {
        ...original,
        expectedUpdatedAt: new Date(0),
        endMin: 990,
        reason: "Synthetic stale correction",
        tutees: [
          { tuteeId: "learner", status: "PRESENT", absenceReason: null },
        ],
      },
      actor,
    ),
  ).rejects.toThrow("Attendance changed");
  expect(await db.recoveryCheckpoint.count()).toBe(0);
  expect(await db.recoveryAction.count()).toBe(0);
  expect(
    await db.session.findUniqueOrThrow({ where: { id: original.id } }),
  ).toMatchObject({ shCount: 2, endMin: 960 });
});

it("card restoration records a fresh pending review and preserves two independent changes via operator", async () => {
  const card = await db.disciplinaryCard.create({
    data: {
      id: "card",
      tuteeId: "learner",
      color: "YELLOW",
      source: "TUTOR",
      reviewStatus: "PENDING",
    },
  });
  await reviewCard(
    db,
    {
      id: card.id,
      expectedUpdatedAt: card.updatedAt,
      reviewStatus: "VALID",
      reviewNote: "Synthetic mistaken review",
    },
    actor,
  );
  const checkpoint = await db.recoveryCheckpoint.findFirstOrThrow({
    where: { adapter: "CARD" },
  });
  await db.tutee.update({
    where: { id: "learner" },
    data: { phone: "synthetic-one" },
  });
  await db.tutee.update({
    where: { id: "learner" },
    data: { preferredContact: "synthetic-two" },
  });
  const plan = await inspectRecoveryCheckpoint(db, {
    checkpointId: checkpoint.id,
  });
  expect(plan.blockers).toEqual([]);
  expect(plan.dependentEventCount).toBe(2);
  expect(plan.websiteEligible).toBe(false);
  await expect(
    applyRecoveryCheckpoint(db, intent(plan), actor),
  ).rejects.toThrow("operator CLI");
  await applyRecoveryCheckpointFromOperator(db, intent(plan), actor);
  expect(
    await db.disciplinaryCard.findUniqueOrThrow({ where: { id: card.id } }),
  ).toMatchObject({
    reviewStatus: "PENDING",
    reviewedById: actor.id,
    reviewedAt: expect.any(Date) as Date,
  });
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: "learner" } }),
  ).toMatchObject({
    phone: "synthetic-one",
    preferredContact: "synthetic-two",
  });
});

it("another card's independent judgment is preserved while the selected review is restored", async () => {
  const card = await db.disciplinaryCard.create({
    data: {
      id: "first",
      tuteeId: "learner",
      color: "YELLOW",
      reviewStatus: "PENDING",
    },
  });
  await reviewCard(
    db,
    { id: card.id, expectedUpdatedAt: card.updatedAt, reviewStatus: "VALID" },
    actor,
  );
  const checkpoint = await db.recoveryCheckpoint.findFirstOrThrow({
    where: { adapter: "CARD", sourceId: card.id },
  });
  await db.disciplinaryCard.create({
    data: {
      id: "second",
      tuteeId: "learner",
      color: "YELLOW",
      reviewStatus: "VALID",
    },
  });
  const plan = await inspectRecoveryCheckpoint(db, {
    checkpointId: checkpoint.id,
  });
  expect(plan.blockers).toEqual([]);
  await applyRecoveryCheckpointFromOperator(db, intent(plan), actor);
  expect(
    await db.disciplinaryCard.findUniqueOrThrow({ where: { id: "second" } }),
  ).toMatchObject({ reviewStatus: "VALID" });
  expect(
    await db.disciplinaryCard.findUniqueOrThrow({ where: { id: "first" } }),
  ).toMatchObject({ reviewStatus: "PENDING" });
});

it.each([false, true])(
  "threshold correction preserves independent cards and reconciles exact grouped memberships (independent threshold=%s)",
  async (keepRemoved) => {
    await db.subject.create({
      data: { id: "subject", name: "Synthetic subject" },
    });
    await db.tutorQualification.create({
      data: {
        tutorId: "tutor",
        subjectId: "subject",
        approvedById: actor.id,
        grants: { create: { subjectId: "subject" } },
      },
    });
    await db.pairingGroup.create({
      data: {
        id: "group",
        tutorId: "tutor",
        termId: "term",
        primaryPairingId: "pairing",
      },
    });
    await db.pairing.update({
      where: { id: "pairing" },
      data: { groupId: "group" },
    });
    await db.pairing.create({
      data: {
        id: "group-peer",
        tutorId: "tutor",
        termId: "term",
        subject: "Synthetic subject",
        groupId: "group",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
    });
    await db.pairingTutee.create({
      data: { pairingId: "pairing", tuteeId: "learner" },
    });
    await db.disciplinaryCard.create({
      data: {
        id: "independent-red",
        tuteeId: "learner",
        color: "RED",
        reviewStatus: "VALID",
      },
    });
    const selected = await db.disciplinaryCard.create({
      data: {
        id: "threshold-red",
        tuteeId: "learner",
        color: "RED",
        reviewStatus: "PENDING",
      },
    });
    await reviewCard(
      db,
      {
        id: selected.id,
        expectedUpdatedAt: selected.updatedAt,
        reviewStatus: "VALID",
      },
      actor,
    );
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "learner" } })).status,
    ).toBe("INACTIVE");
    expect(await db.pairingTutee.count({ where: { tuteeId: "learner" } })).toBe(
      0,
    );
    if (keepRemoved)
      await db.disciplinaryCard.create({
        data: {
          id: "later-independent-red",
          tuteeId: "learner",
          color: "RED",
          reviewStatus: "VALID",
        },
      });
    const checkpoint = await db.recoveryCheckpoint.findFirstOrThrow({
      where: { adapter: "CARD", sourceId: selected.id },
    });
    const plan = await inspectRecoveryCheckpoint(db, {
      checkpointId: checkpoint.id,
    });
    expect(plan.blockers).toEqual([]);
    await applyRecoveryCheckpointFromOperator(db, intent(plan), actor);
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: "learner" } })).status,
    ).toBe(keepRemoved ? "INACTIVE" : "ACTIVE");
    expect(await db.pairingTutee.count({ where: { tuteeId: "learner" } })).toBe(
      keepRemoved ? 0 : 1,
    );
    expect(
      (
        await db.disciplinaryCard.findUniqueOrThrow({
          where: { id: "independent-red" },
        })
      ).reviewStatus,
    ).toBe("VALID");
    expect(
      (
        await db.disciplinaryCard.findUniqueOrThrow({
          where: { id: selected.id },
        })
      ).reviewStatus,
    ).toBe("PENDING");
  },
);

it.each(["rating", "merged"])(
  "ordinary attendance repair remains usable for unsupported legacy %s evidence",
  async (variant) => {
    const original = await attendance();
    if (variant === "rating")
      await db.session.update({
        where: { id: original.id },
        data: { ratingPreparedness: null },
      });
    else
      await db.session.create({
        data: {
          ...original,
          id: "different-sibling",
          mergeGroupId: original.id,
          comments: "Independent legacy note",
          shCount: 0,
          shFactor: 0,
          tutees: { create: { tuteeId: "learner", status: "PRESENT" } },
        },
      });
    const current = await db.session.findUniqueOrThrow({
      where: { id: original.id },
    });
    await correctAttendance(
      db,
      {
        ...original,
        expectedUpdatedAt: current.updatedAt,
        endMin: 990,
        reason: "Repair synthetic legacy attendance",
        tutees: [
          { tuteeId: "learner", status: "PRESENT", absenceReason: null },
        ],
      },
      actor,
    );
    const checkpoint = await db.recoveryCheckpoint.findFirstOrThrow({
      where: { adapter: "ATTENDANCE" },
    });
    expect(checkpoint.schemaVersion).toBe(0);
    const plan = await inspectRecoveryCheckpoint(db, {
      checkpointId: checkpoint.id,
    });
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(
      (await db.session.findUniqueOrThrow({ where: { id: original.id } }))
        .endMin,
    ).toBe(990);
  },
);
