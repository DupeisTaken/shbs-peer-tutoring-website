import { TRPCError } from "@trpc/server";
import { accountHistoryIds } from "~/server/account-history";
import { lockEntity, type TransactionDb } from "~/server/transactions";

export const PATROL_CREDIT_INTERVAL_MS = 20 * 60_000;
export const PATROL_HOURS = 0.5;

/** UTC buckets are independent of timezone/DST and ignore room order, notes and headcounts.
 * A sweep consumes every bucket it observed, but earns only one credit. */
export function patrolEvidenceWindows(observations: { observedAt: Date }[]) {
  return [...new Set(observations.map(({ observedAt }) =>
    Math.floor(observedAt.getTime() / PATROL_CREDIT_INTERVAL_MS) * PATROL_CREDIT_INTERVAL_MS,
  ))].sort((a, b) => a - b).map((time) => new Date(time));
}

/** Claim time is server time, never the caller's backdated observation. Historical evidence
 * remains useful, but automatic credit requires the whole sweep within the last 20 minutes.
 * The separate future-time guard permits at most one minute of device clock skew. */
export function isRecentPatrol(observations: { observedAt: Date }[], now: Date) {
  return observations.length > 0 && observations.every(({ observedAt }) =>
    observedAt.getTime() >= now.getTime() - PATROL_CREDIT_INTERVAL_MS &&
    observedAt.getTime() <= now.getTime() + 60_000,
  );
}

/** Share combine's account advisory locks, in the same sorted order and before row writes.
 * Re-read the ownership mapping after waiting: retiring an account cannot reset its budget.
 * Corrections may retain a retired author, while new submissions require a live login. */
export async function lockPatrolCreditOwner(tx: TransactionDb, authorId: string, historical = false) {
  const initial = await tx.user.findUniqueOrThrow({ where: { id: authorId }, select: { mergedIntoId: true } });
  const ownerId = initial.mergedIntoId ?? authorId;
  for (const id of [...new Set([ownerId, authorId])].sort())
    await lockEntity(tx, `account-profile:${id}`);
  const current = await tx.user.findUniqueOrThrow({ where: { id: authorId }, select: { mergedIntoId: true } });
  const owner = await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { mergedIntoId: true } });
  if (current.mergedIntoId !== initial.mergedIntoId || owner.mergedIntoId)
    throw new TRPCError({ code: "CONFLICT", message: "Account changed. Reload before submitting." });
  if (!historical && current.mergedIntoId)
    throw new TRPCError({ code: "FORBIDDEN", message: "This login has been retired." });
  return accountHistoryIds(tx, ownerId);
}

/** Caller holds the owner lock until commit. Both the rolling server-time cooldown and
 * immutable evidence reservations must allow a new award; a bucket boundary never resets
 * the cooldown. A denied award still permits recording observations with zero hours. */
export async function eligiblePatrolCredit(
  tx: TransactionDb, ownerIds: string[], observations: { observedAt: Date }[], now: Date,
) {
  if (!isRecentPatrol(observations, now)) return false;
  const latest = await tx.patrol.findFirst({
    where: { crewUserId: { in: ownerIds }, creditAwardedAt: { not: null } },
    orderBy: { creditAwardedAt: "desc" }, select: { creditAwardedAt: true },
  });
  if (latest?.creditAwardedAt && now.getTime() - latest.creditAwardedAt.getTime() < PATROL_CREDIT_INTERVAL_MS)
    return false;
  return !(await tx.patrolCreditWindow.findFirst({
    where: { crewUserId: { in: ownerIds }, windowStart: { in: patrolEvidenceWindows(observations) } },
    select: { patrolId: true },
  }));
}

/** Reservations only accumulate. A correction does not move/refund a credit or clear its
 * original evidence; it also reserves newly corrected windows against future replay.
 * Existing legacy/corrected overlaps keep their prior owner and historical hour totals. */
export async function reservePatrolEvidence(
  tx: TransactionDb, patrol: { id: string; crewUserId: string },
  observations: { observedAt: Date }[], correction = false,
) {
  await tx.patrolCreditWindow.createMany({
    data: patrolEvidenceWindows(observations).map((windowStart) => ({
      crewUserId: patrol.crewUserId, patrolId: patrol.id, windowStart,
    })),
    // New awards require all unique claims to succeed atomically. Corrections add evidence
    // without another award and may overlap existing reservations from historical records.
    skipDuplicates: correction,
  });
}
