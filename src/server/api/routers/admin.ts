import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  adminOnlyProcedure,
  adminProcedure,
  createTRPCRouter,
} from "~/server/api/trpc";
import { monthKey } from "~/lib/service-hours";

const monthInput = z.string().regex(/^\d{4}-\d{2}$/);
const cuid = z.string().min(1);

const ATTENDANCE_STATUS = [
  "PRESENT",
  "RESCHEDULED",
  "EXTRA_SESSION",
  "TUTOR_ABSENT",
  "TUTEE_ABSENT_EXCUSED",
  "TUTEE_ABSENT_UNEXCUSED",
] as const;
const MEETING_STATUS = [
  "PRESENT",
  "EXCUSED_ABSENT",
  "UNEXCUSED_ABSENT",
  "EXEMPT",
] as const;
const ADJUSTMENT_TYPE = ["PUNISHMENT", "EXTRA"] as const;

export const adminRouter = createTRPCRouter({
  // --------------------------------------------------------------------------
  // Reference lists
  // --------------------------------------------------------------------------
  tutors: adminProcedure.query(({ ctx }) =>
    ctx.db.tutor.findMany({ orderBy: { englishName: "asc" } }),
  ),
  tutees: adminProcedure.query(({ ctx }) =>
    ctx.db.tutee.findMany({ orderBy: { englishName: "asc" } }),
  ),
  rooms: adminProcedure.query(({ ctx }) =>
    ctx.db.room.findMany({ orderBy: { name: "asc" } }),
  ),
  terms: adminProcedure.query(({ ctx }) =>
    ctx.db.term.findMany({ orderBy: { createdAt: "desc" } }),
  ),

  // --------------------------------------------------------------------------
  // Pairings (+ room grid)
  // --------------------------------------------------------------------------
  pairings: adminProcedure.query(({ ctx }) =>
    ctx.db.pairing.findMany({
      orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
      include: {
        tutor: true,
        room: true,
        term: true,
        tutees: { include: { tutee: true } },
      },
    }),
  ),

  createPairing: adminProcedure
    .input(
      z.object({
        tutorId: cuid,
        termId: cuid,
        roomId: cuid.optional(),
        subject: z.string().min(1),
        dayOfWeek: z.number().int().min(1).max(7),
        startMin: z.number().int().min(0).max(1439),
        endMin: z.number().int().min(1).max(1440),
        tuteeIds: z.array(cuid).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.endMin <= input.startMin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
      }
      const { tuteeIds, ...data } = input;
      return ctx.db.pairing.create({
        data: { ...data, tutees: { create: tuteeIds.map((tuteeId) => ({ tuteeId })) } },
      });
    }),

  updatePairing: adminProcedure
    .input(
      z.object({
        id: cuid,
        tutorId: cuid,
        termId: cuid,
        roomId: cuid.nullable().optional(),
        subject: z.string().min(1),
        dayOfWeek: z.number().int().min(1).max(7),
        startMin: z.number().int().min(0).max(1439),
        endMin: z.number().int().min(1).max(1440),
        tuteeIds: z.array(cuid),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.endMin <= input.startMin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
      }
      const { id, tuteeIds, roomId, ...data } = input;
      // Replace roster atomically.
      return ctx.db.$transaction(async (tx) => {
        await tx.pairingTutee.deleteMany({ where: { pairingId: id } });
        return tx.pairing.update({
          where: { id },
          data: {
            ...data,
            roomId: roomId ?? null,
            tutees: { create: tuteeIds.map((tuteeId) => ({ tuteeId })) },
          },
        });
      });
    }),

  deletePairing: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      const sessions = await ctx.db.session.count({ where: { pairingId: input.id } });
      if (sessions > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete a pairing that has attendance submissions.",
        });
      }
      await ctx.db.pairingTutee.deleteMany({ where: { pairingId: input.id } });
      return ctx.db.pairing.delete({ where: { id: input.id } });
    }),

  // --------------------------------------------------------------------------
  // Submissions (all sessions)
  // --------------------------------------------------------------------------
  sessions: adminProcedure
    .input(
      z
        .object({ tutorId: cuid.optional(), month: monthInput.optional() })
        .optional(),
    )
    .query(({ ctx, input }) =>
      ctx.db.session.findMany({
        where: {
          ...(input?.tutorId ? { tutorId: input.tutorId } : {}),
          ...(input?.month ? { month: input.month } : {}),
        },
        orderBy: { date: "desc" },
        include: {
          tutor: { select: { englishName: true } },
          pairing: { select: { subject: true } },
          tutees: { include: { tutee: { select: { englishName: true } } } },
        },
      }),
    ),

  // --------------------------------------------------------------------------
  // Per-tutor monthly summary
  // --------------------------------------------------------------------------
  monthlySummary: adminProcedure
    .input(z.object({ month: monthInput.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const month = input?.month ?? monthKey(new Date());
      const [tutors, sessionSums, adjustments] = await Promise.all([
        ctx.db.tutor.findMany({ orderBy: { englishName: "asc" } }),
        ctx.db.session.groupBy({
          by: ["tutorId"],
          where: { month },
          _sum: { shCount: true },
        }),
        ctx.db.serviceHourAdjustment.groupBy({
          by: ["tutorId", "type"],
          where: { month },
          _sum: { amount: true },
        }),
      ]);

      const earnedByTutor = new Map(
        sessionSums.map((s) => [s.tutorId, s._sum.shCount ?? 0]),
      );
      const punishmentByTutor = new Map<string, number>();
      const extraByTutor = new Map<string, number>();
      for (const a of adjustments) {
        const target = a.type === "PUNISHMENT" ? punishmentByTutor : extraByTutor;
        target.set(a.tutorId, (target.get(a.tutorId) ?? 0) + (a._sum.amount ?? 0));
      }

      return {
        month,
        rows: tutors.map((t) => {
          const earned = earnedByTutor.get(t.id) ?? 0;
          const punishments = punishmentByTutor.get(t.id) ?? 0;
          const extras = extraByTutor.get(t.id) ?? 0;
          return {
            tutorId: t.id,
            englishName: t.englishName,
            active: t.active,
            earned,
            punishments,
            extras,
            total: earned - punishments + extras,
          };
        }),
      };
    }),

  // --------------------------------------------------------------------------
  // Tutor / Tutee / Room management
  // --------------------------------------------------------------------------
  createTutor: adminProcedure
    .input(
      z.object({
        englishName: z.string().min(1),
        email: z.string().email().optional(),
        active: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.tutor.create({
        data: {
          englishName: input.englishName,
          active: input.active,
          email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
        },
      }),
    ),

  updateTutor: adminProcedure
    .input(
      z.object({
        id: cuid,
        englishName: z.string().min(1),
        email: z.string().email().nullable().optional(),
        active: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.tutor.update({
        where: { id: input.id },
        data: {
          englishName: input.englishName,
          active: input.active,
          email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
        },
      }),
    ),

  createTutee: adminProcedure
    .input(z.object({ englishName: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.db.tutee.create({ data: input })),

  updateTutee: adminProcedure
    .input(z.object({ id: cuid, englishName: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.tutee.update({ where: { id: input.id }, data: { englishName: input.englishName } }),
    ),

  createRoom: adminProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.db.room.create({ data: input })),

  updateRoom: adminProcedure
    .input(z.object({ id: cuid, name: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.room.update({ where: { id: input.id }, data: { name: input.name } }),
    ),

  deleteRoom: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      const used = await ctx.db.pairing.count({ where: { roomId: input.id } });
      if (used > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Room is in use by a pairing.",
        });
      }
      return ctx.db.room.delete({ where: { id: input.id } });
    }),

  // --------------------------------------------------------------------------
  // Tutor meetings + attendance (P / EA / UA / X)
  // --------------------------------------------------------------------------
  meetings: adminProcedure.query(({ ctx }) =>
    ctx.db.tutorMeeting.findMany({
      orderBy: { date: "desc" },
      include: { attendances: { include: { tutor: { select: { englishName: true } } } } },
    }),
  ),

  createMeeting: adminProcedure
    .input(
      z.object({
        title: z.string().min(1),
        date: z.coerce.date(),
        termId: cuid.optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.db.tutorMeeting.create({ data: input })),

  deleteMeeting: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(({ ctx, input }) =>
      ctx.db.tutorMeeting.delete({ where: { id: input.id } }),
    ),

  recordMeetingAttendance: adminProcedure
    .input(
      z.object({
        meetingId: cuid,
        entries: z.array(
          z.object({ tutorId: cuid, status: z.enum(MEETING_STATUS) }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(
        input.entries.map((e) =>
          ctx.db.meetingAttendance.upsert({
            where: {
              meetingId_tutorId: { meetingId: input.meetingId, tutorId: e.tutorId },
            },
            update: { status: e.status },
            create: { meetingId: input.meetingId, tutorId: e.tutorId, status: e.status },
          }),
        ),
      );
      return { ok: true };
    }),

  // --------------------------------------------------------------------------
  // Punishments (per tutee)
  // --------------------------------------------------------------------------
  punishments: adminProcedure.query(({ ctx }) =>
    ctx.db.punishment.findMany({
      orderBy: { date: "desc" },
      include: { tutee: { select: { englishName: true } } },
    }),
  ),

  createPunishment: adminProcedure
    .input(
      z.object({
        tuteeId: cuid,
        reason: z.string().optional(),
        date: z.coerce.date().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.punishment.create({
        data: { tuteeId: input.tuteeId, reason: input.reason, date: input.date },
      }),
    ),

  deletePunishment: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(({ ctx, input }) =>
      ctx.db.punishment.delete({ where: { id: input.id } }),
    ),

  // --------------------------------------------------------------------------
  // Service-hour adjustments (per tutor, per month)
  // --------------------------------------------------------------------------
  adjustments: adminProcedure
    .input(z.object({ month: monthInput.optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.db.serviceHourAdjustment.findMany({
        where: input?.month ? { month: input.month } : {},
        orderBy: { createdAt: "desc" },
        include: { tutor: { select: { englishName: true } } },
      }),
    ),

  createAdjustment: adminProcedure
    .input(
      z.object({
        tutorId: cuid,
        month: monthInput,
        type: z.enum(ADJUSTMENT_TYPE),
        amount: z.number().positive(),
        reason: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.serviceHourAdjustment.create({ data: input }),
    ),

  deleteAdjustment: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(({ ctx, input }) =>
      ctx.db.serviceHourAdjustment.delete({ where: { id: input.id } }),
    ),

  // --------------------------------------------------------------------------
  // User / role management (ADMIN only)
  // --------------------------------------------------------------------------
  users: adminOnlyProcedure.query(({ ctx }) =>
    ctx.db.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        tutorId: true,
        tutor: { select: { englishName: true } },
      },
    }),
  ),

  setUserRole: adminOnlyProcedure
    .input(z.object({ userId: cuid, role: z.enum(["TUTOR", "COORDINATOR", "ADMIN"]) }))
    .mutation(({ ctx, input }) =>
      ctx.db.user.update({ where: { id: input.userId }, data: { role: input.role } }),
    ),
});
