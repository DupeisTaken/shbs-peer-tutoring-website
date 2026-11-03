import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DomainDb } from "./transactions";

const transfers = z.array(z.object({
  entity: z.enum(["Tutor", "Tutee"]), recordId: z.string(),
  sourceUserId: z.string(), readerUserId: z.string(),
}));

/** Operational provenance is exact-profile evidence, never Person membership or
 * the credential retirement family. A new history reader does not clear it. */
export async function participantSourceRestrictions(
  db: DomainDb, kind: "TUTOR" | "TUTEE", sourceId: string,
) {
  const entity = kind === "TUTOR" ? "Tutor" : "Tutee";
  const [override, retained, direct, receipts] = await Promise.all([
    db.historyRowOwnership.findUnique({ where: { entity_recordId: { entity, recordId: sourceId } } }),
    kind === "TUTOR"
      ? db.tutorProfileOwnership.findUnique({ where: { tutorId: sourceId }, select: { userId: true, revision: true } })
      : db.studentProfileOwnership.findUnique({ where: { tuteeId: sourceId }, select: { userId: true, revision: true } }),
    db.user.findUnique({ where: kind === "TUTOR" ? { tutorId: sourceId } : { studentId: sourceId }, select: { id: true } }),
    db.personCombineReceipt.findMany({
      where: { ownershipTransfers: { array_contains: [{ entity, recordId: sourceId }] } },
      select: { id: true, ownershipTransfers: true }, orderBy: { id: "asc" },
    }),
  ]);
  const sourceUserIds = [...new Set([
    ...(override?.sourceUserIds ?? []),
    ...receipts.flatMap((receipt) => transfers.parse(receipt.ownershipTransfers)
      .filter((row) => row.entity === entity && row.recordId === sourceId)
      .map((row) => row.sourceUserId)),
    ...(retained ? [retained.userId] : []), ...(direct ? [direct.id] : []),
  ])].sort();
  const accounts = await db.user.findMany({
    where: { id: { in: sourceUserIds } },
    select: { id: true, suspendedAt: true, recoveryVoidedAt: true, schoolDeparture: {
      select: { reason: true, revision: true, observerRevoked: true },
    } }, orderBy: { id: "asc" },
  });
  const blockers: { userId: string; reason: "MISSING_SOURCE" | "SUSPENDED" | "VOIDED" | "SCHOOL_DEPARTURE" }[] = [];
  for (const userId of sourceUserIds) {
    const account = accounts.find((row) => row.id === userId);
    if (!account) { blockers.push({ userId, reason: "MISSING_SOURCE" }); continue; }
    if (account.suspendedAt) blockers.push({ userId, reason: "SUSPENDED" });
    if (account.recoveryVoidedAt) blockers.push({ userId, reason: "VOIDED" });
    if (account.schoolDeparture?.reason) blockers.push({ userId, reason: "SCHOOL_DEPARTURE" });
  }
  return { kind, sourceId, sourceUserIds, ownershipRevision: override?.revision ?? null,
    retained, direct, receiptIds: receipts.map((row) => row.id), accounts, blockers };
}

export async function requireParticipantSourceParticipation(
  db: DomainDb, kind: "TUTOR" | "TUTEE", sourceId: string,
) {
  const evidence = await participantSourceRestrictions(db, kind, sourceId);
  if (evidence.blockers.length) throw new TRPCError({
    code: "FORBIDDEN",
    message: "Resolve this participation source's original account suspension or school departure through its owning workflow before activating or assigning it.",
  });
  return evidence;
}
