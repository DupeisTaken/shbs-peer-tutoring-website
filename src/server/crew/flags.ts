/**
 * Crew-vs-self-report validation.
 *
 * The crew records how many *students* are in each room (a Headcount bucket) with a timestamp. We
 * compare that against what the tutor entered: if the crew saw **fewer students than the tutor
 * marked present** for the session running in that room at that time, the entry is suspect and we
 * raise a `SessionFlag` (PENDING) for an admin to review — like the removal queues.
 *
 * `syncSessionFlag` keeps exactly one flag per session as a pure reflection of the evidence: it
 * raises/updates a PENDING flag while a discrepancy exists and withdraws an un-actioned one when it
 * no longer does. It runs both when a tutor submits attendance and when a patrol is recorded, so
 * whichever arrives second triggers the check. Node runtime only.
 */
import type { Headcount } from "../../../generated/prisma";

import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { getProgramTimeZone } from "~/server/program/time-zone-reader";
import {
  programDateKey,
  programMinuteOfDay,
  programDayStart,
  programDayEnd,
} from "~/lib/program-time";
import { importedRecordKey } from "~/server/imported-records";
type Db = DomainDb;

/** Minimum students an observation guarantees (4+ is treated as ≥4 — never an under-count below 4). */
export function headcountMin(h: Headcount): number {
  switch (h) {
    case "ZERO":
      return 0;
    case "ONE":
      return 1;
    case "TWO":
      return 2;
    case "THREE":
      return 3;
    case "FOUR_PLUS":
      return 4;
  }
}

/** A small grace (minutes) around a session window so a patrol just inside the door still matches. */
const MATCH_GRACE_MIN = 15;

/** A change to actual attendance evidence invalidates its reviewed flag and linked deduction.
 * Callers preserve the previous state in their audit snapshot before invoking this helper. */
export async function reconsiderSessionFlag(
  tx: TransactionDb,
  sessionId: string,
) {
  await lockEntity(tx, `session-flag:${sessionId}`);
  const [flag, session] = await Promise.all([
    tx.sessionFlag.findUnique({ where: { sessionId } }),
    tx.session.findUnique({
      where: { id: sessionId },
      select: { id: true, mergeGroupId: true },
    }),
  ]);
  if (session && (await frozenFlagEvidence(tx, session, flag))) return;
  if (flag) {
    await tx.serviceHourAdjustment.deleteMany({
      where: { id: `flag:${flag.id}` },
    });
    await tx.sessionFlag.update({
      where: { id: flag.id },
      data: {
        state: "PENDING",
        resolvedAt: null,
        resolvedById: null,
        resolvedByName: null,
        decisionNote: null,
      },
    });
  }
  await syncSessionFlag(tx, sessionId);
}

/**
 * Reconcile a session's discrepancy flag with the current crew evidence. Returns whether a flag is
 * (now) raised. Sessions that ran online or without a recorded room are never flagged.
 */
export async function syncSessionFlag(
  db: Db,
  sessionId: string,
): Promise<{ flagged: boolean }> {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `session-flag:${sessionId}`);
    return reconcileFlag(tx, sessionId);
  });
}

async function reconcileFlag(
  db: Db,
  sessionId: string,
): Promise<{ flagged: boolean }> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      tutorId: true,
      online: true,
      actualRoomId: true,
      date: true,
      startMin: true,
      endMin: true,
      mergeGroupId: true,
    },
  });
  if (!session) return { flagged: false };

  const existing = await db.sessionFlag.findUnique({
    where: { sessionId },
    select: { id: true, state: true },
  });
  if (await frozenFlagEvidence(db, session, existing))
    return { flagged: false };
  // An admin already acted — leave their decision alone.
  if (existing && existing.state !== "PENDING") return { flagged: false };

  const clearFlag = async () => {
    if (existing) await db.sessionFlag.delete({ where: { id: existing.id } });
    return { flagged: false };
  };

  // In a merged block (several subjects, one room) only the primary session carries the flag — the
  // crew counts everyone in the room, so we compare against the block's combined roster, not one
  // sibling. (mergeGroupId == own id on the primary; == primary's id on siblings; null standalone.)
  const isPrimary =
    session.mergeGroupId == null || session.mergeGroupId === session.id;
  if (!isPrimary) return clearFlag();
  if (session.online || !session.actualRoomId) return clearFlag();

  // Expected students = distinct tutees marked PRESENT across the block (the crew counts students,
  // not the tutor, so we don't add 1 for the tutor).
  const present = await db.sessionTutee.findMany({
    where: {
      status: "PRESENT",
      session: session.mergeGroupId
        ? { OR: [{ id: session.id }, { mergeGroupId: session.id }] }
        : { id: session.id },
    },
    select: { tuteeId: true },
    distinct: ["tuteeId"],
  });
  const expected = present.length;
  if (expected <= 0) return clearFlag();

  const timeZone = await getProgramTimeZone(db);
  // Crew observations in the same room, same day, within the session's time window (+ grace).
  const obs = await db.patrolObservation.findMany({
    where: {
      roomId: session.actualRoomId,
      observedAt: {
        gte: programDayStart(session.date.toISOString().slice(0, 10), timeZone),
        lte: programDayEnd(session.date.toISOString().slice(0, 10), timeZone),
      },
    },
    select: { id: true, patrolId: true, headcount: true, observedAt: true },
  });
  const importedObservations = await db.importedRecordProvenance.findMany({
    where: {
      OR: [
        {
          entity: "PatrolObservation",
          recordId: { in: obs.map((row) => row.id) },
        },
        { entity: "Patrol", recordId: { in: obs.map((row) => row.patrolId) } },
      ],
    },
    select: { entity: true, recordId: true },
  });
  const archived = new Set(
    importedObservations.map((row) => `${row.entity}:${row.recordId}`),
  );
  const lowStart = session.startMin - MATCH_GRACE_MIN;
  const highEnd = session.endMin + MATCH_GRACE_MIN;
  const matching = obs.filter(
    (o) =>
      !archived.has(`PatrolObservation:${o.id}`) &&
      !archived.has(`Patrol:${o.patrolId}`) &&
      programDateKey(o.observedAt, timeZone) ===
        session.date.toISOString().slice(0, 10) &&
      programMinuteOfDay(o.observedAt, timeZone) >= lowStart &&
      programMinuteOfDay(o.observedAt, timeZone) <= highEnd,
  );
  if (matching.length === 0) return clearFlag();

  // The crew's *lowest* observed count is the strongest under-count evidence.
  // A lower bound is not evidence of an undercount: 4+ may mean five or fifty students.
  const exact = matching.filter((o) => o.headcount !== "FOUR_PLUS");
  if (!exact.length) return clearFlag();
  const observed = Math.min(...exact.map((o) => headcountMin(o.headcount)));
  if (observed >= expected) return clearFlag();

  // Discrepancy: raise or refresh the PENDING flag.
  if (existing) {
    await db.sessionFlag.update({
      where: { id: existing.id },
      data: { expected, observed },
    });
  } else {
    await db.sessionFlag.create({
      data: { sessionId, tutorId: session.tutorId, expected, observed },
    });
  }
  return { flagged: true };
}

/** Automatic comparison never reinterprets an imported block, flag decision or
 * deduction. Explicit reviewed source corrections remain separate operations. */
async function frozenFlagEvidence(
  db: Db,
  session: { id: string; mergeGroupId: string | null },
  flag: { id: string } | null,
) {
  const blockIds = session.mergeGroupId
    ? (
        await db.session.findMany({
          where: {
            OR: [
              { id: session.mergeGroupId },
              { mergeGroupId: session.mergeGroupId },
            ],
          },
          select: { id: true },
        })
      ).map((row) => row.id)
    : [session.id];
  const attendance = await db.sessionTutee.findMany({
    where: { sessionId: { in: blockIds } },
    select: { sessionId: true, tuteeId: true },
  });
  return !!(await db.importedRecordProvenance.findFirst({
    where: {
      OR: [
        { entity: "Session", recordId: { in: blockIds } },
        {
          entity: "SessionTutee",
          recordId: {
            in: attendance.map((row) =>
              importedRecordKey(row, ["sessionId", "tuteeId"]),
            ),
          },
        },
        ...(flag
          ? [
              { entity: "SessionFlag", recordId: flag.id },
              { entity: "ServiceHourAdjustment", recordId: `flag:${flag.id}` },
            ]
          : []),
      ],
    },
    select: { recordId: true },
  }));
}
