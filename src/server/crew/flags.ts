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
import type { PrismaClient, Headcount } from "../../../generated/prisma";

type Db = PrismaClient;

/** Minimum students an observation guarantees (4+ is treated as ≥4 — never an under-count below 4). */
export function headcountMin(h: Headcount): number {
  switch (h) {
    case "ZERO": return 0;
    case "ONE": return 1;
    case "TWO": return 2;
    case "THREE": return 3;
    case "FOUR_PLUS": return 4;
  }
}

/** Minute-of-day (UTC) for a timestamp, for matching an observation to a session's time window. */
function minuteOfDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** True when two timestamps fall on the same UTC calendar day. */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** A small grace (minutes) around a session window so a patrol just inside the door still matches. */
const MATCH_GRACE_MIN = 15;

/**
 * Reconcile a session's discrepancy flag with the current crew evidence. Returns whether a flag is
 * (now) raised. Sessions that ran online or without a recorded room are never flagged.
 */
export async function syncSessionFlag(db: Db, sessionId: string): Promise<{ flagged: boolean }> {
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
  // An admin already acted — leave their decision alone.
  if (existing && existing.state !== "PENDING") return { flagged: false };

  const clearFlag = async () => {
    if (existing) await db.sessionFlag.delete({ where: { id: existing.id } });
    return { flagged: false };
  };

  // In a merged block (several subjects, one room) only the primary session carries the flag — the
  // crew counts everyone in the room, so we compare against the block's combined roster, not one
  // sibling. (mergeGroupId == own id on the primary; == primary's id on siblings; null standalone.)
  const isPrimary = session.mergeGroupId == null || session.mergeGroupId === session.id;
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

  // Crew observations in the same room, same day, within the session's time window (+ grace).
  const obs = await db.patrolObservation.findMany({
    where: {
      roomId: session.actualRoomId,
      observedAt: {
        gte: new Date(session.date.getTime() - 24 * 60 * 60 * 1000),
        lte: new Date(session.date.getTime() + 24 * 60 * 60 * 1000),
      },
    },
    select: { headcount: true, observedAt: true },
  });
  const lowStart = session.startMin - MATCH_GRACE_MIN;
  const highEnd = session.endMin + MATCH_GRACE_MIN;
  const matching = obs.filter(
    (o) =>
      sameDay(o.observedAt, session.date) &&
      minuteOfDay(o.observedAt) >= lowStart &&
      minuteOfDay(o.observedAt) <= highEnd,
  );
  if (matching.length === 0) return clearFlag();

  // The crew's *lowest* observed count is the strongest under-count evidence.
  const observed = Math.min(...matching.map((o) => headcountMin(o.headcount)));
  if (observed >= expected) return clearFlag();

  // Discrepancy: raise or refresh the PENDING flag.
  if (existing) {
    await db.sessionFlag.update({ where: { id: existing.id }, data: { expected, observed } });
  } else {
    await db.sessionFlag.create({
      data: { sessionId, tutorId: session.tutorId, expected, observed },
    });
  }
  return { flagged: true };
}
