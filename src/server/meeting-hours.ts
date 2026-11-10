import { TRPCError } from "@trpc/server";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import {
  calculateMeetingDeductions,
  diffMeetingDeductions,
  type MeetingDeduction,
} from "./meeting-hours-calculation";

export type MeetingHoursSnapshot = {
  tutorId: string;
  deductions: readonly MeetingDeduction[];
};

/** Capture before the source mutation, while the caller owns its parent fence
 * and the tutor-hours fence. Stored amounts are deliberately never normalized. */
export async function captureMeetingHours(
  tx: TransactionDb,
  tutorId: string,
): Promise<MeetingHoursSnapshot> {
  await lockEntity(tx, `meeting-hours:${tutorId}`);
  const rows = await tx.meetingAttendance.findMany({
    where: { tutorId },
    include: { meeting: { include: { term: true } } },
    orderBy: [{ meeting: { date: "asc" } }, { id: "asc" }],
  });
  const provenance = await tx.importedRecordProvenance.findMany({
    where: {
      OR: [
        {
          entity: "TutorMeeting",
          recordId: { in: rows.map((row) => row.meetingId) },
        },
        {
          entity: "MeetingAttendance",
          recordId: { in: rows.map((row) => row.id) },
        },
      ],
    },
    select: { entity: true, recordId: true },
  });
  const imported = new Set(
    provenance.map((row) => `${row.entity}:${row.recordId}`),
  );
  return {
    tutorId,
    deductions: calculateMeetingDeductions(
      tutorId,
      rows.filter(
        (row) =>
          !imported.has(`TutorMeeting:${row.meetingId}`) &&
          !imported.has(`MeetingAttendance:${row.id}`),
      ),
    ),
  };
}

/** Apply only the logical change caused by this mutation. Unchanged deductions,
 * including missing/noncanonical legacy targets, authorize no adjustment write.
 * This is conservation of unrelated effects, not retrospective origin proof. */
export async function reconcileMeetingHours(
  tx: TransactionDb,
  tutorId: string,
  before: MeetingHoursSnapshot,
) {
  if (before.tutorId !== tutorId)
    throw new Error("Meeting-hours snapshot belongs to another tutor.");
  const after = await captureMeetingHours(tx, tutorId);
  const delta = diffMeetingDeductions(before.deductions, after.deductions);
  const removed = [...delta.removed, ...delta.changed.map((row) => row.before)];
  const added = [...delta.added, ...delta.changed.map((row) => row.after)];
  const affectedIds = [...new Set([...removed, ...added].map((row) => row.id))];
  if (!affectedIds.length) return;

  // Markers reserve logical keys even when their source row is absent. Check
  // only actual deltas: a neutral save must not disturb an unchanged reservation.
  const reserved = await tx.importedRecordProvenance.findFirst({
    where: { entity: "ServiceHourAdjustment", recordId: { in: affectedIds } },
    select: { recordId: true },
  });
  if (reserved)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A meeting deduction identifier belongs to imported history. Review the archive before changing current meeting credit.",
    });
  if (removed.length)
    await tx.serviceHourAdjustment.deleteMany({
      where: { tutorId, id: { in: removed.map((row) => row.id) } },
    });
  // Use INSERT, never upsert: an added logical key cannot overwrite an unrelated
  // existing row. A collision rolls back the caller's source mutation as well.
  for (const data of added) await tx.serviceHourAdjustment.create({ data });
}
