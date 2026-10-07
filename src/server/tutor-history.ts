import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isHistoricalTutor } from "~/lib/historical-academics";
import { lockAccountProfile } from "./account-profile";
import { lockUsernameNamespace } from "./auth/username";
import { authenticateEmailAction } from "./auth/account-emails";
import { requireHistoryManager } from "./tutee-history";
import { inTransaction, type DomainDb } from "./transactions";

const id = z.string().min(1).max(128);
export const tutorHistoryPair = z.object({ tutorId: id, userId: id });
export const tutorHistoryLink = tutorHistoryPair.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(1000),
  acknowledged: z.literal(true),
  confirmPassword: z.string().max(1024).optional(),
});

/** Ownership is a separate read grant: never replace User.tutorId or mutate
 * roster names, status, academics, departure decisions or recorded service credit. */
export async function previewTutorHistory(
  db: DomainDb,
  input: z.infer<typeof tutorHistoryPair>,
) {
  const [record, user] = await Promise.all([
    db.tutor.findUnique({
      where: { id: input.tutorId },
      include: {
        user: { select: { id: true } },
        retainedOwner: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        _count: {
          select: {
            sessions: true,
            meetingAttendances: true,
            adjustments: true,
          },
        },
      },
    }),
    db.user.findUnique({ where: { id: input.userId } }),
  ]);
  if (!record || !user)
    throw new TRPCError({ code: "NOT_FOUND", message: "HISTORY_NOT_FOUND" });
  if (!isHistoricalTutor(record))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "HISTORY_NOT_HISTORICAL",
    });
  if (
    user.mergedIntoId ||
    user.suspendedAt ||
    !user.passwordHash ||
    !user.emailVerifiedAt ||
    user.mustChangePassword
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "HISTORY_ACCOUNT_NOT_READY",
    });
  const previousOwner = record.retainedOwner?.user ?? null;
  const currentConflict = !!record.user && record.user.id !== user.id;
  const conflict = !!previousOwner && previousOwner.id !== user.id;
  const alreadyLinked =
    !currentConflict &&
    !conflict &&
    (record.user?.id === user.id || previousOwner?.id === user.id);
  // The revision prevents an A→B→A ownership change from reviving an old preview.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        record.id,
        record.updatedAt,
        record.status,
        record.user?.id,
        record.retainedOwner?.userId,
        record.retainedOwner?.revision,
        record._count,
        user.id,
        user.profileVersion,
        user.tutorId,
        user.email,
        user.emailVerifiedAt,
      ]),
    )
    .digest("hex");
  return {
    fingerprint,
    conflict,
    currentConflict,
    alreadyLinked,
    previousOwner,
    record: {
      id: record.id,
      name: record.englishName,
      status: record.status,
      counts: record._count,
    },
    account: { id: user.id, name: user.name, email: user.email },
  };
}

/** Namespace → sorted account locks → Tutor matches signup and combine ordering.
 * Locking the original row also fences status edits and current-login assignment. */
export async function linkTutorHistory(
  db: DomainDb,
  actorId: string,
  input: z.infer<typeof tutorHistoryLink>,
) {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    for (const accountId of [...new Set([actorId, input.userId])].sort())
      await lockAccountProfile(tx, accountId);
    await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id = ${input.tutorId} FOR UPDATE`;
    const actor = await requireHistoryManager(tx, actorId);
    const preview = await previewTutorHistory(tx, input);
    if (preview.fingerprint !== input.fingerprint)
      throw new TRPCError({ code: "CONFLICT", message: "HISTORY_STALE" });
    if (preview.currentConflict)
      throw new TRPCError({ code: "CONFLICT", message: "HISTORY_USE_MERGE" });
    if (preview.alreadyLinked) return { ok: true };
    if (preview.conflict) {
      if (actor.role !== "HEAD")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "HISTORY_HEAD_REQUIRED",
        });
      await authenticateEmailAction(tx, actorId, input.confirmPassword ?? "");
    }
    await tx.tutorProfileOwnership.upsert({
      where: { tutorId: input.tutorId },
      create: { tutorId: input.tutorId, userId: input.userId },
      update: { userId: input.userId, revision: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        entity: "Tutor",
        entityId: input.tutorId,
        operation: "tutorHistory.link",
        kind: "ACTION",
        action: "Linked historical tutor records",
        details: {
          targetUserId: input.userId,
          previousOwnerId: preview.previousOwner?.id ?? null,
          reason: input.reason,
          source: "STAFF",
          record: preview.record,
          fingerprint: preview.fingerprint,
        },
      },
    });
    return { ok: true };
  });
}
