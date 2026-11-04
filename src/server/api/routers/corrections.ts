import {
  attendanceCorrectionInput,
  correctAttendance,
} from "~/server/corrections/attendance";
import { notificationInAppEvent } from "~/lib/notification-details";
import {
  notificationList,
  notificationInstant,
} from "~/lib/notification-facts";
import { managementNotificationRecipients } from "~/server/notifications/create";
import { getProgramTimeZone } from "~/server/program/time-zone";
import { programDateKey } from "~/lib/program-time";
import { notifyUsers } from "~/server/notifications/create";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "../../../../generated/prisma";
import {
  adminProcedure,
  createTRPCRouter,
  viewerProcedure,
} from "~/server/api/trpc";
import { inTransaction, lockEntity } from "~/server/transactions";
import { reconsiderSessionFlag } from "~/server/crew/flags";
import { lockAttendanceSchedule } from "~/server/attendance-schedule";
import { assertObservedTimes } from "~/server/crew/observation-time";
import {
  lockPatrolCreditOwner,
  reservePatrolEvidence,
} from "~/server/crew/patrol-credit";

const reason = z.string().trim().min(1, "Explain the correction.").max(1000);
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const correctionsRouter = createTRPCRouter({
  attendance: viewerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.session.findUniqueOrThrow({
        where: { id: input.id },
      });
      const primaryId = row.mergeGroupId ?? row.id;
      return ctx.db.session.findMany({
        where: { OR: [{ id: primaryId }, { mergeGroupId: primaryId }] },
        include: {
          tutees: { include: { tutee: { select: { englishName: true } } } },
          pairing: { select: { subject: true } },
        },
        orderBy: { id: "asc" },
      });
    }),

  correctAttendance: adminProcedure
    .input(attendanceCorrectionInput)
    .mutation(({ ctx, input }) =>
      correctAttendance(ctx.db, input, ctx.session.user),
    ),

  patrols: viewerProcedure
    .input(z.object({ cursor: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.db.patrol.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          crewUser: { select: { name: true } },
          observations: {
            include: { room: { select: { name: true } } },
            orderBy: { observedAt: "asc" },
          },
        },
      }),
    ),
  correctPatrol: adminProcedure
    .input(
      z.object({
        id: z.string(),
        expectedUpdatedAt: z.coerce.date(),
        reason,
        note: z.string().max(500).nullable(),
        observations: z
          .array(
            z.object({
              id: z.string(),
              headcount: z.enum(["ZERO", "ONE", "TWO", "THREE", "FOUR_PLUS"]),
              observedAt: z.coerce.date(),
              roomId: z.string(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockAttendanceSchedule(tx);
        const author = await tx.patrol.findUniqueOrThrow({
          where: { id: input.id },
          select: { crewUserId: true },
        });
        await lockPatrolCreditOwner(tx, author.crewUserId, true);
        await lockEntity(tx, `patrol:${input.id}`);
        assertObservedTimes(input.observations);
        const before = await tx.patrol.findUniqueOrThrow({
          where: { id: input.id },
          include: {
            observations: { include: { room: { select: { name: true } } } },
          },
        });
        if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
          throw new TRPCError({
            code: "CONFLICT",
            message: "Patrol changed. Reload before correcting it.",
          });
        if (
          input.observations.length !== before.observations.length ||
          new Set(input.observations.map((o) => o.id)).size !==
            before.observations.length ||
          input.observations.some(
            (o) => !before.observations.some((b) => b.id === o.id),
          )
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Include each observation exactly once.",
          });
        await tx.patrol.update({
          where: { id: input.id },
          data: { note: input.note, updatedAt: new Date() },
        });
        for (const { id, ...data } of input.observations)
          await tx.patrolObservation.update({ where: { id }, data });
        if (before.hours > 0)
          await reservePatrolEvidence(tx, before, input.observations, true);
        // Query both old and new evidence windows so moved observations clear old discrepancies.
        const evidence = [...before.observations, ...input.observations];
        const timeZone = await getProgramTimeZone(tx);
        const sessions = await tx.session.findMany({
          where: {
            OR: evidence.map((o) => ({
              actualRoomId: o.roomId,
              date: new Date(
                `${programDateKey(o.observedAt, timeZone)}T00:00:00Z`,
              ),
            })),
          },
          include: { flags: true },
        });
        const changedEvidence = input.observations.some((o) => {
          const old = before.observations.find((b) => b.id === o.id)!;
          return (
            old.headcount !== o.headcount ||
            old.roomId !== o.roomId ||
            old.observedAt.getTime() !== o.observedAt.getTime()
          );
        });
        if (changedEvidence)
          for (const s of sessions) await reconsiderSessionFlag(tx, s.id);
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            userName: ctx.session.user.name,
            entity: "Patrol",
            entityId: input.id,
            action: `Corrected patrol: ${input.reason}`,
            details: json({
              before,
              flags: sessions.flatMap((s) => s.flags),
              after: input,
            }),
          },
        });
        const heads = await managementNotificationRecipients(
          tx,
          "record_corrected",
        );
        const correctedRooms = await tx.room.findMany({
          where: { id: { in: input.observations.map((row) => row.roomId) } },
          select: { id: true, name: true },
        });
        const counts: Record<string, string> = {
          ZERO: "0",
          ONE: "1",
          TWO: "2",
          THREE: "3",
          FOUR_PLUS: "4+",
        };
        const observationTime = (date: Date) =>
          notificationInstant(date, timeZone, "en");
        const observationChanges = notificationList(
          input.observations.flatMap((row) => {
            const old = before.observations.find(
              (previous) => previous.id === row.id,
            )!;
            const changes = [
              ...(old.roomId !== row.roomId
                ? [
                    `${old.room.name} → ${correctedRooms.find((room) => room.id === row.roomId)?.name ?? "—"}`,
                  ]
                : []),
              ...(old.headcount !== row.headcount
                ? [`${counts[old.headcount]} → ${counts[row.headcount]}`]
                : []),
              ...(old.observedAt.getTime() !== row.observedAt.getTime()
                ? [
                    `${observationTime(old.observedAt)} → ${observationTime(row.observedAt)}`,
                  ]
                : []),
            ];
            return changes.length
              ? [`${old.room.name}: ${changes.join("; ")}`]
              : [];
          }),
        );
        await notifyUsers(
          heads.map((h) => h.id),
          {
            ...notificationInAppEvent("record_corrected", undefined, {
              en: `Management corrected the patrol recorded on ${programDateKey(before.createdAt, timeZone)} (${timeZone}). Room / headcount / observation-time changes: ${observationChanges || "No observation changes; patrol note corrected"}.`,
              zh: `管理人员已更正 ${programDateKey(before.createdAt, timeZone)}（${timeZone}）的巡查记录。教室／人数／观察时间变更：${observationChanges || "观察记录未变更，巡查备注已更正"}。`,
            }),
            title: "Management corrected a record",
            body: `${ctx.session.user.name ?? "Management"}: ${input.reason}`,
            link: "/admin/audit",
          },
          tx,
        );
        return { ok: true };
      }),
    ),
});
