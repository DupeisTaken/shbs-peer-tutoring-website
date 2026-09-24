import { z } from "zod";
import { lockAttendanceSchedule } from "~/server/attendance-schedule";
import { lockPlannedRoomSchedule } from "~/server/room-bookings";
import { lockEntity, type TransactionDb } from "~/server/transactions";

export function isAttendanceApproval(operation: string) {
  return [
    "admin.updateTimeSlot",
    "corrections.correctAttendance",
    "corrections.correctPatrol",
  ].includes(operation);
}

/** These approvals need READ COMMITTED: PostgreSQL establishes a serializable snapshot
 * before an advisory-lock wait, which would hide attendance committed during that wait.
 * Acquire the barrier first, then retain review evidence with the same domain locks as
 * ordinary writers. All other approval operations keep their serializable transaction. */
export async function lockAttendanceApproval(
  tx: TransactionDb,
  operation: string,
  userIds: string[],
) {
  await lockAttendanceSchedule(tx, operation === "admin.updateTimeSlot");
  await lockEntity(tx, "program:period");
  if (operation === "admin.updateTimeSlot") await lockPlannedRoomSchedule(tx);
  // FOR SHARE protects role/suspension checks too; KEY SHARE would permit those updates.
  for (const id of [...new Set(userIds)].sort())
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR SHARE`;
}

/** Hold the affected record's writer lock before computing the immutable proposal's
 * fingerprint. The replayed handler reacquires these transaction-scoped locks safely. */
export async function lockAttendanceApprovalTarget(
  tx: TransactionDb,
  operation: string,
  value: unknown,
) {
  const { id } = z.object({ id: z.string() }).parse(value);
  if (operation === "admin.updateTimeSlot") {
    await tx.$queryRaw`SELECT id FROM "TimeSlot" WHERE id = ${id} FOR UPDATE`;
  } else if (operation === "corrections.correctAttendance") {
    const session = await tx.session.findUnique({
      where: { id },
      select: { id: true, mergeGroupId: true },
    });
    await lockEntity(
      tx,
      `attendance-correction:${session?.mergeGroupId ?? id}`,
    );
  } else {
    await lockEntity(tx, `patrol:${id}`);
  }
}
