import { managementNotificationRecipients } from "~/server/notifications/create";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../generated/prisma";
import { shCount } from "~/lib/service-hours";
import { reconsiderSessionFlag } from "~/server/crew/flags";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { importedRecordKey } from "~/server/imported-records";

export { lockAttendanceSchedule } from "~/server/attendance-schedule-lock";

/** Called while holding the exclusive attendance barrier, in the same transaction as the
 * catalogue and pairing updates. A merged block is indivisible even if legacy siblings have
 * different catalogue links. Only its primary row receives service credit. */
export async function propagateSlotAttendance(
  tx: TransactionDb,
  slotId: string,
  window: { startMin: number; endMin: number },
  actor: { id: string; name?: string | null },
) {
  const linked = await tx.session.findMany({
    where: { timeSlotId: slotId },
    select: { id: true, mergeGroupId: true },
  });
  if (!linked.length) return 0;
  const blockIds = [
    ...new Set(linked.map((session) => session.mergeGroupId ?? session.id)),
  ].sort();
  const sessions = await tx.session.findMany({
    where: {
      OR: [{ id: { in: blockIds } }, { mergeGroupId: { in: blockIds } }],
    },
    select: {
      id: true,
      tutorId: true,
      date: true,
      mergeGroupId: true,
      timeSlotId: true,
      startMin: true,
      endMin: true,
      durationMin: true,
      shFactor: true,
      shCount: true,
      online: true,
      actualRoomId: true,
    },
    orderBy: { id: "asc" },
  });
  // Import uses this same fence for attendance, flags and their amendments.
  // Hold it before origin/roster reads, including blocks that may stay frozen.
  for (const id of sessions.map((session) => session.id).sort())
    await lockEntity(tx, `session-flag:${id}`);
  const attendance = await tx.sessionTutee.findMany({
    where: { sessionId: { in: sessions.map((session) => session.id) } },
    select: { sessionId: true, tuteeId: true },
  });
  const attendanceKeys = new Map(
    attendance.map((row) => [
      importedRecordKey(row, ["sessionId", "tuteeId"]),
      row.sessionId,
    ]),
  );
  const imported = await tx.importedRecordProvenance.findMany({
    where: {
      OR: [
        {
          entity: "Session",
          recordId: { in: sessions.map((session) => session.id) },
        },
        {
          entity: "SessionTutee",
          recordId: { in: [...attendanceKeys.keys()] },
        },
      ],
    },
    select: { entity: true, recordId: true },
  });
  const importedIds = new Set(
    imported.map((row) =>
      row.entity === "Session"
        ? row.recordId
        : attendanceKeys.get(row.recordId),
    ),
  );
  // A catalogue edit changes native attendance under its own policy. Imported
  // blocks keep their original clock/credit, including any mixed-origin sibling.
  const frozenBlocks = new Set(
    sessions
      .filter((session) => importedIds.has(session.id))
      .map((session) => session.mergeGroupId ?? session.id),
  );
  const nativeSessions = sessions.filter(
    (session) => !frozenBlocks.has(session.mergeGroupId ?? session.id),
  );
  const blocks = blockIds
    .filter((id) => !frozenBlocks.has(id))
    .map((id) => {
      const primary = sessions.find((session) => session.id === id);
      if (!primary)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "An attendance block is missing its primary record. Correct its history before changing this slot.",
        });
      const members = sessions.filter(
        (session) => (session.mergeGroupId ?? session.id) === id,
      );
      if (
        members.some(
          (session) =>
            session.tutorId !== primary.tutorId ||
            session.date.getTime() !== primary.date.getTime(),
        )
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A combined attendance block has inconsistent tutor or date records. Correct it before changing this slot.",
        });
      return { id, primary, members };
    });
  const changed = blocks.filter((block) =>
    block.members.some(
      (session) =>
        session.startMin !== window.startMin ||
        session.endMin !== window.endMin,
    ),
  );
  if (!changed.length) return nativeSessions.length;
  const affectedIds = nativeSessions.map((session) => session.id);
  const days = [
    ...new Map(
      blocks.map(({ primary }) => [
        `${primary.tutorId}:${primary.date.toISOString().slice(0, 10)}`,
        { tutorId: primary.tutorId, date: primary.date },
      ]),
    ).values(),
  ];
  const otherSessions = await tx.session.findMany({
    where: { id: { notIn: affectedIds }, OR: days },
    select: {
      id: true,
      tutorId: true,
      date: true,
      startMin: true,
      endMin: true,
    },
  });
  // Validate the final state, including collisions between two blocks affected by the same
  // slot edit. Internal merged siblings share time legitimately and are compared as one block.
  for (const block of changed) {
    const sameDay = (row: { tutorId: string; date: Date }) =>
      row.tutorId === block.primary.tutorId &&
      row.date.getTime() === block.primary.date.getTime();
    if (
      blocks.some((other) => other.id !== block.id && sameDay(other.primary)) ||
      otherSessions.some(
        (other) =>
          sameDay(other) &&
          other.startMin < window.endMin &&
          other.endMin > window.startMin,
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This slot change would overlap saved attendance for a tutor. Correct the affected blocks before changing the slot.",
      });
  }

  // The source locks also keep the old decision/deduction snapshot stable while
  // recording which native flag evidence is being reconsidered.
  const changedIds = changed.flatMap((block) =>
    block.members.map((session) => session.id),
  );
  const flags = await tx.sessionFlag.findMany({
    where: { sessionId: { in: changedIds } },
  });
  const adjustments = await tx.serviceHourAdjustment.findMany({
    where: { id: { in: flags.map((flag) => `flag:${flag.id}`) } },
  });
  const durationMin = window.endMin - window.startMin;
  await tx.session.updateMany({
    where: { id: { in: changedIds } },
    data: { ...window, durationMin },
  });
  const primaryCredits = new Map<number, string[]>();
  for (const block of changed) {
    const credit = shCount(durationMin, block.primary.shFactor);
    const ids = primaryCredits.get(credit) ?? [];
    ids.push(block.id);
    primaryCredits.set(credit, ids);
  }
  // Bulk writes keep long historical catalogues practical without one update per session.
  for (const [credit, ids] of primaryCredits)
    await tx.session.updateMany({
      where: { id: { in: ids } },
      data: { shCount: credit },
    });
  const siblingIds = changed.flatMap((block) =>
    block.members.filter((row) => row.id !== block.id).map((row) => row.id),
  );
  if (siblingIds.length)
    await tx.session.updateMany({
      where: { id: { in: siblingIds } },
      data: { shFactor: 0, shCount: 0 },
    });
  const flaggedIds = new Set(flags.map((flag) => flag.sessionId));
  for (const block of changed) {
    // Roomless/online records cannot gain discrepancy evidence; legacy flags still need clearing.
    if (
      flaggedIds.has(block.id) ||
      (!block.primary.online && block.primary.actualRoomId)
    )
      await reconsiderSessionFlag(tx, block.id);
    for (const row of block.members)
      if (row.id !== block.id && flaggedIds.has(row.id))
        await reconsiderSessionFlag(tx, row.id);
  }
  await tx.auditLog.create({
    data: {
      userId: actor.id,
      userName: actor.name,
      entity: "TimeSlot",
      entityId: slotId,
      action: "Updated historical attendance through catalogue slot change",
      details: JSON.parse(
        JSON.stringify({
          before: nativeSessions.filter((session) =>
            changedIds.includes(session.id),
          ),
          previousFlags: flags,
          removedFlagAdjustments: adjustments,
          after: {
            ...window,
            durationMin,
            blockIds: changed.map((block) => block.id),
            sessionIds: changedIds,
          },
        }),
      ) as Prisma.InputJsonValue,
    },
  });
  const heads = await managementNotificationRecipients(
    tx,
    "attendance_history_updated",
  );
  if (heads.length)
    await tx.notification.createMany({
      data: heads.map(({ id }) => ({
        userId: id,
        title: "Catalogue change updated historical attendance",
        ...notificationInAppEvent(
          "attendance_history_updated",
          {
            count: changed.length,
          },
          {
            en: `${changed.length} historical teaching block(s) changed from ${notificationList(changed.map(({ primary }) => `${clock(primary.startMin)}–${clock(primary.endMin)}`))} to ${clock(window.startMin)}–${clock(window.endMin)}. Attendance flags and linked deductions were reconsidered.`,
            zh: `${changed.length} 个历史教学时段由 ${notificationList(changed.map(({ primary }) => `${clock(primary.startMin)}–${clock(primary.endMin)}`))} 改为 ${clock(window.startMin)}–${clock(window.endMin)}，考勤标记及关联扣分已重新核算。`,
          },
        ),
        body: `${changed.length} teaching block(s) were updated. Changed attendance flags and linked deductions were reconsidered.`,
        link: "/admin/audit",
      })),
    });
  return nativeSessions.length;
}
import { notificationInAppEvent } from "~/lib/notification-details";
import { notificationList } from "~/lib/notification-facts";
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
