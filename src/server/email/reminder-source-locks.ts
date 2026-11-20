import type { EmailDelivery } from "../../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import { lockPlanningSources } from "~/server/session-planning/source-locks";
import { readCurrentSessionReminderCohort } from "~/server/session-planning";
import { eventReminderSource } from "./event-reminders";

export class ReminderSourceBusy extends Error {
  constructor() {
    super("Reminder source is changing; defer transport admission.");
  }
}

/** Source writers already own these protocols. Never wait for them while holding
 * recovery roots: a writer can hold the protocol before acquiring those roots.
 */
async function tryProtocol(tx: TransactionDb, key: string) {
  const [result] = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
  if (!result?.locked) throw new ReminderSourceBusy();
}

/** Acquire source fences before the outbox row, in the same transaction as its
 * final validator and SENDING stamp. Parent UPDATE locks fence FK additions;
 * SHARE locks on existing joins fence removals. No lock survives into SMTP.
 * A bounded transaction-local lock timeout handles inversions with source writers
 * which already hold rows; contention is deferred without an email attempt.
 */
export async function lockEventReminderSource(
  tx: TransactionDb,
  row: Pick<EmailDelivery, "userId" | "context">,
): Promise<boolean> {
  const source = eventReminderSource(row.context);
  if (!source || !row.userId) return false;
  await tryProtocol(tx, "program:period");
  await tryProtocol(tx, "email-notifications-setting");
  if (source.kind.startsWith("tutoring")) {
    await tryProtocol(tx, "planned-room-schedule");
    await tryProtocol(tx, "session-planning");
  }
  await tx.$queryRaw`SELECT id FROM "ProgramSettings" WHERE id='program' FOR SHARE NOWAIT`;
  await tx.$queryRaw`SELECT key FROM "ProgramFeature" WHERE key IN ('MEETINGS','INTERVIEWS') ORDER BY key FOR SHARE NOWAIT`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${row.userId} FOR UPDATE NOWAIT`;
  await tx.$queryRaw`SELECT email FROM "AccountEmail" WHERE "userId"=${row.userId} ORDER BY email FOR SHARE NOWAIT`;
  await tx.$queryRaw`SELECT "userId" FROM "SchoolDeparture" WHERE "userId"=${row.userId} FOR SHARE NOWAIT`;
  const account = await tx.user.findUnique({
    where: { id: row.userId },
    select: { tutorId: true },
  });
  if (account?.tutorId)
    await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id=${account.tutorId} FOR SHARE NOWAIT`;

  if (source.kind === "meeting") {
    const parents = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "TutorMeeting" WHERE id=${source.sourceId} FOR UPDATE NOWAIT`;
    if (!parents.length) return false;
    await tx.$queryRaw`SELECT id FROM "MeetingAttendance" WHERE "meetingId"=${source.sourceId} ORDER BY id FOR SHARE NOWAIT`;
    return true;
  }
  if (source.kind === "interview") {
    const parents = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "TutorApplication" WHERE id=${source.sourceId} FOR UPDATE NOWAIT`;
    if (!parents.length) return false;
    await tx.$queryRaw`SELECT "tutorId" FROM "InterviewAssignment" WHERE "applicationId"=${source.sourceId} ORDER BY "tutorId" FOR SHARE NOWAIT`;
    return true;
  }

  if (source.kind === "tutoring_cohort") {
    const parents = await tx.$queryRaw<Array<{ id: string; planId: string }>>`
      SELECT id, "planId" FROM "SessionPlanCohort" WHERE id=${source.sourceId} FOR UPDATE NOWAIT`;
    if (!parents[0]) return false;
    const plans = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "SessionPlan" WHERE id=${parents[0].planId} FOR UPDATE NOWAIT`;
    if (!plans.length) return false;
    // This existing reader owns planning and its complete current-source row
    // fences. Calling it before outbox locking avoids source→outbox inversion.
    const cohort = await readCurrentSessionReminderCohort(tx, source.sourceId);
    if (!cohort) return false;
    await tx.$queryRaw`SELECT id FROM "Term" WHERE id=${cohort.plan.termId} FOR SHARE NOWAIT`;
    if (cohort.roomId)
      await tx.$queryRaw`SELECT id FROM "Room" WHERE id=${cohort.roomId} FOR SHARE NOWAIT`;
    return true;
  }

  if (source.kind === "tutoring_group") {
    const parents = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "PairingGroup" WHERE id=${source.sourceId} FOR UPDATE NOWAIT`;
    if (!parents.length) return false;
  }
  const pairings = await tx.pairing.findMany({
    where:
      source.kind === "tutoring_group"
        ? { groupId: source.sourceId }
        : { id: source.sourceId, groupId: null },
    select: {
      id: true,
      tutorId: true,
      termId: true,
      roomId: true,
      tutees: { select: { tuteeId: true } },
    },
    orderBy: { id: "asc" },
  });
  if (!pairings.length) return false;
  await lockPlanningSources(
    tx,
    pairings.map((pairing) => ({
      tutorId: pairing.tutorId,
      tuteeIds: pairing.tutees.map((person) => person.tuteeId),
      pairingIds: [pairing.id],
    })),
  );
  // A deletion can win between discovery and the ordered source locks. Absence
  // is not a lock: do not let a later same-ID replacement authorize this attempt.
  const pairingIds = pairings.map((pairing) => pairing.id);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Pairing" WHERE id=ANY(${pairingIds}::text[]) ORDER BY id FOR UPDATE NOWAIT`;
  if (locked.length !== pairingIds.length) return false;
  const termIds = [
    ...new Set(pairings.map((pairing) => pairing.termId)),
  ].sort();
  const roomIds = [
    ...new Set(
      pairings.flatMap((pairing) => (pairing.roomId ? [pairing.roomId] : [])),
    ),
  ].sort();
  await tx.$queryRaw`SELECT id FROM "Term" WHERE id=ANY(${termIds}::text[]) ORDER BY id FOR SHARE NOWAIT`;
  await tx.$queryRaw`SELECT id FROM "Room" WHERE id=ANY(${roomIds}::text[]) ORDER BY id FOR SHARE NOWAIT`;
  return true;
}

/** Prisma adapters wrap PostgreSQL lock errors at different depths. Only known
 * pre-transport contention can defer a receipt; all other database errors escape.
 */
export function isReminderSourceBusy(error: unknown): boolean {
  if (error instanceof ReminderSourceBusy) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: unknown;
    originalCode?: unknown;
    cause?: unknown;
    meta?: unknown;
    driverAdapterError?: unknown;
  };
  return (
    ["55P03", "40P01", "40001", "P2034"].includes(String(value.code)) ||
    ["55P03", "40P01", "40001"].includes(String(value.originalCode)) ||
    isReminderSourceBusy(value.cause) ||
    isReminderSourceBusy(value.meta) ||
    isReminderSourceBusy(value.driverAdapterError)
  );
}
