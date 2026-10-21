import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { pairingEntries } from "~/lib/pairing-groups";
import { pairingGroupEligibility } from "~/lib/pairing-group-eligibility";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { lockPlannedRoomSchedule } from "./room-bookings";
import { allocateRoom, persistRoomUnit, roomUnitInclude, roomUnitSchedule, notifyRoomShortage } from "./room-allocation";

export const pairingGroupsInput = z.object({
  snapshot: z.string().length(64),
  groups: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        pairingIds: z.array(z.string().min(1)).min(2).max(6),
        slotId: z.string().min(1).nullable(),
        // An explicit keep-current choice preserves a confirmed custom interval.
        // Null without this flag explicitly returns the group to Awaiting schedule.
        retainSchedule: z.boolean().optional(),
      }),
    )
    .max(100),
});

export async function readPairingGroups(db: DomainDb, tutorId: string) {
  const term = await db.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const pairings = term
    ? await db.pairing.findMany({
        where: { tutorId, termId: term.id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          subject: true,
          groupId: true,
          group: { select: { primaryPairingId: true } },
          scheduleConfirmed: true,
          dayOfWeek: true,
          startMin: true,
          endMin: true,
          timeSlotId: true,
          roomId: true,
          roomMode: true,
          roomNeedsAssignment: true,
          roomVersion: true,
          room: { select: { id: true, name: true } },
          tutees: {
            where: { tutee: { status: { not: "INACTIVE" } } },
            orderBy: { tuteeId: "asc" },
            select: {
              tuteeId: true,
              tutee: {
                select: {
                  englishName: true,
                  user: { select: { username: true } },
                },
              },
            },
          },
        },
      })
    : [];
  const slots = await db.timeSlot.findMany({
    where: { active: true },
    orderBy: { id: "asc" },
    select: {
      id: true,
      label: true,
      dayOfWeek: true,
      startMin: true,
      endMin: true,
    },
  });
  const snapshot = createHash("sha256")
    .update(JSON.stringify({ term, pairings, slots }))
    .digest("hex");
  return {
    termId: term?.id ?? null,
    snapshot,
    groups: pairingEntries(pairings)
      .filter((p) => p.groupId)
      .map((p) => ({
        id: p.groupId!,
        pairingIds: p.pairings.map((x) => x.id),
        slotId: p.groupStatus === "scheduled" ? p.primary.timeSlotId : null,
        scheduleConfirmed: p.groupStatus === "scheduled",
        dayOfWeek: p.primary.dayOfWeek,
        startMin: p.primary.startMin,
        endMin: p.primary.endMin,
        retainSchedule: p.groupStatus === "scheduled" &&
          !slots.some((slot) => slot.id === p.primary.timeSlotId),
        groupStatus: p.groupStatus,
        groupEligibility: p.groupEligibility,
      })),
    pairings,
    slots,
  };
}

/** Share lock order with self-service schedules and management room writers. The
 * fingerprint fences group, roster, period and schedule changes made after preview. */
export async function savePairingGroups(
  db: DomainDb,
  tutorId: string,
  input: z.infer<typeof pairingGroupsInput>,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id = ${tutorId} FOR UPDATE`;
    const tutor = await tx.tutor.findUnique({
      where: { id: tutorId },
      select: { status: true },
    });
    if (tutor?.status !== "ACTIVE")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "An active tutor account is required.",
      });
    await lockPlannedRoomSchedule(tx);
    await tx.$queryRaw`SELECT p.id FROM "Pairing" p JOIN "Term" t ON t.id=p."termId" WHERE p."tutorId"=${tutorId} AND t.active ORDER BY p.id FOR UPDATE OF p`;
    const before = await readPairingGroups(tx, tutorId);
    if (!before.termId || before.snapshot !== input.snapshot)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Pairings or schedules changed. Reload before saving this group draft.",
      });
    const pairings = new Map(before.pairings.map((p) => [p.id, p]));
    // Display projections omit inactive students; allocation evidence keeps the full roster.
    const fullPairings = new Map((await tx.pairing.findMany({
      where: { tutorId, termId: before.termId }, include: roomUnitInclude,
    })).map(pairing => [pairing.id, pairing]));
    const stored = await tx.pairingGroup.findMany({
      where: { tutorId, termId: before.termId },
    });
    const storedIds = new Set(stored.map((g) => g.id));
    const seen = new Set<string>();
    const groupIds = new Set<string>();
    for (const group of input.groups) {
      if (group.id && (!storedIds.has(group.id) || groupIds.has(group.id)))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unknown or duplicate pairing group.",
        });
      if (group.id) groupIds.add(group.id);
      for (const id of group.pairingIds) {
        if (seen.has(id) || !pairings.get(id)?.tutees.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Choose each of your current, populated assignments at most once.",
          });
        seen.add(id);
      }
      const members = group.pairingIds.map((id) => pairings.get(id)!);
      const eligibility = pairingGroupEligibility(members);
      if (!eligibility.eligible) {
        const missing = eligibility.missing.map(({ tuteeId, subjects }) => {
          const student = members.flatMap((p) => p.tutees).find((p) => p.tuteeId === tuteeId);
          const name = [student?.tutee.englishName, student?.tutee.user?.username]
            .find((label) => typeof label === "string" && label.trim().length > 0) ?? tuteeId;
          return `${name}: ${subjects.join(", ")}`;
        }).join("; ");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Every student must have every selected subject. Missing assignments: ${missing}`,
        });
      }
      if (group.slotId !== null && !before.slots.some((s) => s.id === group.slotId))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose an available catalog time slot.",
        });
      if (group.retainSchedule) {
        const current = before.groups.find((g) => g.id === group.id);
        if (group.slotId !== null || !current?.retainSchedule ||
          current.pairingIds.length !== group.pairingIds.length ||
          !current.pairingIds.every((id) => group.pairingIds.includes(id)))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Keep current time requires the same complete, scheduled group. Choose a time or Awaiting schedule.",
          });
      }
    }

    // Temporarily release affected planned bookings inside this atomic transaction.
    // Leaving a group returns to Awaiting schedule; completed Sessions are never touched.
    const affected = before.pairings
      .filter((p) => p.groupId !== null || seen.has(p.id))
      .map((p) => p.id);
    if (affected.length)
      await tx.pairing.updateMany({
        where: { id: { in: affected } },
        data: {
          groupId: null, scheduleConfirmed: false, timeSlotId: null,
          roomNeedsAssignment: false, roomShortageKey: null, roomVersion: { increment: 1 },
        },
      });
    await tx.pairingGroup.deleteMany({
      where: { tutorId, termId: before.termId, id: { notIn: [...groupIds] } },
    });
    for (const group of input.groups) {
      const primary = fullPairings.get(group.pairingIds[0]!)!;
      const slot = before.slots.find((s) => s.id === group.slotId);
      // Placeholder clocks remain storage-only for unscheduled groups. A saved
      // custom interval is retained only through the explicit reviewed choice.
      const schedule = {
        dayOfWeek: slot?.dayOfWeek ?? primary.dayOfWeek,
        startMin: slot?.startMin ?? primary.startMin,
        endMin: slot?.endMin ?? primary.endMin,
        timeSlotId: group.retainSchedule ? primary.timeSlotId : slot?.id ?? null,
        scheduleConfirmed: !!slot || group.retainSchedule === true,
      };
      const saved = group.id
        ? await tx.pairingGroup.update({
            where: { id: group.id },
            data: { primaryPairingId: primary.id },
          })
        : await tx.pairingGroup.create({
            data: {
              tutorId,
              termId: before.termId,
              primaryPairingId: primary.id,
            },
          });
      const members = group.pairingIds.map(id => ({ ...fullPairings.get(id)!, groupId: saved.id }));
      const allocation = await allocateRoom(tx,
        { ...roomUnitSchedule(members), ...schedule }, {}, primary);
      await persistRoomUnit(tx, members, allocation, schedule);
      await notifyRoomShortage(tx, primary.id, allocation, primary.roomShortageKey);
    }
    return readPairingGroups(tx, tutorId);
  });
}

/** Legacy member schedule controls update their complete current group as well. */
export async function groupMembersForSchedule(
  tx: TransactionDb,
  pairing: {
    id: string;
    groupId: string | null;
    tutorId: string;
    termId: string;
  },
) {
  if (!pairing.groupId) return [{ id: pairing.id, roomId: null }];
  const members = await tx.pairing.findMany({
        where: {
          groupId: pairing.groupId,
          tutorId: pairing.tutorId,
          termId: pairing.termId,
        },
        select: {
          id: true, roomId: true, subject: true,
          tutees: {
            where: { tutee: { status: { not: "INACTIVE" } } },
            select: { tuteeId: true },
          },
        },
      });
  if (!pairingGroupEligibility(members).eligible)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This group needs repair. Every student must have every selected subject before scheduling.",
    });
  return members;
}
