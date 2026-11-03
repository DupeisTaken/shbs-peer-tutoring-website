import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../generated/prisma";
import { accountHistoryIds } from "./account-history";
import type { DomainDb } from "./transactions";

/** Original recipients are evidence. An exact reviewed override controls access
 * without rewriting that evidence or revealing other rows of the former reader. */
export async function notificationOwnershipWhere(db: DomainDb, userId: string): Promise<Prisma.NotificationWhereInput> {
  const family = await accountHistoryIds(db, userId);
  const overrides = await db.historyRowOwnership.findMany({ where: { entity: "Notification" } });
  return { OR: [
    { userId: { in: family }, id: { notIn: overrides.map((row) => row.recordId) } },
    { id: { in: overrides.filter((row) => row.readerUserId === userId).map((row) => row.recordId) } },
  ] };
}

/** Quarantined restrictions retain their original account/email enforcement.
 * Assignment changes only the account projection; the original email remains blocked. */
export async function quarterBlockAccountWhere(db: DomainDb, userId: string): Promise<Prisma.StudentQuarterBlockWhereInput> {
  const family = await accountHistoryIds(db, userId);
  const overrides = await db.historyRowOwnership.findMany({ where: { entity: "StudentQuarterBlock" } });
  return { OR: [
    { userId: { in: family }, id: { notIn: overrides.filter((row) => row.readerUserId !== null).map((row) => row.recordId) } },
    { id: { in: overrides.filter((row) => row.readerUserId === userId).map((row) => row.recordId) } },
    { id: { in: overrides.filter((row) => row.quarantineUserIds.includes(userId)).map((row) => row.recordId) } },
  ] };
}

/** Ordinary provisioning cannot undo a reviewed quarantine or ownership decision.
 * The correction service is the explicit, revision-bound path to change it. */
export async function assertHistoryProfileOwner(db: DomainDb, kind: "TUTOR" | "TUTEE", id: string, userId: string) {
  const row = await db.historyRowOwnership.findUnique({
    where: { entity_recordId: { entity: kind === "TUTOR" ? "Tutor" : "Tutee", recordId: id } },
  });
  if (row && row.readerUserId !== userId)
    throw new TRPCError({ code: "CONFLICT", message: "This original record has a reviewed history-access decision. Review its exact history correction before changing ownership." });
}
