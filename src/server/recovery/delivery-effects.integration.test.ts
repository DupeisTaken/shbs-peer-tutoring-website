import { createHash, randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { notifyUsers } from "~/server/notifications/create";
import {
  admitRecoveryGenericDelivery,
  cancelRecoveryDeliveryEffects,
  finishRecoveryGenericDelivery,
  inspectRecoveryDeliveryEffects,
  recoveryDeliveryCoverageInstalled,
  withRecoveryDeliverySource,
} from "./delivery-effects";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());
it("does not invent a causal origin for an independent account-profile email", async () => {
  await fixture(async (tx, ids) => {
    // The real account_update_notice trigger queues this before source journaling.
    await tx.user.update({
      where: { id: ids.userId },
      data: { name: "Synthetic independent profile change" },
    });
    expect(
      await tx.emailDelivery.count({
        where: { userId: ids.userId, event: "information_changed" },
      }),
    ).toBeGreaterThan(0);
    expect(
      await inspectRecoveryDeliveryEffects(tx, { actionId: ids.actionId }),
    ).toMatchObject({ coverage: "UNKNOWN", effects: [] });
  });
});
const rollback = "rollback synthetic recovery delivery fixture";
async function fixture(
  work: (
    tx: TransactionDb,
    ids: { userId: string; actionId: string; eventId: string },
  ) => Promise<void>,
) {
  await expect(
    db.$transaction(
      async (tx) => {
        const prefix = `delivery-effects-${randomUUID()}`;
        await tx.programSettings.upsert({
          where: { id: "program" },
          create: { id: "program", emailNotificationsEnabled: true },
          update: { emailNotificationsEnabled: true },
        });
        const user = await tx.user.create({
          data: {
            id: `${prefix}-user`,
            email: `${prefix}@example.test`,
            role: "ADMIN",
            emailVerifiedAt: new Date(),
            emailInfo: true,
            emailMessages: true,
          },
        });
        const action = await tx.recoveryAction.create({
          data: {
            id: `${prefix}-action`,
            kind: "INITIAL_ADMISSION",
            applicationId: `${prefix}-application`,
            before: {},
            after: {},
          },
        });
        await tx.recoveryTrackedEntity.create({
          data: { actionId: action.id, entity: "User", recordId: user.id },
        });
        const [clock] = await tx.$queryRaw<
          Array<{ transactionId: string }>
        >`SELECT txid_current()::text AS "transactionId"`;
        const event = await tx.recoveryEvent.create({
          data: {
            id: createHash("md5")
              .update(`${action.id}:${clock!.transactionId}`)
              .digest("hex"),
            actionId: action.id,
            transactionId: clock!.transactionId,
            kind: "ADMISSION",
          },
        });
        // Typed origin proof is an actual source mutation in this transaction,
        // not the current recipient or a capture-only event.
        await tx.user.update({
          where: { id: user.id },
          // Unlike name/role edits, this genuine source mutation does not emit
          // a separate unwrapped account-information email before journaling.
          data: { emailMessages: false },
        });
        await work(tx, {
          userId: user.id,
          actionId: action.id,
          eventId: event.id,
        });
        throw new Error(rollback);
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow(rollback);
}
async function notice(
  tx: TransactionDb,
  ids: { userId: string; actionId: string },
) {
  await withRecoveryDeliverySource(
    tx,
    { entity: "User", recordId: ids.userId, actionId: ids.actionId },
    () =>
      notifyUsers(
        [ids.userId],
        { title: "Synthetic derived update", link: "/admin/recovery" },
        tx,
      ),
  );
}

it("captures exact typed notification/delivery origins, withdraws pending effects and preserves immutable stop evidence", async () => {
  await fixture(async (tx, ids) => {
    expect(await recoveryDeliveryCoverageInstalled(tx)).toBe(true);
    const empty = await inspectRecoveryDeliveryEffects(tx, {
      actionId: ids.actionId,
    });
    expect(empty).toMatchObject({ coverage: "COMPLETE", effects: [] });
    await notice(tx, ids);
    const preview = await inspectRecoveryDeliveryEffects(tx, {
      actionId: ids.actionId,
    });
    expect(preview.coverage).toBe("COMPLETE");
    expect(preview.effects.filter((effect) => !effect.deliveryId)).toHaveLength(
      1,
    );
    expect(preview.effects.some((effect) => !!effect.deliveryId)).toBe(true);
    const outcome = await cancelRecoveryDeliveryEffects(
      tx,
      { actionId: ids.actionId },
      "synthetic-intent",
    );
    const notificationId = outcome.effects.find(
      (effect) => !effect.deliveryId,
    )!.notificationId!;
    expect(
      (
        await tx.notification.findUniqueOrThrow({
          where: { id: notificationId },
        })
      ).recoveryWithdrawnAt,
    ).not.toBeNull();
    const deliveryIds = outcome.effects.flatMap((effect) =>
      effect.deliveryId ? [effect.deliveryId] : [],
    );
    expect(
      await tx.emailDelivery.count({
        where: { id: { in: deliveryIds }, status: "CANCELLED" },
      }),
    ).toBe(deliveryIds.length);
    // Ordinary resend cannot resurrect an immutable stopped effect.
    await tx.emailDelivery.updateMany({
      where: { id: { in: deliveryIds } },
      data: { status: "PENDING", attempts: 0 },
    });
    expect(
      await tx.emailDelivery.count({
        where: { id: { in: deliveryIds }, status: "CANCELLED" },
      }),
    ).toBe(deliveryIds.length);
    expect(JSON.stringify(preview)).not.toContain("@example.test");
    expect(JSON.stringify(preview)).not.toContain("Synthetic derived update");
    // Savepoint keeps the fixture transaction usable after exercising the guard.
    await tx.$executeRawUnsafe("SAVEPOINT recovery_delivery_immutable");
    await expect(
      tx.$executeRaw`DELETE FROM "RecoveryDeliveryCancellation" WHERE "recoveryKey"='synthetic-intent'`,
    ).rejects.toThrow();
    await tx.$executeRawUnsafe(
      "ROLLBACK TO SAVEPOINT recovery_delivery_immutable",
    );
  });
});

it("binds each real bulk notification to its own nested mail and leaves no origin on the stack", async () => {
  await fixture(async (tx, ids) => {
    const userIds = [
      ids.userId,
      `${ids.actionId}-second`,
      `${ids.actionId}-third`,
    ];
    await tx.user.createMany({
      data: userIds.slice(1).map((id) => ({
        id,
        email: `${id}@example.test`,
        role: "ADMIN" as const,
        emailVerifiedAt: new Date(),
        emailInfo: true,
      })),
    });
    await withRecoveryDeliverySource(
      tx,
      { entity: "User", recordId: ids.userId, actionId: ids.actionId },
      async () => {
        // notifyUsers deliberately uses one real Notification.createMany statement.
        await notifyUsers(
          userIds,
          { title: "Synthetic bulk derived update" },
          tx,
        );
        const bulk = await inspectRecoveryDeliveryEffects(tx, {
          actionId: ids.actionId,
        });
        expect(bulk.coverage).toBe("COMPLETE");
        const notificationIds = bulk.effects
          .filter((effect) => !effect.deliveryId)
          .map((effect) => effect.notificationId!);
        const notifications = await tx.notification.findMany({
          where: { id: { in: notificationIds } },
          select: { id: true, userId: true },
        });
        expect(notifications.map((row) => row.userId).sort()).toEqual(
          [...userIds].sort(),
        );
        const mailEffects = bulk.effects.filter(
          (effect) => !!effect.deliveryId,
        );
        const deliveries = await tx.emailDelivery.findMany({
          where: {
            id: { in: mailEffects.map((effect) => effect.deliveryId!) },
          },
          select: { id: true, userId: true },
        });
        expect(deliveries).toHaveLength(userIds.length);
        for (const delivery of deliveries) {
          const effect = mailEffects.find(
            (entry) => entry.deliveryId === delivery.id,
          )!;
          expect(
            notifications.find((row) => row.id === effect.notificationId)
              ?.userId,
          ).toBe(delivery.userId);
        }
        const [stack] = await tx.$queryRaw<
          Array<{ value: string }>
        >`SELECT current_setting('shbs.recovery_notification_stack',true) AS value`;
        expect(stack?.value).toBe("[]");
        await tx.emailDelivery.create({
          data: {
            id: `${ids.actionId}-standalone`,
            userId: ids.userId,
            category: "info",
            event: "synthetic_standalone",
            recipient: "synthetic-standalone@example.test",
          },
        });
        const standalone = await tx.recoveryDeliveryEffect.findFirstOrThrow({
          where: { deliveryId: `${ids.actionId}-standalone` },
          select: { notificationId: true },
        });
        expect(standalone.notificationId).toBeNull();
        // In-app-only batches use the same balanced row boundaries without mail.
        await notifyUsers(
          userIds,
          { title: "Synthetic bulk in-app update", inAppOnly: true },
          tx,
        );
        const complete = await inspectRecoveryDeliveryEffects(tx, {
          actionId: ids.actionId,
        });
        expect(complete.coverage).toBe("COMPLETE");
        expect(
          complete.effects.filter((effect) => !effect.deliveryId),
        ).toHaveLength(userIds.length * 2);
      },
    );
  });
});

it("requires the ordered AFTER origin trigger and refuses unsafe legacy-trigger coexistence", async () => {
  await fixture(async (tx) => {
    const [shape] = await tx.$queryRaw<Array<{ mask: number }>>`
      SELECT tgtype::int AS mask FROM pg_trigger
      WHERE tgrelid='public."Notification"'::regclass AND tgname='aa_recovery_delivery_start'`;
    expect(shape?.mask).toBe(5);
    expect(await recoveryDeliveryCoverageInstalled(tx)).toBe(true);
    await tx.$executeRawUnsafe(
      'CREATE TRIGGER recovery_delivery_start BEFORE INSERT ON public."Notification" FOR EACH ROW EXECUTE FUNCTION recovery_delivery_start()',
    );
    expect(await recoveryDeliveryCoverageInstalled(tx)).toBe(false);
    await tx.$executeRawUnsafe(
      'DROP TRIGGER recovery_delivery_start ON public."Notification"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE public."Notification" DISABLE TRIGGER aa_recovery_delivery_start',
    );
    expect(await recoveryDeliveryCoverageInstalled(tx)).toBe(false);
    await tx.$executeRawUnsafe(
      'ALTER TABLE public."Notification" ENABLE TRIGGER aa_recovery_delivery_start',
    );
    expect(await recoveryDeliveryCoverageInstalled(tx)).toBe(true);
  });
});

it.each([false, true])(
  "retains truthful late SMTP completion and never retries a cancelled in-flight effect (accepted=%s)",
  async (accepted) => {
    await fixture(async (tx, ids) => {
      await notice(tx, ids);
      const inventory = await inspectRecoveryDeliveryEffects(tx, {
        actionId: ids.actionId,
      });
      const deliveryId = inventory.effects.find(
        (effect) => effect.deliveryId,
      )!.deliveryId!;
      await tx.emailDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "SENDING",
          attemptId: "admitted-attempt",
          attempts: 1,
          leaseUntil: new Date(Date.now() + 300000),
          attemptStartedAt: new Date(),
        },
      });
      const result = await cancelRecoveryDeliveryEffects(
        tx,
        { actionId: ids.actionId },
        "synthetic-inflight",
      );
      expect(
        result.effects.find((effect) => effect.deliveryId === deliveryId)
          ?.disposition,
      ).toBe("IN_FLIGHT_OR_UNKNOWN");
      await finishRecoveryGenericDelivery(
        tx,
        deliveryId,
        "obsolete-attempt",
        !accepted,
      );
      expect(
        (
          await tx.emailDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
          })
        ).status,
      ).toBe("SENDING");
      await finishRecoveryGenericDelivery(
        tx,
        deliveryId,
        "admitted-attempt",
        accepted,
      );
      expect(
        (
          await tx.emailDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
          })
        ).status,
      ).toBe(accepted ? "SENT" : "CANCELLED");
      const [evidence] = await tx.$queryRaw<Array<{ disposition: string }>>`
      SELECT c.disposition FROM "RecoveryDeliveryCancellation" c JOIN "RecoveryDeliveryEffect" e ON e.id=c."effectId"
      WHERE e."deliveryId"=${deliveryId}`;
      expect(evidence?.disposition).toBe("IN_FLIGHT_OR_UNKNOWN");
    });
  },
);

it.each(["CANCELLED", "CANCELLED_RECOVERY"])(
  "settles exact late acceptance after failed stopped transport (%s), preserving the immutable stop",
  async (status) => {
    await fixture(async (tx, ids) => {
      await notice(tx, ids);
      const inventory = await inspectRecoveryDeliveryEffects(tx, {
        actionId: ids.actionId,
      });
      const deliveryId = inventory.effects.find(
        (effect) => effect.deliveryId,
      )!.deliveryId!;
      const lease = new Date(Date.now() + 300_000);
      await tx.emailDelivery.update({
        where: { id: deliveryId },
        data: { leaseUntil: lease },
      });
      const admitted = await admitRecoveryGenericDelivery(
        tx,
        deliveryId,
        lease,
        null,
      );
      if (!admitted || admitted.independent)
        throw new Error("Expected exact captured admission");
      await cancelRecoveryDeliveryEffects(
        tx,
        { actionId: ids.actionId },
        "stop-before-failed-completion",
      );
      await finishRecoveryGenericDelivery(
        tx,
        deliveryId,
        admitted.attemptId,
        false,
      );
      expect(
        (
          await tx.emailDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
          })
        ).status,
      ).toBe("CANCELLED");
      if (status !== "CANCELLED")
        await tx.emailDelivery.update({
          where: { id: deliveryId },
          data: { status },
        });
      await finishRecoveryGenericDelivery(
        tx,
        deliveryId,
        admitted.attemptId,
        false,
      );
      await finishRecoveryGenericDelivery(
        tx,
        deliveryId,
        "stale-attempt",
        true,
      );
      expect(
        (
          await tx.emailDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
          })
        ).status,
      ).toBe(status);
      expect(
        await admitRecoveryGenericDelivery(
          tx,
          deliveryId,
          lease,
          admitted.attemptId,
        ),
      ).toBeNull();
      await finishRecoveryGenericDelivery(
        tx,
        deliveryId,
        admitted.attemptId,
        true,
      );
      const settled = await tx.emailDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
      });
      expect(settled).toMatchObject({
        status: "SENT",
        attempts: 1,
        attemptId: admitted.attemptId,
      });
      expect(settled.attemptStartedAt).not.toBeNull();
      expect(
        await tx.recoveryDeliveryCancellation.count({
          where: { recoveryKey: "stop-before-failed-completion" },
        }),
      ).toBeGreaterThan(0);
    });
  },
);

it.each(["UNCERTAIN", "UNCERTAIN_RECOVERY"])(
  "retains %s evidence through cancellation and permits only its exact late acceptance",
  async (status) => {
    await fixture(async (tx, ids) => {
      await notice(tx, ids);
      const inventory = await inspectRecoveryDeliveryEffects(tx, {
        actionId: ids.actionId,
      });
      const deliveryId = inventory.effects.find(
        (effect) => effect.deliveryId,
      )!.deliveryId!;
      const lease = new Date(Date.now() + 300_000);
      const admitted = await admitRecoveryGenericDelivery(
        tx,
        deliveryId,
        lease,
        null,
      );
      // The worker's lease must be the exact lease stored on the original row.
      expect(admitted).toBeNull();
      await tx.emailDelivery.update({
        where: { id: deliveryId },
        data: { leaseUntil: lease },
      });
      const first = await admitRecoveryGenericDelivery(
        tx,
        deliveryId,
        lease,
        null,
      );
      if (!first || first.independent)
        throw new Error("Expected exact captured admission");
      await finishRecoveryGenericDelivery(
        tx,
        deliveryId,
        first.attemptId,
        false,
      );
      expect(
        (
          await tx.emailDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
          })
        ).status,
      ).toBe("UNCERTAIN");
      await tx.emailDelivery.update({
        where: { id: deliveryId },
        data: { status, leaseUntil: lease },
      });
      expect(
        await admitRecoveryGenericDelivery(
          tx,
          deliveryId,
          lease,
          first.attemptId,
        ),
      ).toBeNull();
      const stopped = await cancelRecoveryDeliveryEffects(
        tx,
        { actionId: ids.actionId },
        "stop-uncertain-attempt",
      );
      expect(
        stopped.effects.find((effect) => effect.deliveryId === deliveryId)
          ?.disposition,
      ).toBe("IN_FLIGHT_OR_UNKNOWN");
      const retained = await tx.emailDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
      });
      expect(retained).toMatchObject({
        status,
        attemptId: first.attemptId,
        attempts: 1,
      });
      expect(retained.attemptStartedAt).not.toBeNull();
      await finishRecoveryGenericDelivery(
        tx,
        deliveryId,
        "stale-attempt",
        true,
      );
      expect(
        (
          await tx.emailDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
          })
        ).status,
      ).toBe(status);
      await finishRecoveryGenericDelivery(
        tx,
        deliveryId,
        first.attemptId,
        true,
      );
      expect(
        (
          await tx.emailDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
          })
        ).status,
      ).toBe("SENT");
      expect(
        await tx.recoveryDeliveryCancellation.count({
          where: { recoveryKey: "stop-uncertain-attempt" },
        }),
      ).toBeGreaterThan(0);
    });
  },
);

it("does not adopt independent security mail sent to the same recipient during a captured action", async () => {
  await fixture(async (tx, ids) => {
    await withRecoveryDeliverySource(
      tx,
      { entity: "User", recordId: ids.userId, actionId: ids.actionId },
      async () => {
        await tx.emailDelivery.create({
          data: {
            id: `${ids.actionId}-security`,
            userId: ids.userId,
            category: "security",
            event: "password_changed",
            recipient: "synthetic-security@example.test",
          },
        });
      },
    );
    expect(
      await inspectRecoveryDeliveryEffects(tx, { actionId: ids.actionId }),
    ).toMatchObject({ coverage: "COMPLETE", effects: [] });
    await cancelRecoveryDeliveryEffects(
      tx,
      { actionId: ids.actionId },
      "synthetic-security-preserved",
    );
    expect(
      (
        await tx.emailDelivery.findUniqueOrThrow({
          where: { id: `${ids.actionId}-security` },
        })
      ).status,
    ).toBe("PENDING");
  });
});

it("marks unbound ordinary notices and ambiguous multi-root sources unknown instead of matching recipients", async () => {
  await fixture(async (tx, ids) => {
    const other = await tx.recoveryAction.create({
      data: {
        kind: "INITIAL_ADMISSION",
        applicationId: "synthetic-other-application",
        before: {},
        after: {},
      },
    });
    await tx.recoveryTrackedEntity.create({
      data: { actionId: other.id, entity: "User", recordId: ids.userId },
    });
    const [clock] = await tx.$queryRaw<
      Array<{ transactionId: string }>
    >`SELECT txid_current()::text AS "transactionId"`;
    await tx.recoveryEvent.create({
      data: {
        actionId: other.id,
        transactionId: clock!.transactionId,
        kind: "ASSIGNMENT",
      },
    });
    await withRecoveryDeliverySource(
      tx,
      { entity: "User", recordId: ids.userId },
      () =>
        notifyUsers([ids.userId], { title: "Synthetic ambiguous update" }, tx),
    );
    for (const actionId of [ids.actionId, other.id])
      expect(
        await inspectRecoveryDeliveryEffects(tx, { actionId }),
      ).toMatchObject({ coverage: "UNKNOWN", effects: [] });
  });
  await fixture(async (tx, ids) => {
    await notifyUsers(
      [ids.userId],
      { title: "Synthetic independent ordinary update" },
      tx,
    );
    expect(
      await inspectRecoveryDeliveryEffects(tx, { actionId: ids.actionId }),
    ).toMatchObject({ coverage: "UNKNOWN", effects: [] });
  });
});

it("refuses a selected root without its own exact source mutation", async () => {
  await fixture(async (tx, ids) => {
    const selected = await tx.recoveryAction.create({
      data: { kind: "DOMAIN_CHECKPOINT", before: {}, after: {} },
    });
    await tx.recoveryTrackedEntity.create({
      data: { actionId: selected.id, entity: "User", recordId: ids.userId },
    });
    const [clock] = await tx.$queryRaw<
      Array<{ transactionId: string }>
    >`SELECT txid_current()::text AS "transactionId"`;
    await tx.recoveryEvent.create({
      data: {
        id: createHash("md5")
          .update(`${selected.id}:${clock!.transactionId}`)
          .digest("hex"),
        actionId: selected.id,
        transactionId: clock!.transactionId,
        kind: "CHECKPOINT_CAPTURE",
      },
    });
    await withRecoveryDeliverySource(
      tx,
      { entity: "User", recordId: ids.userId, actionId: selected.id },
      () =>
        notifyUsers(
          [ids.userId],
          { title: "Synthetic notice before its declared source mutation" },
          tx,
        ),
    );
    for (const actionId of [ids.actionId, selected.id])
      expect(
        await inspectRecoveryDeliveryEffects(tx, { actionId }),
      ).toMatchObject({ coverage: "UNKNOWN", effects: [] });
  });
});

it("fails closed when exact same-transaction attribution exceeds one hundred roots", async () => {
  await fixture(async (tx, ids) => {
    const extra = Array.from({ length: 100 }, (_, index) => ({
      actionId: `${ids.actionId}-fanout-${index}`,
      eventId: `fanout-${randomUUID()}`,
    }));
    const [clock] = await tx.$queryRaw<
      Array<{ transactionId: string }>
    >`SELECT txid_current()::text AS "transactionId"`;
    await tx.recoveryAction.createMany({
      data: extra.map(({ actionId }) => ({
        id: actionId,
        kind: "DOMAIN_CHECKPOINT",
        before: {},
        after: {},
      })),
    });
    await tx.recoveryEvent.createMany({
      data: extra.map(({ actionId, eventId }) => ({
        id: eventId,
        actionId,
        transactionId: clock!.transactionId,
        kind: "CHECKPOINT_CAPTURE",
      })),
    });
    // These synthetic journal rows exercise the observer's bounded fanout without
    // running a hundred unrelated domain writers in a single test transaction.
    await tx.recoveryChange.createMany({
      data: extra.map(({ actionId, eventId }) => ({
        actionId,
        eventId,
        entity: "User",
        operation: "UPDATE",
        recordKey: { id: ids.userId },
        before: { id: ids.userId },
        after: { id: ids.userId },
        changedFields: ["profileVersion"],
      })),
    });
    await withRecoveryDeliverySource(
      tx,
      { entity: "User", recordId: ids.userId, actionId: ids.actionId },
      () =>
        notifyUsers(
          [ids.userId],
          { title: "Synthetic excessive shared-root notice" },
          tx,
        ),
    );
    expect(
      await inspectRecoveryDeliveryEffects(tx, { actionId: ids.actionId }),
    ).toMatchObject({ coverage: "UNKNOWN", effects: [] });
    expect(
      await tx.recoveryDeliveryEffect.count({
        where: {
          actionId: { in: [ids.actionId, ...extra.map((row) => row.actionId)] },
        },
      }),
    ).toBe(0);
    expect(
      await tx.recoveryDeliveryCoverage.count({
        where: {
          eventId: { in: [ids.eventId, ...extra.map((row) => row.eventId)] },
          version: 0,
        },
      }),
    ).toBe(101);
  });
});

it("shares exact source-change effects with older roots while keeping unrelated typed overlap independent", async () => {
  await fixture(async (tx, ids) => {
    const active = await tx.recoveryAction.create({
      data: { kind: "DOMAIN_CHECKPOINT", before: {}, after: {} },
    });
    await tx.recoveryTrackedEntity.create({
      data: { actionId: active.id, entity: "User", recordId: ids.userId },
    });
    const [clock] = await tx.$queryRaw<
      Array<{ transactionId: string }>
    >`SELECT txid_current()::text AS "transactionId"`;
    await tx.recoveryEvent.create({
      data: {
        id: createHash("md5")
          .update(`${active.id}:${clock!.transactionId}`)
          .digest("hex"),
        actionId: active.id,
        transactionId: clock!.transactionId,
        kind: "DOMAIN_CHECKPOINT",
      },
    });
    await tx.$queryRaw`SELECT set_config('shbs.recovery_action',${active.id},true)`;
    await tx.user.update({
      where: { id: ids.userId },
      data: { emailMessages: true },
    });
    await withRecoveryDeliverySource(
      tx,
      { entity: "User", recordId: ids.userId },
      () =>
        notifyUsers(
          [ids.userId],
          { title: "Synthetic selected checkpoint update" },
          tx,
        ),
    );
    const older = await inspectRecoveryDeliveryEffects(tx, {
      actionId: ids.actionId,
    });
    expect(older.coverage).toBe("COMPLETE");
    expect(older.effects.some((effect) => effect.deliveryId)).toBe(true);
    const selected = await inspectRecoveryDeliveryEffects(tx, {
      actionId: active.id,
    });
    expect(selected.coverage).toBe("COMPLETE");
    expect(selected.effects.some((effect) => effect.notificationId)).toBe(true);
    expect(older.effects.map((effect) => effect.deliveryId).sort()).toEqual(
      selected.effects.map((effect) => effect.deliveryId).sort(),
    );
    await cancelRecoveryDeliveryEffects(
      tx,
      { actionId: ids.actionId },
      "stop-shared-older-root",
    );
    const selectedAfterStop = await inspectRecoveryDeliveryEffects(tx, {
      actionId: active.id,
    });
    expect(
      selectedAfterStop.effects.every((effect) => effect.cancellation !== null),
    ).toBe(true);
    const mailId = selected.effects.find(
      (effect) => effect.deliveryId,
    )!.deliveryId!;
    const stopped = await tx.emailDelivery.findUniqueOrThrow({
      where: { id: mailId },
    });
    expect(stopped.status).toBe("CANCELLED");
    expect(
      await admitRecoveryGenericDelivery(
        tx,
        mailId,
        new Date(Date.now() + 300_000),
        stopped.attemptId,
      ),
    ).toBeNull();
  });
  await fixture(async (tx, ids) => {
    const unrelated = await tx.recoveryAction.create({
      data: { kind: "DOMAIN_CHECKPOINT", before: {}, after: {} },
    });
    await tx.recoveryTrackedEntity.create({
      data: { actionId: unrelated.id, entity: "Tutor", recordId: ids.userId },
    });
    await tx.$queryRaw`SELECT set_config('shbs.recovery_action',${unrelated.id},true)`;
    await withRecoveryDeliverySource(
      tx,
      { entity: "User", recordId: ids.userId },
      () =>
        notifyUsers(
          [ids.userId],
          { title: "Synthetic exact typed source" },
          tx,
        ),
    );
    expect(
      (await inspectRecoveryDeliveryEffects(tx, { actionId: ids.actionId }))
        .effects.length,
    ).toBeGreaterThan(0);
    expect(
      await tx.recoveryDeliveryEffect.count({
        where: { actionId: unrelated.id },
      }),
    ).toBe(0);
  });
});
