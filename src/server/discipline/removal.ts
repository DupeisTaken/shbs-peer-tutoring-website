import { z } from "zod";
import { standingFromCounts } from "~/lib/discipline";
import { getActivePeriodOrNull } from "~/server/period";
import { notifyAdmins, notifyUsers } from "~/server/notifications/create";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

export const TUTEE_OPT_OUT_COOLDOWN_DAYS = 7;
const snapshotSchema = z.object({
  pairingIds: z.array(z.string()),
  status: z.enum(["ACTIVE", "PENDING", "INACTIVE"]),
});

/** Preserve current membership before removing it; historical pairings remain evidence. */
async function finalizeRemoval(
  tx: TransactionDb,
  tuteeId: string,
  requestId: string,
): Promise<void> {
  const period = await getActivePeriodOrNull(tx);
  const tutee = await tx.tutee.findUniqueOrThrow({ where: { id: tuteeId } });
  const links = await tx.pairingTutee.findMany({
    where: { tuteeId, pairing: { term: { active: true } } },
    include: {
      pairing: {
        include: { tutor: { select: { user: { select: { id: true } } } } },
      },
    },
  });
  const now = new Date();
  await tx.tutee.update({
    where: { id: tuteeId },
    data: { status: "INACTIVE", updatedAt: now },
  });
  await tx.pairingTutee.deleteMany({
    where: { tuteeId, pairingId: { in: links.map((l) => l.pairingId) } },
  });
  await tx.tuteeRemovalRequest.update({
    where: { id: requestId },
    data: {
      state: "APPROVED",
      resolvedAt: now,
      resolvedByName: "auto",
      removedPeriodKey: period
        ? `${period.schoolYear} ${period.quarter}`
        : null,
      pairingSnapshot: {
        pairingIds: links.map((l) => l.pairingId),
        status: tutee.status,
      },
    },
  });
  await notifyUsers(
    links.flatMap((l) =>
      l.pairing.tutor.user ? [l.pairing.tutor.user.id] : [],
    ),
    {
      title: "Tutee removed",
      body: `${tutee.englishName} was removed from the current roster.`,
      link: "/dashboard",
    },
    tx,
  );
  await notifyAdmins(
    {
      title: "Tutee removed",
      body: `${tutee.englishName} was removed from the current roster.`,
      link: "/admin/tutee-requests",
    },
    undefined,
    tx,
  );
}

/** Cards, removal, membership and notifications share one transaction. A reversal restores
 * only this removal's effects, never a subsequent manual status decision. */
export async function syncPunishmentRemoval(
  db: DomainDb,
  tuteeId: string,
): Promise<{ removed: boolean }> {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `tutee:${tuteeId}`);
    const tutee = await tx.tutee.findUniqueOrThrow({ where: { id: tuteeId } });
    const cards = await tx.disciplinaryCard.groupBy({
      by: ["color"],
      where: { tuteeId, reviewStatus: "VALID" },
      _count: { _all: true },
    });
    const standing = standingFromCounts({
      validYellow: cards.find((c) => c.color === "YELLOW")?._count._all ?? 0,
      validRed: cards.find((c) => c.color === "RED")?._count._all ?? 0,
      pendingYellow: 0,
      pendingRed: 0,
    });
    if (!standing.removalPending) {
      const removal = await tx.tuteeRemovalRequest.findFirst({
        where: { tuteeId, kind: "PUNISHMENT", state: "APPROVED" },
        orderBy: { resolvedAt: "desc" },
      });
      const snapshot = snapshotSchema.safeParse(removal?.pairingSnapshot);
      if (
        removal &&
        snapshot.success &&
        tutee.status === "INACTIVE" &&
        removal.resolvedAt?.getTime() === tutee.updatedAt.getTime()
      ) {
        const pairings = await tx.pairing.findMany({
          where: {
            id: { in: snapshot.data.pairingIds },
            term: { active: true },
            tutor: { status: "ACTIVE" },
          },
          select: { id: true },
        });
        await tx.pairingTutee.createMany({
          data: pairings.map((p) => ({ pairingId: p.id, tuteeId })),
          skipDuplicates: true,
        });
        await tx.tutee.update({
          where: { id: tuteeId },
          data: { status: pairings.length ? snapshot.data.status : "PENDING" },
        });
        await tx.tuteeRemovalRequest.update({
          where: { id: removal.id },
          data: { state: "REINSTATED", resolvedByName: "Card correction" },
        });
      }
      return { removed: false };
    }
    if (tutee.status !== "ACTIVE") return { removed: false };
    const request = await tx.tuteeRemovalRequest.create({
      data: {
        tuteeId,
        kind: "PUNISHMENT",
        reason: `Reached the removal threshold (${standing.effectiveReds} red cards).`,
      },
    });
    await finalizeRemoval(tx, tuteeId, request.id);
    return { removed: true };
  });
}

/** Due voluntary removals are idempotent, even when several readers trigger processing. */
export async function finalizeDueOptOuts(db: DomainDb): Promise<number> {
  return inTransaction(db, async (tx) => {
    const due = await tx.tuteeRemovalRequest.findMany({
      where: {
        kind: "VOLUNTARY",
        state: "PENDING",
        eligibleAt: { lte: new Date() },
      },
      orderBy: { tuteeId: "asc" },
    });
    let count = 0;
    for (const request of due) {
      await lockEntity(tx, `tutee:${request.tuteeId}`);
      const current = await tx.tuteeRemovalRequest.findUnique({
        where: { id: request.id },
      });
      if (current?.state !== "PENDING") continue;
      await finalizeRemoval(tx, request.tuteeId, request.id);
      count++;
    }
    return count;
  });
}
