import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../generated/prisma";
import { shCount } from "~/lib/service-hours";
import { reconsiderSessionFlag } from "~/server/crew/flags";
import { lockEntity, type TransactionDb } from "~/server/transactions";

/** Normal submissions/corrections share this barrier and retain their per-tutor/day locks.
 * Catalogue propagation takes it exclusively before discovering affected historical blocks,
 * so neither newly inserted sessions nor corrections can escape the propagation snapshot. */
export async function lockAttendanceSchedule(
  tx: TransactionDb,
  exclusive = false,
) {
  const key = "attendance:catalogue-propagation";
  if (exclusive)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  else
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
}

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
  const blocks = blockIds.map((id) => {
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
  if (!changed.length) return sessions.length;
  const affectedIds = sessions.map((session) => session.id);
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

  // Flag reviews can run independently of timetable writes. Hold their locks while capturing
  // the old decision/deduction so the audit evidence matches exactly what is invalidated.
  for (const block of changed) {
    for (const session of block.members)
      await lockEntity(tx, `session-flag:${session.id}`);
  }
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
          before: sessions.filter((session) => changedIds.includes(session.id)),
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
  const heads = await tx.user.findMany({
    where: { role: "HEAD" },
    select: { id: true },
  });
  if (heads.length)
    await tx.notification.createMany({
      data: heads.map(({ id }) => ({
        userId: id,
        title: "Catalogue change updated historical attendance",
        body: `${changed.length} teaching block(s) were updated. Changed attendance flags and linked deductions were reconsidered.`,
        link: "/admin/audit",
      })),
    });
  return sessions.length;
}
