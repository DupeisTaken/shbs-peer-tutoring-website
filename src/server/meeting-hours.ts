import type { TransactionDb } from "~/server/transactions";
import { lockEntity } from "~/server/transactions";
import { monthKey } from "~/lib/service-hours";

/** Rebuild only system-owned meeting deductions. Counting across Q1/Q2 or Q3/Q4 makes
 * corrections to early meetings move the threshold consistently, even across refreshes. */
export async function reconcileMeetingHours(
  tx: TransactionDb,
  tutorId: string,
) {
  await lockEntity(tx, `meeting-hours:${tutorId}`);
  const rows = await tx.meetingAttendance.findMany({
    where: { tutorId },
    include: { meeting: { include: { term: true } } },
    orderBy: [{ meeting: { date: "asc" } }, { id: "asc" }],
  });
  await tx.serviceHourAdjustment.deleteMany({
    where: { tutorId, id: { startsWith: "mtgabs_" } },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const term = row.meeting.term;
    if (!term || row.status !== "UNEXCUSED_ABSENT") continue;
    const key = `${term.schoolYear}:${["Q1", "Q2"].includes(term.quarter) ? 1 : 2}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count <= 3) continue;
    await tx.serviceHourAdjustment.create({
      data: {
        id: `mtgabs_${row.meetingId}_${tutorId}`,
        tutorId,
        month: monthKey(row.meeting.date),
        schoolYear: term.schoolYear,
        quarter: term.quarter,
        type: "PUNISHMENT",
        amount: 0.25,
        reason:
          "Unexcused meeting absence beyond the semester allowance of three",
      },
    });
  }
}
