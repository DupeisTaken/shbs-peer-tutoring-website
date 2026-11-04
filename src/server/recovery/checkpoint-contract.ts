import type { Prisma } from "../../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import type { RecoveryDeliveryInventory } from "./delivery-effects";

export const checkpointAdapterIds = [
  "PARTICIPANT_TUTOR",
  "PARTICIPANT_TUTEE",
  "STUDENT_WORKFLOW",
  "ATTENDANCE",
  "CARD",
  "PROGRAM_REFRESH",
] as const;
export type CheckpointAdapterId = (typeof checkpointAdapterIds)[number];
export type CheckpointActor = { id: string; name?: string | null };
export type CheckpointScopeEntity = { entity: string; recordId: string };
/** An ordinary correction may repair malformed legacy data even when recovery
 * cannot capture its old state. Only explicit format failures use this marker. */
export class UnsupportedCheckpointSnapshot extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedCheckpointSnapshot";
  }
}
export type CheckpointCapture = {
  /** Purpose-specific validated data only; never credentials or arbitrary rows. */
  snapshot: Prisma.InputJsonValue;
  scope: CheckpointScopeEntity[];
};
export type CheckpointJournalChange = {
  id: string;
  eventId: string;
  entity: string;
  operation: string;
  changedFields: Prisma.JsonValue | null;
  recordKey: Prisma.JsonValue;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
};
export type CheckpointContext = {
  actionId: string;
  captureTransactionId?: string;
  scope: CheckpointScopeEntity[];
  changes: CheckpointJournalChange[];
  events: Array<{
    id: string;
    kind: string;
    transactionId: string;
    createdAt: Date;
  }>;
};
export type CheckpointInspection = {
  /** Include every current fact needed to invalidate a stale preview. */
  current: Prisma.InputJsonValue;
  blockers: string[];
  warnings: string[];
  effects: string[];
  preserved: string[];
  /** Explicit empty scope means compensation preserves original event effects
   * (for example, a terminal request receives a separate owner-review draft). */
  compensatedEventIds?: string[];
};
export type CheckpointPlan = {
  version: 1;
  checkpointId: string;
  actionId: string;
  adapter: CheckpointAdapterId;
  sourceEntity: string;
  sourceId: string;
  createdAt: Date;
  fingerprint: string;
  coverage: "COMPLETE" | "UNKNOWN";
  dependentEventCount: number;
  websiteEligible: boolean;
  blockers: string[];
  warnings: string[];
  effects: string[];
  preserved: string[];
  chronology: CheckpointContext["events"];
  receiptId: string | null;
  directRoles: readonly ("ADMIN" | "HEAD")[];
  delivery: RecoveryDeliveryInventory;
};

/** Adapters own domain validation and commands. The protocol owns authorization,
 * complete coverage, review fingerprints, channel limits and atomic receipts. */
export interface CheckpointAdapter {
  id: CheckpointAdapterId;
  version: number;
  sourceEntity: string;
  directRoles: readonly ("ADMIN" | "HEAD")[];
  /** Called before any recovery fence. Reacquiring these same domain locks from
   * an extracted ordinary writer is safe; taking a new domain lock afterwards is not. */
  lock(
    tx: TransactionDb,
    sourceId: string,
    snapshot?: Prisma.JsonValue,
  ): Promise<void>;
  capture(tx: TransactionDb, sourceId: string): Promise<CheckpointCapture>;
  /** Read-only: validate the saved format, current eligibility and every later
   * journal change. Unknown or mixed lifecycle changes must produce blockers. */
  inspect(
    tx: TransactionDb,
    sourceId: string,
    snapshot: Prisma.JsonValue,
    context: CheckpointContext,
  ): Promise<CheckpointInspection>;
  apply(
    tx: TransactionDb,
    sourceId: string,
    snapshot: Prisma.JsonValue,
    actor: CheckpointActor,
    reason: string,
    context: CheckpointContext,
  ): Promise<Prisma.InputJsonValue>;
}
