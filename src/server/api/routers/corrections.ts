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
import { computeSessionHours } from "~/lib/service-hours";
import {
  inTransaction,
  lockEntity,
  type TransactionDb,
} from "~/server/transactions";
import { syncSessionFlag } from "~/server/crew/flags";
import { syncPunishmentRemoval } from "~/server/discipline/removal";
import { getFeatures } from "~/server/program/features";

const reason = z.string().trim().min(1, "Explain the correction.").max(1000);
const rating = z.number().int().min(1).max(5).nullable();
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Corrected evidence invalidates an earlier flag decision and its linked deduction. The
 * caller saves the previous flag in the audit snapshot before invoking this helper. */
async function reconsiderFlag(tx: TransactionDb, sessionId: string) {
  await lockEntity(tx, `session-flag:${sessionId}`);
  const flag = await tx.sessionFlag.findUnique({ where: { sessionId } });
  if (flag) {
    await tx.serviceHourAdjustment.deleteMany({
      where: { id: `flag:${flag.id}` },
    });
    await tx.sessionFlag.update({
      where: { id: flag.id },
      data: {
        state: "PENDING",
        resolvedAt: null,
        resolvedById: null,
        resolvedByName: null,
        decisionNote: null,
      },
    });
  }
  await syncSessionFlag(tx, sessionId);
}

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
    .input(
      z
        .object({
          id: z.string(),
          expectedUpdatedAt: z.coerce.date(),
          reason,
          date: z.coerce.date(),
          startMin: z.number().int().min(0).max(1439),
          endMin: z.number().int().min(1).max(1440),
          tutorStatus: z.enum([
            "PRESENT",
            "RESCHEDULED",
            "EXTRA",
            "TUTOR_ABSENT",
          ]),
          tutorAbsentReason: z.string().trim().max(1000).nullable(),
          comments: z.string().max(5000).nullable(),
          online: z.boolean(),
          actualRoomId: z.string().nullable(),
          ratingPreparedness: rating,
          ratingParticipation: rating,
          ratingUnderstanding: rating,
          ratingBehavior: rating,
          ratingProgress: rating,
          tutees: z
            .array(
              z.object({
                tuteeId: z.string(),
                status: z.enum([
                  "PRESENT",
                  "EXCUSED_ABSENT",
                  "UNEXCUSED_ABSENT",
                ]),
                absenceReason: z.string().trim().max(1000).nullable(),
              }),
            )
            .min(1),
        })
        .superRefine((v, c) => {
          const fail = (message: string) =>
            c.addIssue({ code: z.ZodIssueCode.custom, message });
          if (v.endMin <= v.startMin)
            fail("End time must be after start time.");
          if (v.tutorStatus === "TUTOR_ABSENT" && !v.tutorAbsentReason)
            fail("Give a tutor absence reason.");
          if (
            v.tutees.some(
              (t) => t.status === "EXCUSED_ABSENT" && !t.absenceReason,
            )
          )
            fail("Give each excused absence a reason.");
          if (
            v.tutorStatus !== "TUTOR_ABSENT" &&
            v.tutees.some((t) => t.status === "PRESENT") &&
            [
              v.ratingPreparedness,
              v.ratingParticipation,
              v.ratingUnderstanding,
              v.ratingBehavior,
              v.ratingProgress,
            ].some((x) => x === null)
          )
            fail("Complete all five ratings for a held session.");
        }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        const requested = await tx.session.findUniqueOrThrow({
          where: { id: input.id },
        });
        const primaryId = requested.mergeGroupId ?? requested.id;
        await lockEntity(tx, `attendance-correction:${primaryId}`);
        const before = await tx.session.findMany({
          where: { OR: [{ id: primaryId }, { mergeGroupId: primaryId }] },
          include: { tutees: true, cards: true, flags: true },
        });
        const primary = before.find((s) => s.id === primaryId)!;
        if (primary.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
          throw new TRPCError({
            code: "CONFLICT",
            message: "Attendance changed. Reload before correcting it.",
          });
        const roster = new Set(
          before.flatMap((s) => s.tutees.map((t) => t.tuteeId)),
        );
        if (
          input.tutees.length !== roster.size ||
          new Set(input.tutees.map((t) => t.tuteeId)).size !== roster.size ||
          input.tutees.some((t) => !roster.has(t.tuteeId))
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Include each recorded student exactly once.",
          });
        const {
          id: _id,
          expectedUpdatedAt: _version,
          reason: explanation,
          tutees,
          ...raw
        } = input;
        void _id;
        void _version;
        const computed = computeSessionHours({
          ...input,
          tuteeStatuses: tutees.map((t) => t.status),
        });
        const evidenceChanged =
          primary.date.getTime() !== input.date.getTime() ||
          primary.startMin !== input.startMin ||
          primary.endMin !== input.endMin ||
          primary.online !== input.online ||
          primary.actualRoomId !== (input.online ? null : input.actualRoomId) ||
          tutees.some((t) =>
            before.some((s) =>
              s.tutees.some(
                (old) => old.tuteeId === t.tuteeId && old.status !== t.status,
              ),
            ),
          );
        for (const s of before) {
          await tx.session.update({
            where: { id: s.id },
            data: {
              ...raw,
              actualRoomId: raw.online ? null : raw.actualRoomId,
              tutorAbsentReason:
                raw.tutorStatus === "TUTOR_ABSENT"
                  ? raw.tutorAbsentReason
                  : null,
              ...computed,
              shFactor: s.id === primaryId ? computed.shFactor : 0,
              shCount: s.id === primaryId ? computed.shCount : 0,
            },
          });
          for (const tt of s.tutees) {
            const value = tutees.find((t) => t.tuteeId === tt.tuteeId)!;
            await tx.sessionTutee.update({
              where: {
                sessionId_tuteeId: { sessionId: s.id, tuteeId: tt.tuteeId },
              },
              data: {
                status: value.status,
                absenceReason:
                  value.status === "EXCUSED_ABSENT"
                    ? value.absenceReason
                    : null,
              },
            });
          }
        }
        const features = await getFeatures(tx);
        for (const tt of [...tutees].sort((a, b) =>
          a.tuteeId.localeCompare(b.tuteeId),
        )) {
          const old = before
            .flatMap((s) => s.cards)
            .filter((c) => c.tuteeId === tt.tuteeId && c.source === "AUTO");
          // Keep issued cards as historical evidence, but withdraw an absence which was corrected.
          if (tt.status !== "UNEXCUSED_ABSENT")
            await tx.disciplinaryCard.updateMany({
              where: { id: { in: old.map((c) => c.id) } },
              data: {
                reviewStatus: "INVALID",
                reviewNote: `Attendance correction: ${explanation}`,
              },
            });
          else if (
            features.DISCIPLINE &&
            !before.some((s) =>
              s.tutees.some(
                (old) =>
                  old.tuteeId === tt.tuteeId &&
                  old.status === "UNEXCUSED_ABSENT",
              ),
            ) &&
            !old.some((c) => c.reviewStatus === "VALID")
          )
            await tx.disciplinaryCard.create({
              data: {
                tuteeId: tt.tuteeId,
                sessionId: primaryId,
                color: "RED",
                source: "AUTO",
                reason: "Unexcused absence (corrected attendance).",
                reviewStatus: "VALID",
                issuedByTutorId: primary.tutorId,
              },
            });
          await syncPunishmentRemoval(tx, tt.tuteeId);
        }
        if (evidenceChanged) await reconsiderFlag(tx, primaryId);
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            userName: ctx.session.user.name,
            entity: "Session",
            entityId: primaryId,
            action: `Corrected attendance: ${explanation}`,
            details: json({ before, after: input }),
          },
        });
        const heads = await tx.user.findMany({
          where: { role: "HEAD" },
          select: { id: true },
        });
        await notifyUsers(
          heads.map((h) => h.id),
          {
            title: "Management corrected a record",
            body: `${ctx.session.user.name ?? "Management"}: ${input.reason}`,
            link: "/admin/audit",
          },
          tx,
        );
        return { ok: true };
      }),
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
        await lockEntity(tx, `patrol:${input.id}`);
        const before = await tx.patrol.findUniqueOrThrow({
          where: { id: input.id },
          include: { observations: true },
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
        // Query both old and new evidence windows so moved observations clear old discrepancies.
        const evidence = [...before.observations, ...input.observations];
        const timeZone = await getProgramTimeZone(tx);
        const sessions = await tx.session.findMany({
          where: {
            OR: evidence.map((o) => ({
              actualRoomId: o.roomId,
              date: new Date(`${programDateKey(o.observedAt, timeZone)}T00:00:00Z`),
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
          for (const s of sessions) await reconsiderFlag(tx, s.id);
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
        const heads = await tx.user.findMany({
          where: { role: "HEAD" },
          select: { id: true },
        });
        await notifyUsers(
          heads.map((h) => h.id),
          {
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
