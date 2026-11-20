import type { TransactionDb } from "~/server/transactions";
import { lockEntity } from "~/server/transactions";
import { DEDUCTION, monthKey } from "~/lib/service-hours";
import { TRPCError } from "@trpc/server";

/** Rebuild only system-owned meeting deductions. Counting across Q1/Q2 or Q3/Q4 makes
 * corrections to early meetings move the threshold consistently, even across refreshes. */
export async function reconcileMeetingHours(
  tx: TransactionDb,
  tutorId: string,
) {
  await lockEntity(tx, `meeting-hours:${tutorId}`);
  const [rows, adjustments] = await Promise.all([
    tx.meetingAttendance.findMany({
      where: { tutorId },
      include: { meeting: { include: { term: true } } },
      orderBy: [{ meeting: { date: "asc" } }, { id: "asc" }],
    }),
    tx.serviceHourAdjustment.findMany({
      where: { tutorId, id: { startsWith: "mtgabs_" } },
      select: { id: true },
    }),
  ]);
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
        {
          entity: "ServiceHourAdjustment",
          recordId: {
            in: [
              ...new Set([
                ...adjustments.map((row) => row.id),
                ...rows.map((row) => `mtgabs_${row.meetingId}_${tutorId}`),
              ]),
            ],
          },
        },
      ],
    },
    select: { entity: true, recordId: true },
  });
  const imported = new Set(
    provenance.map((row) => `${row.entity}:${row.recordId}`),
  );
  const frozenAdjustments = provenance
    .filter((row) => row.entity === "ServiceHourAdjustment")
    .map((row) => row.recordId);
  const counts = new Map<string, number>();
  const deductions: Parameters<typeof tx.serviceHourAdjustment.create>[0][] =
    [];
  for (const row of rows) {
    // An imported absence is evidence under its original policy. A current
    // attendance edit must neither consume its allowance nor recreate its debt.
    if (
      imported.has(`MeetingAttendance:${row.id}`) ||
      imported.has(`TutorMeeting:${row.meetingId}`)
    )
      continue;
    const term = row.meeting.term;
    if (!term || row.status !== "UNEXCUSED_ABSENT") continue;
    const key = `${term.schoolYear}:${["Q1", "Q2"].includes(term.quarter) ? 1 : 2}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count <= 3) continue;
    const id = `mtgabs_${row.meetingId}_${tutorId}`;
    if (imported.has(`ServiceHourAdjustment:${id}`))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "A meeting deduction identifier belongs to imported history. Review the archive before changing current meeting credit.",
      });
    deductions.push({
      data: {
        id,
        tutorId,
        month: monthKey(row.meeting.date),
        schoolYear: term.schoolYear,
        quarter: term.quarter,
        type: "PUNISHMENT",
        amount: DEDUCTION.MISSED_MEETING_UNEXCUSED,
        reason:
          "Unexcused meeting absence beyond the semester allowance of three",
      },
    });
  }
  await tx.serviceHourAdjustment.deleteMany({
    where: {
      tutorId,
      id: { startsWith: "mtgabs_", notIn: frozenAdjustments },
    },
  });
  for (const deduction of deductions)
    await tx.serviceHourAdjustment.create(deduction);
}
