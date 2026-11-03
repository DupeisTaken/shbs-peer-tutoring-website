import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { inspectRecoveryCheckpoint } from "./checkpoint";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());

it.each([
  {
    schemaVersion: 2,
    adapter: "PARTICIPANT_TUTOR",
    adapterVersion: 1,
    sourceEntity: "Tutor",
  },
  {
    schemaVersion: 1,
    adapter: "PARTICIPANT_TUTOR",
    adapterVersion: 2,
    sourceEntity: "Tutor",
  },
  {
    schemaVersion: 1,
    adapter: "PARTICIPANT_TUTOR",
    adapterVersion: 1,
    sourceEntity: "Tutee",
  },
  {
    schemaVersion: 1,
    adapter: "FUTURE_CHECKPOINT_ADAPTER",
    adapterVersion: 1,
    sourceEntity: "FutureParticipant",
  },
])(
  "inspects incompatible checkpoint metadata without parsing its snapshot or reading its source: $adapter/$schemaVersion/$adapterVersion/$sourceEntity",
  async (metadata) => {
    const rollback = "rollback synthetic future checkpoint";
    await expect(
      db.$transaction(
        async (tx) => {
          const action = await tx.recoveryAction.create({
            data: {
              kind: "DOMAIN_CHECKPOINT",
              applicationId: null,
              before: { deliberatelyIncompatibleFuturePayload: true },
              after: {},
            },
          });
          const checkpoint = await tx.recoveryCheckpoint.create({
            data: {
              ...metadata,
              actionId: action.id,
              sourceId: `missing-future-source-${randomUUID()}`,
              capturedById: "synthetic-future-actor",
              captureTransactionId: "synthetic-future-transaction",
              scope: [],
            },
          });
          const plan = await inspectRecoveryCheckpoint(tx, {
            checkpointId: checkpoint.id,
          });
          expect(plan.coverage).toBe("UNKNOWN");
          expect(plan.websiteEligible).toBe(false);
          expect(plan.blockers.join(" ")).toContain(
            "Unsupported checkpoint format",
          );
          expect(plan.adapter).toBe(metadata.adapter);
          expect(plan.effects).toEqual([]);
          throw new Error(rollback);
        },
        { timeout: 20000 },
      ),
    ).rejects.toThrow(rollback);
  },
);
