import { describe, expect, it, vi } from "vitest";
import { lockEntity, type TransactionDb } from "~/server/transactions";
vi.mock("~/server/transactions", () => ({
  inTransaction: async (db: unknown, work: (tx: unknown) => Promise<unknown>) =>
    work(db),
  lockEntity: vi.fn(async () => undefined),
}));
import {
  admitRecoveryGenericDelivery,
  cancelRecoveryDeliveryEffects,
  finishRecoveryGenericDelivery,
  inspectRecoveryDeliveryEffects,
  withRecoveryDeliverySource,
} from "./delivery-effects";

function fixture() {
  const lease = new Date(Date.now() + 300_000);
  const mail = {
    id: "delivery",
    category: "info",
    status: "PENDING",
    attempts: 0,
    leaseUntil: lease,
    attemptId: null as string | null,
    attemptStartedAt: null as Date | null,
  };
  const effect = {
    id: "effect",
    actionId: "action",
    eventId: "event",
    notificationId: null as string | null,
    deliveryId: "delivery" as string | null,
    status: "PENDING" as string | null,
    category: "info" as string | null,
    attempts: 0 as number | null,
    leaseUntil: lease as Date | null,
    attemptId: null as string | null,
    attemptStartedAt: null as Date | null,
    readAt: null as Date | null,
    notificationExists: false,
    withdrawnAt: null as Date | null,
    cancellation: null as string | null,
  };
  const state = {
    mapped: true,
    cancelled: false,
    installed: true,
    coverage: [{ eventId: "event", version: 2 }],
    origins: [{ actionId: "action" }],
    effects: [effect],
  };
  const tx = {
    recoveryEvent: { findMany: vi.fn().mockResolvedValue([{ id: "event" }]) },
    emailDelivery: {
      findUnique: vi.fn().mockImplementation(async () => mail),
      update: vi
        .fn()
        .mockImplementation(
          async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(mail, data, {
              attempts:
                mail.attempts + (typeof data.attempts === "object" ? 1 : 0),
            });
            return mail;
          },
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("WITH expected")) return [{ complete: state.installed }];
      if (sql.includes('FROM "RecoveryDeliveryCoverage"'))
        return state.coverage;
      if (sql.includes('LEFT JOIN "EmailDelivery"')) return state.effects;
      if (sql.includes('FROM "RecoveryDeliveryEffect" WHERE "deliveryId"'))
        return state.mapped ? state.origins : [];
      if (sql.includes("WITH shared_physical")) return state.origins;
      if (sql.includes("SELECT true AS found"))
        return state.cancelled ? [{ found: true }] : [];
      if (sql.includes("current_setting('shbs.recovery_delivery_source'"))
        return [{ value: "previous-source" }];
      return [];
    }),
    $executeRaw: vi.fn(
      async (_strings: TemplateStringsArray, ..._values: unknown[]) => 1,
    ),
  };
  return { tx, db: tx as unknown as TransactionDb, state, effect, mail, lease };
}

describe("causal delivery consequence policy", () => {
  it("keeps legacy or filtered-trigger coverage unknown instead of inventing zero effects", async () => {
    const { db, state } = fixture();
    state.coverage = [];
    state.effects = [];
    expect(
      await inspectRecoveryDeliveryEffects(db, { actionId: "action" }),
    ).toMatchObject({ coverage: "UNKNOWN", effects: [] });
    state.coverage = [{ eventId: "event", version: 1 }];
    expect((await inspectRecoveryDeliveryEffects(db, { actionId: "action" })).coverage).toBe("UNKNOWN");
    state.coverage = [{ eventId: "event", version: 2 }];
    state.installed = false;
    expect(
      (await inspectRecoveryDeliveryEffects(db, { actionId: "action" }))
        .coverage,
    ).toBe("UNKNOWN");
    await expect(
      cancelRecoveryDeliveryEffects(db, { actionId: "action" }, "intent"),
    ).rejects.toThrow("RECOVERY_DELIVERY_COVERAGE_UNKNOWN");
  });

  it("reports leased, previously attempted, in-flight and sent outcomes without private transport values", async () => {
    const { db, effect } = fixture();
    for (const [status, attempts, disposition] of [
      ["PENDING", 0, "LEASED"],
      ["PENDING", 1, "PRIOR_ATTEMPT_UNKNOWN"],
      ["SENDING", 1, "IN_FLIGHT_OR_UNKNOWN"],
      ["UNCERTAIN", 1, "IN_FLIGHT_OR_UNKNOWN"],
      ["UNCERTAIN_RECOVERY", 1, "IN_FLIGHT_OR_UNKNOWN"],
      ["SENT", 1, "SENT"],
    ] as const) {
      Object.assign(effect, {
        status,
        attempts,
        attemptId: "private-attempt-fence",
      });
      const result = await inspectRecoveryDeliveryEffects(db, {
        actionId: "action",
      });
      expect(result.effects[0]?.disposition).toBe(disposition);
      expect(JSON.stringify(result)).not.toContain("private-attempt-fence");
      expect(result.effects[0]).not.toHaveProperty("recipient");
    }
  });

  it("cancels exact pending IDs, stops stale leases and preserves independent deliveries", async () => {
    const { db, tx } = fixture();
    const result = await cancelRecoveryDeliveryEffects(
      db,
      { actionId: "action" },
      "recovery-client-key",
    );
    expect(result.effects[0]).toMatchObject({
      id: "effect",
      deliveryId: "delivery",
      disposition: "LEASED",
    });
    expect(tx.emailDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: "delivery", status: { in: ["PENDING", "FAILED"] }, attemptStartedAt: null },
      data: {
        status: "CANCELLED",
        leaseUntil: null,
        attemptId: null,
        completedAt: expect.any(Date) as Date,
        lastError: null,
      },
    });
    expect(
      tx.$executeRaw.mock.calls.some(([sql]) =>
        sql.join("").includes('"RecoveryDeliveryCancellation"'),
      ),
    ).toBe(true);
  });

  it("records in-flight cancellation without pretending that admitted mail was erased", async () => {
    const { db, tx, effect } = fixture();
    effect.status = "SENDING";
    effect.attempts = 1;
    const result = await cancelRecoveryDeliveryEffects(
      db,
      { actionId: "action" },
      "intent",
    );
    expect(result.effects[0]?.disposition).toBe("IN_FLIGHT_OR_UNKNOWN");
    expect(tx.emailDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("refuses specialized report/request delivery compensation without their source adapter", async () => {
    const { db, effect } = fixture();
    effect.category = "request_service";
    expect(
      (await inspectRecoveryDeliveryEffects(db, { actionId: "action" }))
        .coverage,
    ).toBe("UNKNOWN");
  });

  it("rejects stale leases, old attempts and cancellation before generic transport admission", async () => {
    const { db, tx, state, mail, lease } = fixture();
    expect(
      await admitRecoveryGenericDelivery(
        db,
        "delivery",
        new Date(lease.getTime() - 1),
        null,
      ),
    ).toBeNull();
    expect(
      await admitRecoveryGenericDelivery(db, "delivery", lease, "old-attempt"),
    ).toBeNull();
    state.cancelled = true;
    expect(
      await admitRecoveryGenericDelivery(db, "delivery", lease, null),
    ).toBeNull();
    expect(tx.emailDelivery.update).not.toHaveBeenCalled();
    state.cancelled = false;
    const admitted = await admitRecoveryGenericDelivery(
      db,
      "delivery",
      lease,
      null,
    );
    expect(admitted).toMatchObject({
      independent: false,
      attemptId: expect.any(String) as string,
    });
    expect(mail.status).toBe("SENDING");
    expect(mail.attempts).toBe(1);
  });

  it.each([false, true])(
    "finishes an admitted exact attempt after recovery (accepted=%s)",
    async (accepted) => {
      const { db, tx, state, mail } = fixture();
      Object.assign(mail, {
        status: "SENDING",
        attempts: 1,
        attemptId: "current-attempt",
        attemptStartedAt: new Date(),
      });
      state.cancelled = true;
      await finishRecoveryGenericDelivery(
        db,
        "delivery",
        "old-attempt",
        accepted,
      );
      expect(tx.emailDelivery.updateMany).not.toHaveBeenCalled();
      await finishRecoveryGenericDelivery(
        db,
        "delivery",
        "current-attempt",
        accepted,
      );
      expect(tx.emailDelivery.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "delivery",
            status: "SENDING",
            attemptId: "current-attempt",
          },
          data: expect.objectContaining({
            status: accepted ? "SENT" : "CANCELLED",
            leaseUntil: null,
          }) as { status: string; leaseUntil: null },
        }),
      );
    },
  );

  it("does not adopt an independent security/ordinary delivery into recovery transport", async () => {
    const { db, tx, state, lease } = fixture();
    state.mapped = false;
    expect(
      await admitRecoveryGenericDelivery(db, "independent", lease, null),
    ).toEqual({ independent: true });
    expect(tx.emailDelivery.findUnique).not.toHaveBeenCalled();
  });

  it("locks every shared delivery root in sorted order before its single transport admission", async () => {
    const { db, tx, state, lease } = fixture();
    state.origins = [{ actionId: "root-z" }, { actionId: "root-a" }];
    vi.mocked(lockEntity).mockClear();
    const admitted = await admitRecoveryGenericDelivery(db, "delivery", lease, null);
    expect(admitted).toMatchObject({ independent: false });
    expect(vi.mocked(lockEntity).mock.calls.map((call) => call[1])).toEqual(["recovery:root-a", "recovery:root-z"]);
    expect(tx.emailDelivery.update).toHaveBeenCalledTimes(1);
  });

  it("fails closed before admission when a shared delivery exceeds the root bound", async () => {
    const { db, tx, state, lease } = fixture();
    state.origins = Array.from({ length: 101 }, (_, index) => ({ actionId: `root-${index}` }));
    await expect(admitRecoveryGenericDelivery(db, "delivery", lease, null)).rejects.toThrow("RECOVERY_DELIVERY_ROOT_LIMIT");
    expect(tx.emailDelivery.update).not.toHaveBeenCalled();
  });

  it.each(["SENDING", "PENDING", "UNCERTAIN", "UNCERTAIN_RECOVERY"])("never re-admits previously started %s transport", async (status) => {
    const { db, tx, mail, lease } = fixture();
    Object.assign(mail, { status, attemptId: "admitted-attempt", attemptStartedAt: new Date(), attempts: 1 });
    expect(await admitRecoveryGenericDelivery(db, "delivery", lease, "admitted-attempt")).toBeNull();
    expect(tx.emailDelivery.update).not.toHaveBeenCalled();
    expect(mail.attempts).toBe(1);
  });

  it("retains failed admitted transport as uncertainty without scheduling another attempt", async () => {
    const { db, tx, mail } = fixture();
    Object.assign(mail, { status: "SENDING", attemptId: "admitted-attempt", attemptStartedAt: new Date(), attempts: 1 });
    await finishRecoveryGenericDelivery(db, "delivery", "admitted-attempt", false);
    expect(tx.emailDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: "delivery", status: "SENDING", attemptId: "admitted-attempt" },
      data: { status: "UNCERTAIN", leaseUntil: null, completedAt: expect.any(Date) as Date,
        lastError: "Transport was admitted; delivery outcome needs review before any retry." },
    });
  });

  it.each(["UNCERTAIN", "UNCERTAIN_RECOVERY"])("records only an exact late accepted completion from %s", async (status) => {
    const { db, tx, mail } = fixture();
    Object.assign(mail, { status, attemptId: "admitted-attempt", attemptStartedAt: new Date(), attempts: 1 });
    await finishRecoveryGenericDelivery(db, "delivery", "stale-attempt", true);
    expect(tx.emailDelivery.updateMany).not.toHaveBeenCalled();
    await finishRecoveryGenericDelivery(db, "delivery", "admitted-attempt", true);
    expect(tx.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "delivery", status, attemptId: "admitted-attempt" },
      data: expect.objectContaining({ status: "SENT" }),
    }));
  });

  it("preserves a legacy started-PENDING attempt when cancellation records its uncertainty", async () => {
    const { db, tx, effect } = fixture();
    effect.attemptStartedAt = new Date();
    const inventory = await cancelRecoveryDeliveryEffects(db, { actionId: "action" }, "stop-legacy-started");
    expect(inventory.effects[0]?.disposition).toBe("IN_FLIGHT_OR_UNKNOWN");
    expect(tx.emailDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("restores exact source context after a failing notification callback", async () => {
    const { db, tx } = fixture();
    await expect(
      withRecoveryDeliverySource(
        db,
        { entity: "Tutee", recordId: "student" },
        async () => {
          throw new Error("synthetic domain failure");
        },
      ),
    ).rejects.toThrow("synthetic domain failure");
    const writes = tx.$queryRaw.mock.calls as unknown as Array<
      [TemplateStringsArray, ...unknown[]]
    >;
    expect(writes.at(-1)?.[1]).toBe("previous-source");
    await expect(
      withRecoveryDeliverySource(
        db,
        { entity: "PrivateToken", recordId: "secret" },
        async () => undefined,
      ),
    ).rejects.toThrow("INVALID_RECOVERY_DELIVERY_SOURCE");
  });
});
