import { notificationInAppEvent } from "~/lib/notification-details";
import { TRPCError } from "@trpc/server";
import { recordDomainAudit } from "~/server/audit/evidence";
import { auditActorScope } from "~/server/db-scope";
import { standingFromCounts } from "~/lib/discipline";
import { getActivePeriodOrNull } from "~/server/period";
import { notifyAdmins, notifyUsers } from "~/server/notifications/core";
import { withRecoveryDeliverySource } from "~/server/recovery/delivery-effects";
import { preserveHistoricalAcademics } from "~/server/historical-academic-snapshot";
import { isImportedProgramRecord } from "~/server/imported-records";
import { executionParticipantId, executionSourceIds, supersededPairingIds } from "~/server/participant-execution";
import { requireParticipantSourceParticipation } from "~/server/participant-source-restrictions";
import { assertTutorScheduleAvailable } from "~/server/tutor-scheduling";
import { assertPlannedRoomAvailable, lockPlannedRoomSchedule } from "~/server/room-bookings";
import { assertSessionPlanningWeeklyAvailable, lockSessionPlanning } from "~/server/session-planning";
import { canReinstatePunishmentRemoval, punishmentRemovalSnapshot } from "./punishment-restoration";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

export const TUTEE_OPT_OUT_COOLDOWN_DAYS = 7;

/** Keep original assignments/custom subjects, but never reenroll into a current
 * independent restriction or collision. Validate every candidate before writing. */
async function restorationPairings(tx: TransactionDb, tuteeId: string, pairingIds: string[]) {
  await lockPlannedRoomSchedule(tx);
  await lockSessionPlanning(tx);
  const superseded = await supersededPairingIds(tx);
  const pairings = await tx.pairing.findMany({
    where: {
      AND: [{ id: { notIn: superseded } }], id: { in: pairingIds },
      term: { active: true }, tutor: { status: "ACTIVE" },
    },
    include: { tutor: { include: { user: true } } },
    orderBy: { id: "asc" },
  });
  const existing = await tx.pairing.findMany({
    where: {
      id: { notIn: superseded }, term: { active: true },
      tutees: { some: { tuteeId } },
    },
  });
  const accepted: typeof pairings = [];
  for (const pairing of pairings) {
    if (pairing.tutor.user && (pairing.tutor.user.tutorAccessRevoked ||
      pairing.tutor.user.mergedIntoId || pairing.tutor.user.role === "VIEWER")) continue;
    try {
      await requireParticipantSourceParticipation(tx, "TUTOR", pairing.tutorId);
      if (pairing.scheduleConfirmed) {
        const group = pairing.groupId ? await tx.pairing.findMany({ where: {
          groupId: pairing.groupId, tutorId: pairing.tutorId, termId: pairing.termId,
          dayOfWeek: pairing.dayOfWeek, startMin: pairing.startMin, endMin: pairing.endMin,
          roomId: pairing.roomId,
        }, select: { id: true } }) : [];
        const sameBlock = (other: typeof pairing | typeof existing[number]) =>
          pairing.groupId && other.groupId === pairing.groupId &&
          other.tutorId === pairing.tutorId && other.termId === pairing.termId &&
          other.dayOfWeek === pairing.dayOfWeek && other.startMin === pairing.startMin &&
          other.endMin === pairing.endMin && other.roomId === pairing.roomId;
        if ([...existing, ...accepted].some((other) => other.id !== pairing.id &&
          other.scheduleConfirmed && other.dayOfWeek === pairing.dayOfWeek &&
          other.startMin < pairing.endMin && other.endMin > pairing.startMin && !sameBlock(other))) continue;
        const excludePairingIds = [pairing.id, ...group.map((row) => row.id)];
        await assertTutorScheduleAvailable(tx, { ...pairing, excludePairingIds });
        await assertPlannedRoomAvailable(tx, { ...pairing, excludePairingId: pairing.id, excludePairingIds });
        await assertSessionPlanningWeeklyAvailable(tx, { ...pairing, excludePairingIds, tuteeIds: [tuteeId] });
      }
      accepted.push(pairing);
    } catch (error) {
      if (!(error instanceof TRPCError) ||
        !["FORBIDDEN", "PRECONDITION_FAILED", "BAD_REQUEST", "CONFLICT"].includes(error.code)) throw error;
    }
  }
  return accepted;
}

/** Preserve current membership before removing it; historical pairings remain evidence. */
async function finalizeRemoval(
  tx: TransactionDb,
  tuteeId: string,
  requestId: string,
): Promise<void> {
  const period = await getActivePeriodOrNull(tx);
  const tutee = await tx.tutee.findUniqueOrThrow({ where: { id: tuteeId } });
  const links = await tx.pairingTutee.findMany({
    where: {
      tuteeId,
      pairing: {
        id: { notIn: await supersededPairingIds(tx) },
        term: { active: true },
      },
    },
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
  await withRecoveryDeliverySource(
    tx,
    { entity: "TuteeRemovalRequest", recordId: requestId },
    () =>
      notifyUsers(
        links.flatMap((l) =>
          l.pairing.tutor.user ? [l.pairing.tutor.user.id] : [],
        ),
        {
          ...notificationInAppEvent("tutee_removed", undefined, {
            en: `Tutee ${tutee.englishName} was removed from the current roster.`,
            zh: `学习伙伴 ${tutee.englishName} 已从本期名单移除。`,
          }),
          title: "Tutee removed",
          body: `${tutee.englishName} was removed from the current roster.`,
          link: "/dashboard",
        },
        tx,
      ),
  );
  await withRecoveryDeliverySource(
    tx,
    { entity: "TuteeRemovalRequest", recordId: requestId },
    () =>
      notifyAdmins(
        {
          ...notificationInAppEvent("tutee_removed", undefined, {
            en: `Tutee ${tutee.englishName} was removed from the current roster.`,
            zh: `学习伙伴 ${tutee.englishName} 已从本期名单移除。`,
          }),
          title: "Tutee removed",
          body: `${tutee.englishName} was removed from the current roster.`,
          link: "/admin/tutee-requests",
        },
        undefined,
        tx,
      ),
  );
  await recordDomainAudit(tx, {
    operation: "system.finalizeTuteeRemoval",
    entity: "TuteeRemovalRequest",
    entityId: requestId,
    action: "Applied automatic tutee removal",
    system: true,
    before: { id: requestId, tuteeId, state: "PENDING", status: tutee.status },
    after: {
      id: requestId,
      tuteeId,
      state: "APPROVED",
      status: "INACTIVE",
      resolvedAt: now,
    },
    effects: {
      removedPairingIds: links.map((link) => link.pairingId),
      removedPeriodKey: period
        ? `${period.schoolYear} ${period.quarter}`
        : null,
    },
  });
}

/** Cards, removal, membership and notifications share one transaction. A reversal restores
 * only this removal's effects, never a subsequent manual status decision. */
export async function syncPunishmentRemoval(
  db: DomainDb,
  tuteeId: string,
): Promise<{ removed: boolean }> {
  return inTransaction(db, async (tx) => {
    // Serialize preflight even for a no-op: two concurrent card writers must
    // not both observe a below-threshold snapshot before either commits.
    await lockEntity(tx, "program:period");
    tuteeId = await executionParticipantId(tx, "TUTEE", tuteeId);
    // Most reconciliations are reads. Avoid manufacturing a checkpoint for a
    // no-op; the mutation path below still locks and recomputes every condition.
    const candidate = await tx.tutee.findUniqueOrThrow({
      where: { id: tuteeId },
      select: { id: true, status: true },
    });
    const valid = await tx.disciplinaryCard.groupBy({
      by: ["color"],
      where: {
        tuteeId: { in: await executionSourceIds(tx, "TUTEE", tuteeId) },
        reviewStatus: "VALID",
      },
      _count: { _all: true },
    });
    const candidateStanding = standingFromCounts({
      validYellow:
        valid.find((row) => row.color === "YELLOW")?._count._all ?? 0,
      validRed: valid.find((row) => row.color === "RED")?._count._all ?? 0,
      pendingYellow: 0,
      pendingRed: 0,
    });
    if (candidateStanding.removalPending) {
      if (candidate.status !== "ACTIVE") return { removed: false };
    } else {
      const removal = await tx.tuteeRemovalRequest.findFirst({
        where: { tuteeId, kind: "PUNISHMENT", state: "APPROVED" },
        orderBy: { resolvedAt: "desc" },
      });
      // A preserved historical decision is evidence, not authority to recreate
      // participation when a later native card correction runs.
      if (
        removal &&
        (await isImportedProgramRecord(tx, "TuteeRemovalRequest", removal.id))
      )
        return { removed: false };
      if (
        !await canReinstatePunishmentRemoval(tx, candidate, removal)
      )
        return { removed: false };
    }
    const { withAutomaticRecoveryCheckpoint } =
      await import("~/server/recovery/checkpoint");
    const actor = auditActorScope.getStore();
    return withAutomaticRecoveryCheckpoint(
      tx,
      { adapter: "PARTICIPANT_TUTEE", sourceId: tuteeId },
      actor ? { id: actor.id, name: actor.name } : null,
      async () => {
        await lockEntity(tx, `tutee:${tuteeId}`);
        await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id=${tuteeId} FOR UPDATE`;
        const tutee = await tx.tutee.findUniqueOrThrow({
          where: { id: tuteeId },
        });
        const cards = await tx.disciplinaryCard.groupBy({
          by: ["color"],
          where: {
            tuteeId: { in: await executionSourceIds(tx, "TUTEE", tuteeId) },
            reviewStatus: "VALID",
          },
          _count: { _all: true },
        });
        const standing = standingFromCounts({
          validYellow:
            cards.find((c) => c.color === "YELLOW")?._count._all ?? 0,
          validRed: cards.find((c) => c.color === "RED")?._count._all ?? 0,
          pendingYellow: 0,
          pendingRed: 0,
        });
        if (!standing.removalPending) {
          const removal = await tx.tuteeRemovalRequest.findFirst({
            where: { tuteeId, kind: "PUNISHMENT", state: "APPROVED" },
            orderBy: { resolvedAt: "desc" },
          });
          if (
            removal &&
            (await isImportedProgramRecord(
              tx,
              "TuteeRemovalRequest",
              removal.id,
            ))
          )
            return { removed: false };
          const snapshot = punishmentRemovalSnapshot.safeParse(removal?.pairingSnapshot);
          if (
            removal &&
            snapshot.success &&
            await canReinstatePunishmentRemoval(tx, tutee, removal)
          ) {
            // Card corrections that restore roster membership are reversals of applied
            // removal, so their initiating correction must already have Admin/Head authority.
            if (
              !["ADMIN", "HEAD"].includes(
                auditActorScope.getStore()?.role ?? "",
              )
            )
              throw new TRPCError({
                code: "FORBIDDEN",
                message:
                  "Admin or Head approval is required to restore removed participation.",
              });
            const pairings = await restorationPairings(tx, tuteeId, snapshot.data.pairingIds);
            await preserveHistoricalAcademics(tx, "TUTEE", tuteeId);
            await tx.pairingTutee.createMany({
              data: pairings.map((p) => ({ pairingId: p.id, tuteeId })),
              skipDuplicates: true,
            });
            await tx.tutee.update({
              where: { id: tuteeId },
              data: {
                status: pairings.length ? snapshot.data.status : "PENDING",
              },
            });
            await tx.tuteeRemovalRequest.update({
              where: { id: removal.id },
              data: { state: "REINSTATED", resolvedByName: "Card correction" },
            });
            const original = await tx.auditLog.findFirst({
              where: {
                entity: "TuteeRemovalRequest",
                entityId: removal.id,
                operation: "system.finalizeTuteeRemoval",
              },
              orderBy: { createdAt: "asc" },
              select: { id: true },
            });
            await recordDomainAudit(tx, {
              operation: "system.reconcilePunishmentRemoval",
              entity: "TuteeRemovalRequest",
              entityId: removal.id,
              action:
                "Restored participation after Head-authorized card correction",
              system: true,
              before: {
                id: removal.id,
                tuteeId,
                state: "APPROVED",
                status: tutee.status,
              },
              after: {
                id: removal.id,
                tuteeId,
                state: "REINSTATED",
                status: pairings.length ? snapshot.data.status : "PENDING",
              },
              originalActionId: original?.id,
              effects: {
                originalRecordId: removal.id,
                restoredPairingIds: pairings.map((pairing) => pairing.id),
                ...(original
                  ? {}
                  : {
                      originalAuditAvailability: "Unavailable legacy evidence",
                    }),
              },
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
      },
    );
  });
}

/** Due voluntary removals are idempotent, even when several readers trigger processing. */
export async function finalizeDueOptOuts(db: DomainDb): Promise<number> {
  return inTransaction(db, async (tx) => {
    // A relay from an earlier period must never remove newly enrolled participation.
    await lockEntity(tx, "program:period");
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
      const { withAutomaticRecoveryCheckpoint } =
        await import("~/server/recovery/checkpoint");
      await withAutomaticRecoveryCheckpoint(
        tx,
        { adapter: "PARTICIPANT_TUTEE", sourceId: request.tuteeId },
        null,
        async () => {
          await lockEntity(tx, `tutee:${request.tuteeId}`);
          const current = await tx.tuteeRemovalRequest.findUnique({
            where: { id: request.id },
          });
          if (current?.state !== "PENDING") return;
          const participation =
            current.pairingId && current.requestedByTutorId
              ? await tx.pairingTutee.findFirst({
                  where: {
                    pairingId: current.pairingId,
                    tuteeId: current.tuteeId,
                    pairing: {
                      tutorId: current.requestedByTutorId,
                      term: { active: true },
                    },
                    tutee: { status: "ACTIVE" },
                  },
                  select: { tuteeId: true },
                })
              : null;
          if (!participation) {
            await tx.tuteeRemovalRequest.update({
              where: { id: current.id },
              data: {
                state: "DENIED",
                resolvedAt: new Date(),
                resolvedByName:
                  "Participation changed; stale withdrawal cancelled",
              },
            });
            await recordDomainAudit(tx, {
              operation: "system.cancelStaleOptOut",
              entity: "TuteeRemovalRequest",
              entityId: current.id,
              action: "Cancelled stale voluntary removal",
              system: true,
              before: current,
              after: { id: current.id, state: "DENIED" },
              reason: "Participation changed before withdrawal became due",
              outcome: "CANCELLED_STALE",
              effects: { rosterChanged: false },
            });
            return;
          }
          await finalizeRemoval(tx, request.tuteeId, request.id);
          count++;
        },
      );
    }
    return count;
  });
}
