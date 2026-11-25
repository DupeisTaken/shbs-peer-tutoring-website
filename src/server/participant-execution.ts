import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../generated/prisma";
import type { DomainDb, TransactionDb } from "./transactions";
import { z } from "zod";
import { participantSourceRestrictions } from "./participant-source-restrictions";

export type ParticipantKind = "TUTOR" | "TUTEE";

/** Operational identity is explicit authority, never inferred from directory or
 * history membership. The permanent source rows remain attribution evidence. */
export async function executionParticipantId(db: DomainDb, kind: ParticipantKind, sourceId: string) {
  const visited = new Set<string>();
  let current = sourceId;
  for (;;) {
    if (visited.has(current)) throw new TRPCError({ code: "CONFLICT", message: "Participation execution needs review." });
    visited.add(current);
    const mapping = await db.participantConsolidation.findUnique({ where: { kind_sourceId: { kind, sourceId: current } } });
    if (!mapping?.active) return current;
    current = mapping.targetId;
  }
}

/** Only used to enumerate actionable original work, never as private history access. */
export async function executionSourceIds(db: DomainDb, kind: ParticipantKind, targetId: string) {
  const rows = await db.participantConsolidation.findMany({ where: { kind, active: true }, orderBy: { sourceId: "asc" } });
  const ids = new Set([targetId]);
  for (;;) {
    const before = ids.size;
    for (const row of rows) if (ids.has(row.targetId)) ids.add(row.sourceId);
    if (before === ids.size) return [...ids];
  }
}

/** Original recurring assignments are retained for history but cease to reserve
 * current work once an exact successor commits. Keep this out of history queries. */
export async function supersededPairingIds(db: DomainDb, candidates?: string[]) {
  if (candidates?.length === 0) return [];
  const rows = await db.pairingExecutionSuccessor.findMany({
    ...(candidates ? { where: { sourcePairingId: { in: candidates } } } : {}),
    select: { sourcePairingId: true },
  });
  return rows.map((row) => row.sourcePairingId);
}

/**
 * Disbanded pairings (no remaining non-INACTIVE tutees) stay in the database
 * for attendance, audit and reinstatement evidence, but are hidden from active
 * pairings views. Members of an active-term saved group remain visible as long
 * as at least one non-superseded member still has a current tutee so incomplete
 * groups stay visible for repair or splitting.
 */
export function activePairingRosterWhere(
  superseded: readonly string[],
): Prisma.PairingWhereInput {
  const populated: Prisma.PairingWhereInput = {
    tutees: { some: { tutee: { status: { not: "INACTIVE" } } } },
  };
  return {
    OR: [
      populated,
      {
        group: {
          pairings: {
            some: {
              ...(superseded.length ? { id: { notIn: [...superseded] } } : {}),
              term: { active: true },
              ...populated,
            },
          },
        },
      },
    ],
  };
}

/**
 * Release schedule and room reservations on active-term pairings that no longer
 * have any current (non-INACTIVE) tutees. Standalone pairings release immediately;
 * saved PairingGroup members release together only when every non-superseded
 * active-term member in the group is empty (preserving partially-empty groups
 * that still need repair or splitting).
 *
 * The Pairing rows stay in the database for attendance, audit and reinstatement
 * history, while freeing their room and tutor slot for future assignments.
 * Reversible disciplinary/voluntary removals (`finalizeRemoval`) intentionally
 * skip this helper so card-correction and checkpoint reinstatement preserve the
 * original schedule, room and group identity; disbanded rows remain hidden from
 * active rosters via `activePairingRosterWhere`.
 */
export async function releaseDisbandedPairingReservations(
  tx: TransactionDb,
  pairingIds: readonly string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(pairingIds)].sort();
  if (!uniqueIds.length) return [];
  const superseded = await supersededPairingIds(tx);
  const candidates = await tx.pairing.findMany({
    where: {
      id: { in: uniqueIds, notIn: superseded },
      term: { active: true },
    },
    select: {
      id: true,
      groupId: true,
      scheduleConfirmed: true,
      roomId: true,
      roomNeedsAssignment: true,
      roomShortageKey: true,
      tutees: {
        where: { tutee: { status: { not: "INACTIVE" } } },
        select: { tuteeId: true },
        take: 1,
      },
    },
    orderBy: { id: "asc" },
  });

  const emptyStandalone: string[] = [];
  const candidateGroupIds = new Set<string>();
  for (const row of candidates) {
    if (row.tutees.length > 0) continue;
    if (row.groupId) candidateGroupIds.add(row.groupId);
    else if (
      row.scheduleConfirmed ||
      row.roomId !== null ||
      row.roomNeedsAssignment ||
      row.roomShortageKey !== null
    ) {
      emptyStandalone.push(row.id);
    }
  }

  const emptyGroupMembers: string[] = [];
  const emptyGroupIds: string[] = [];
  if (candidateGroupIds.size > 0) {
    const groupMembers = await tx.pairing.findMany({
      where: {
        groupId: { in: [...candidateGroupIds].sort() },
        id: { notIn: superseded },
        term: { active: true },
      },
      select: {
        id: true,
        groupId: true,
        scheduleConfirmed: true,
        roomId: true,
        roomNeedsAssignment: true,
        roomShortageKey: true,
        tutees: {
          where: { tutee: { status: { not: "INACTIVE" } } },
          select: { tuteeId: true },
          take: 1,
        },
      },
      orderBy: { id: "asc" },
    });
    const byGroup = new Map<string, typeof groupMembers>();
    for (const member of groupMembers) {
      if (!member.groupId) continue;
      const list = byGroup.get(member.groupId) ?? [];
      list.push(member);
      byGroup.set(member.groupId, list);
    }
    for (const [groupId, members] of byGroup) {
      if (members.every((member) => member.tutees.length === 0)) {
        emptyGroupIds.push(groupId);
        for (const member of members) {
          if (
            member.groupId !== null ||
            member.scheduleConfirmed ||
            member.roomId !== null ||
            member.roomNeedsAssignment ||
            member.roomShortageKey !== null
          ) {
            emptyGroupMembers.push(member.id);
          }
        }
      }
    }
  }

  const toRelease = [...new Set([...emptyStandalone, ...emptyGroupMembers])].sort();
  if (!toRelease.length && !emptyGroupIds.length) return [];

  if (toRelease.length) {
    await tx.pairing.updateMany({
      where: { id: { in: toRelease } },
      data: {
        groupId: null,
        scheduleConfirmed: false,
        roomId: null,
        roomNeedsAssignment: false,
        roomShortageKey: null,
        roomVersion: { increment: 1 },
      },
    });
  }
  if (emptyGroupIds.length) {
    await tx.pairingGroup.deleteMany({
      where: { id: { in: emptyGroupIds }, pairings: { none: {} } },
    });
  }
  return toRelease;
}

export async function assertOperationalPairing(db: DomainDb, id: string) {
  const successor = await db.pairingExecutionSuccessor.findUnique({ where: { sourcePairingId: id } });
  if (successor) throw new TRPCError({ code: "CONFLICT", message: "This assignment was transferred. Open its current execution assignment before changing it." });
}

export async function executionPairingId(db: DomainDb, sourcePairingId: string) {
  const seen = new Set<string>();
  let id = sourcePairingId;
  for (;;) {
    if (seen.has(id)) throw new TRPCError({ code: "CONFLICT", message: "Assignment execution needs review." });
    seen.add(id);
    const row = await db.pairingExecutionSuccessor.findUnique({ where: { sourcePairingId: id } });
    if (!row) return id;
    id = row.targetPairingId;
  }
}

/** Excluding a current recurrence also excludes its own retained publication
 * evidence; unrelated aliases and other sources still reserve their intervals. */
export async function pairingEvidenceIds(db: DomainDb, currentIds: readonly string[]) {
  const ids = new Set(currentIds);
  let frontier = [...ids];
  while (frontier.length) {
    const rows = await db.pairingExecutionSuccessor.findMany({ where: { targetPairingId: { in: frontier } }, select: { sourcePairingId: true } });
    frontier = rows.map((row) => row.sourcePairingId).filter((id) => !ids.has(id));
    for (const id of frontier) ids.add(id);
  }
  return [...ids];
}

/** A published plan's execution is pinned at review time; later source aliases
 * cannot reinterpret its actor without another explicit transfer revision. */
export async function executionPlanTutorId(db: DomainDb, planId: string, originalTutorId: string) {
  const row = await db.sessionPlanExecution.findUnique({ where: { planId } });
  return row?.tutorId ?? originalTutorId;
}

export async function executionResponseActor(db: DomainDb, response: { id: string; actorUserId: string; actorKey: string }) {
  const row = await db.sessionResponseExecution.findUnique({ where: { responseId: response.id } });
  return row ? { userId: row.userId, actorKey: `${row.profileKind.toLowerCase()}:${row.profileId}` } : { userId: response.actorUserId, actorKey: response.actorKey };
}

/** Only pending-response authority is projected. Returned original actor keys
 * still address immutable offer slots and rejection history. */
export async function executionResponseOwnerIds(db: DomainDb, responseIds: string[]) {
  const rows = responseIds.length ? await db.sessionResponseExecution.findMany({ where: { responseId: { in: responseIds } } }) : [];
  return new Map(rows.map((row) => [row.responseId, row.userId]));
}

export const executionAssignments = z.array(z.object({ sourcePairingId: z.string(), targetPairingId: z.string() }));

/** Revalidate the pinned execution projection, including independent later roster
 * edits. A transfer receipt is not a blanket exception to source freshness. */
export async function transferredPlanIsCurrent(db: DomainDb, plan: {
  id: string; termId: string; term: { active: boolean };
  assignments: readonly { pairingId: string; subject: string; tuteeIds: unknown }[];
  participants: readonly { id: string; tuteeId: string }[];
  continuationMembers: readonly { pairingId: string; tuteeId: string; releasedAt: Date | null }[];
}, allowEndedTerm: boolean, addition?: { pairingId: string; tuteeId: string }, snapshot?: { planId: string; tutorId: string; assignments: unknown } | null) {
  const execution = snapshot === undefined ? await db.sessionPlanExecution.findUnique({ where: { planId: plan.id } }) : snapshot;
  if (!execution) return null;
  if (!plan.term.active && !allowEndedTerm) return false;
  await db.$queryRaw`SELECT id FROM "User" WHERE "tutorId"=${execution.tutorId} FOR SHARE`;
  await db.$queryRaw`SELECT id FROM "Tutor" WHERE id=${execution.tutorId} FOR SHARE`;
  const tutor = await db.tutor.findUnique({ where: { id: execution.tutorId }, include: { user: { include: { schoolDeparture: true } } } });
  if (tutor?.status !== "ACTIVE" || !tutor.user || tutor.user.role === "VIEWER" || tutor.user.suspendedAt || tutor.user.mergedIntoId || tutor.user.recoveryVoidedAt || tutor.user.tutorAccessRevoked || tutor.user.schoolDeparture?.reason) return false;
  if ((await participantSourceRestrictions(db, "TUTOR", execution.tutorId)).blockers.length) return false;
  // Ended published lessons retain their captured roster just like ordinary plans.
  if (!plan.term.active && allowEndedTerm) return true;
  const mappings = executionAssignments.parse(execution.assignments);
  const students = await db.sessionParticipantExecution.findMany({ where: { participantId: { in: plan.participants.map((row) => row.id) } } });
  const byOriginal = new Map(plan.participants.map((row) => [row.tuteeId, students.find((mapping) => mapping.participantId === row.id)?.tuteeId ?? row.tuteeId]));
  const learnerIds = [...new Set(byOriginal.values())].sort();
  for (const id of learnerIds) if ((await participantSourceRestrictions(db, "TUTEE", id)).blockers.length) return false;
  const pairingIds = mappings.map((row) => row.targetPairingId).sort();
  await db.$queryRaw`SELECT id FROM "Tutee" WHERE id=ANY(${learnerIds}::text[]) ORDER BY id FOR SHARE`;
  await db.$queryRaw`SELECT id FROM "Pairing" WHERE id=ANY(${pairingIds}::text[]) ORDER BY id FOR UPDATE`;
  await db.$queryRaw`SELECT "pairingId","tuteeId" FROM "PairingTutee" WHERE "pairingId"=ANY(${pairingIds}::text[]) ORDER BY "pairingId","tuteeId" FOR SHARE`;
  const targets = await db.pairing.findMany({ where: { id: { in: mappings.map((row) => row.targetPairingId) } }, include: { tutees: { where: { tutee: { status: { not: "INACTIVE" } } }, select: { tuteeId: true } } } });
  const requestMappings = await db.studentRequestExecutionAssignment.findMany({ where: { pairingId: { in: pairingIds }, releasedAt: null } });
  const openRequests = await db.studentSurvey.findMany({ where: { id: { in: requestMappings.map((row) => row.surveyId) }, state: "OPEN" }, select: { id: true, tuteeId: true } });
  const activeRequests = requestMappings.filter((row) => openRequests.some((request) => request.id === row.surveyId && request.tuteeId === row.sourceTuteeId));
  return plan.assignments.every((original) => {
    const targetId = mappings.find((row) => row.sourcePairingId === original.pairingId)?.targetPairingId;
    const target = targets.find((row) => row.id === targetId);
    if (target?.tutorId !== execution.tutorId || target.termId !== plan.termId || target.subject !== original.subject) return false;
    const released = new Set(plan.continuationMembers.filter((row) => row.pairingId === original.pairingId && row.releasedAt).map((row) => row.tuteeId));
    const expected = [...new Set([
      ...z.array(z.string()).parse(original.tuteeIds),
      ...plan.continuationMembers.filter((row) => row.pairingId === original.pairingId).map((row) => row.tuteeId),
      ...(addition?.pairingId === original.pairingId ? [addition.tuteeId] : []),
    ].filter((value) => !released.has(value)).map((value) => byOriginal.get(value) ?? value))].sort();
    // A released original participant must not be revived by another request's
    // shared physical roster row, nor make the remaining peers' plan stale.
    const releasedExecutors = new Set([...released].map((value) => byOriginal.get(value) ?? value).filter((value) => !expected.includes(value)));
    const sharedReleased = new Set(activeRequests.filter((row) => row.pairingId === target.id && releasedExecutors.has(row.tuteeId) && !released.has(row.sourceTuteeId)).map((row) => row.tuteeId));
    return JSON.stringify(expected) === JSON.stringify(target.tutees.map((row) => row.tuteeId).filter((value) => !sharedReleased.has(value)).sort());
  });
}
