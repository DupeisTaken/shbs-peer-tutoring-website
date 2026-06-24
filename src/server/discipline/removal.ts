/**
 * Tutee removal engine — the two ways a tutee leaves the program.
 *
 *  - PUNISHMENT (this file): when a tutee's VALID-card standing hits the removal threshold
 *    (2 effective reds; see src/lib/discipline.ts) they are **removed immediately** — set INACTIVE,
 *    detached from all pairings, and a finalized PUNISHMENT `TuteeRemovalRequest` is recorded for
 *    the admin "removed & opted-out" view + the same-quarter re-signup flag. The paired tutors and
 *    the admin team are notified. No admin approval; admins can reinstate afterwards.
 *  - VOLUNTARY opt-out (the tutee asked to leave, relayed by their tutor): the tutor files a
 *    PENDING request with a 7-day recall window (`eligibleAt`); `finalizeDueOptOuts` auto-approves
 *    any whose window has elapsed (lazily, on page load) — same INACTIVE + detach + notify.
 *
 * Standing is a pure function of the card list, so this stays a thin reconciler. Node runtime only.
 */
import type { PrismaClient } from "../../../generated/prisma";
import { standingFromCounts } from "~/lib/discipline";
import { getActivePeriodOrNull } from "~/server/period";
import { notifyAdmins, notifyUsers } from "~/server/notifications/create";

/** The recall window before a relayed opt-out auto-approves. */
export const TUTEE_OPT_OUT_COOLDOWN_DAYS = 7;

/** Active-period key stamped on a finalized removal (e.g. "26-27 Q1"), or null if no active term. */
async function activePeriodKey(db: PrismaClient): Promise<string | null> {
  const active = await getActivePeriodOrNull(db);
  return active ? `${active.schoolYear} ${active.quarter}` : null;
}

/** The user ids of the tutors currently paired with a tutee (to notify them on removal). */
async function pairedTutorUserIds(db: PrismaClient, tuteeId: string): Promise<string[]> {
  const links = await db.pairingTutee.findMany({
    where: { tuteeId },
    select: { pairing: { select: { tutor: { select: { user: { select: { id: true } } } } } } },
  });
  return [
    ...new Set(
      links.map((l) => l.pairing.tutor.user?.id).filter((id): id is string => !!id),
    ),
  ];
}

/**
 * Detach a tutee from all pairings and set them INACTIVE, then stamp the removal request as
 * finalized (APPROVED) with the active period. Shared by both removal paths.
 */
async function finalizeRemoval(
  db: PrismaClient,
  opts: { tuteeId: string; requestId: string; periodKey: string | null },
): Promise<void> {
  await db.$transaction([
    db.tutee.update({ where: { id: opts.tuteeId }, data: { status: "INACTIVE" } }),
    db.pairingTutee.deleteMany({ where: { tuteeId: opts.tuteeId } }),
    db.tuteeRemovalRequest.update({
      where: { id: opts.requestId },
      data: {
        state: "APPROVED",
        resolvedAt: new Date(),
        resolvedByName: "auto",
        removedPeriodKey: opts.periodKey,
      },
    }),
  ]);
}

/**
 * Reconcile a tutee's PUNISHMENT removal with their standing. When they cross the threshold and are
 * still ACTIVE, remove them immediately and notify the paired tutors + admins. Idempotent: a no-op
 * if they're already removed or below threshold. Call after any change to a tutee's VALID card set
 * (card review, auto-issued absence cards).
 */
export async function syncPunishmentRemoval(
  db: PrismaClient,
  tuteeId: string,
): Promise<{ removed: boolean }> {
  const tutee = await db.tutee.findUnique({
    where: { id: tuteeId },
    select: { status: true, englishName: true },
  });
  if (tutee?.status !== "ACTIVE") return { removed: false };

  const groups = await db.disciplinaryCard.groupBy({
    by: ["color", "reviewStatus"],
    where: { tuteeId, reviewStatus: { in: ["VALID", "PENDING"] } },
    _count: { _all: true },
  });
  const counts = { validYellow: 0, validRed: 0, pendingYellow: 0, pendingRed: 0 };
  for (const g of groups) {
    const n = g._count._all;
    if (g.reviewStatus === "VALID") {
      if (g.color === "YELLOW") counts.validYellow += n;
      else counts.validRed += n;
    } else {
      if (g.color === "YELLOW") counts.pendingYellow += n;
      else counts.pendingRed += n;
    }
  }
  const standing = standingFromCounts(counts);
  if (!standing.removalPending) return { removed: false };

  // Capture the tutors to notify before detaching the pairings.
  const tutorUserIds = await pairedTutorUserIds(db, tuteeId);
  const periodKey = await activePeriodKey(db);
  const req = await db.tuteeRemovalRequest.create({
    data: {
      tuteeId,
      kind: "PUNISHMENT",
      reason: `Reached the removal threshold (${standing.effectiveReds} red cards).`,
    },
    select: { id: true },
  });
  await finalizeRemoval(db, { tuteeId, requestId: req.id, periodKey });

  if (tutorUserIds.length > 0) {
    await notifyUsers(tutorUserIds, {
      title: "Tutee removed (discipline)",
      body: `${tutee.englishName} reached the card removal threshold and was removed from your roster.`,
      link: "/dashboard",
    });
  }
  await notifyAdmins({
    title: "Tutee removed (discipline)",
    body: `${tutee.englishName} reached the card removal threshold and was auto-removed.`,
    link: "/admin/tutee-requests",
  });
  return { removed: true };
}

/**
 * Auto-approve any relayed opt-outs whose 7-day recall window has elapsed: remove the tutee and
 * notify the relaying tutor. Called lazily when a relevant page loads (no scheduler). Returns the
 * number finalized.
 */
export async function finalizeDueOptOuts(db: PrismaClient): Promise<number> {
  const due = await db.tuteeRemovalRequest.findMany({
    where: { kind: "VOLUNTARY", state: "PENDING", eligibleAt: { lte: new Date() } },
    select: {
      id: true,
      tuteeId: true,
      requestedByTutorId: true,
      tutee: { select: { englishName: true, status: true } },
    },
  });
  if (due.length === 0) return 0;

  const periodKey = await activePeriodKey(db);
  for (const r of due) {
    // If the tutee is already inactive (removed another way), just close the request.
    if (r.tutee.status !== "ACTIVE") {
      await db.tuteeRemovalRequest.update({
        where: { id: r.id },
        data: { state: "APPROVED", resolvedAt: new Date(), resolvedByName: "auto", removedPeriodKey: periodKey },
      });
      continue;
    }
    await finalizeRemoval(db, { tuteeId: r.tuteeId, requestId: r.id, periodKey });

    if (r.requestedByTutorId) {
      const tutor = await db.tutor.findUnique({
        where: { id: r.requestedByTutorId },
        select: { user: { select: { id: true } } },
      });
      if (tutor?.user?.id) {
        await notifyUsers([tutor.user.id], {
          title: "Tutee opt-out finalized",
          body: `${r.tutee.englishName} has opted out and was removed from your roster.`,
          link: "/dashboard",
        });
      }
    }
  }
  return due.length;
}
