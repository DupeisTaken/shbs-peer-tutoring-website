import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, tutorProcedure } from "~/server/api/trpc";
import { computeSessionHours, monthKey } from "~/lib/service-hours";

const ATTENDANCE_STATUS = [
  "PRESENT",
  "RESCHEDULED",
  "EXTRA_SESSION",
  "TUTOR_ABSENT",
  "TUTEE_ABSENT_EXCUSED",
  "TUTEE_ABSENT_UNEXCUSED",
] as const;

const rating = z.number().int().min(1).max(5).optional();
const monthInput = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .optional();

export const tutorRouter = createTRPCRouter({
  /** The signed-in tutor's pairings, with rostered tutees, room and term. */
  myPairings: tutorProcedure.query(async ({ ctx }) => {
    return ctx.db.pairing.findMany({
      where: { tutorId: ctx.session.tutorId },
      orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
      include: {
        room: true,
        term: true,
        timeSlot: true,
        tutees: { include: { tutee: true } },
      },
    });
  }),

  /** The signed-in tutor's attendance submissions (optionally filtered by month). */
  mySessions: tutorProcedure
    .input(z.object({ month: monthInput }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db.session.findMany({
        where: {
          tutorId: ctx.session.tutorId,
          ...(input?.month ? { month: input.month } : {}),
        },
        orderBy: { date: "desc" },
        include: {
          pairing: { select: { subject: true } },
          tutees: { include: { tutee: { select: { englishName: true } } } },
        },
      });
    }),

  /**
   * Live monthly service-hour total for the signed-in tutor:
   *   SUM(shCount) - PUNISHMENT adjustments + EXTRA adjustments.
   */
  myMonthlyTotal: tutorProcedure
    .input(z.object({ month: monthInput }).optional())
    .query(async ({ ctx, input }) => {
      const month = input?.month ?? monthKey(new Date());

      const [sessionAgg, adjustments] = await Promise.all([
        ctx.db.session.aggregate({
          where: { tutorId: ctx.session.tutorId, month },
          _sum: { shCount: true },
        }),
        ctx.db.serviceHourAdjustment.findMany({
          where: { tutorId: ctx.session.tutorId, month },
          select: { type: true, amount: true },
        }),
      ]);

      const earned = sessionAgg._sum.shCount ?? 0;
      const punishments = adjustments
        .filter((a) => a.type === "PUNISHMENT")
        .reduce((sum, a) => sum + a.amount, 0);
      const extras = adjustments
        .filter((a) => a.type === "EXTRA")
        .reduce((sum, a) => sum + a.amount, 0);

      return {
        month,
        earned,
        punishments,
        extras,
        total: earned - punishments + extras,
      };
    }),

  /**
   * Submit one attendance record. Service hours are computed server-side and stored on the row.
   * Row-scoped: the pairing must belong to the caller, and every selected tutee must be on
   * that pairing's roster.
   */
  submitAttendance: tutorProcedure
    .input(
      z.object({
        pairingId: z.string().min(1),
        date: z.coerce.date(),
        status: z.enum(ATTENDANCE_STATUS),
        tuteeIds: z.array(z.string().min(1)).min(1),
        // Optional overrides; default to the pairing's scheduled time.
        startMin: z.number().int().min(0).max(1439).optional(),
        endMin: z.number().int().min(1).max(1440).optional(),
        ratingPreparedness: rating,
        ratingParticipation: rating,
        ratingUnderstanding: rating,
        ratingBehavior: rating,
        ratingProgress: rating,
        comments: z.string().max(2000).optional(),
        // Disciplinary card requests raised via the survey. Each needs a justification
        // comment (policy §V.5). These are created PENDING for the team to recheck.
        cards: z
          .array(
            z.object({
              tuteeId: z.string().min(1),
              color: z.enum(["YELLOW", "RED"]),
              reason: z.string().trim().min(1, "Add a reason for each card").max(500),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Row scoping: the pairing must belong to this tutor.
      const pairing = await ctx.db.pairing.findFirst({
        where: { id: input.pairingId, tutorId: ctx.session.tutorId },
        include: { tutees: { select: { tuteeId: true } } },
      });
      if (!pairing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pairing not found for this tutor.",
        });
      }

      // Every selected tutee must be on this pairing's roster.
      const roster = new Set(pairing.tutees.map((t) => t.tuteeId));
      const uniqueTuteeIds = [...new Set(input.tuteeIds)];
      for (const id of uniqueTuteeIds) {
        if (!roster.has(id)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected tutee is not on this pairing.",
          });
        }
      }

      // Any carded tutee must also be on this pairing's roster.
      const cardRequests = input.cards ?? [];
      for (const c of cardRequests) {
        if (!roster.has(c.tuteeId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot card a tutee who is not on this pairing.",
          });
        }
      }

      const startMin = input.startMin ?? pairing.startMin;
      const endMin = input.endMin ?? pairing.endMin;
      if (endMin <= startMin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End time must be after start time.",
        });
      }

      const computed = computeSessionHours({
        status: input.status,
        tuteeCount: uniqueTuteeIds.length,
        startMin,
        endMin,
        date: input.date,
      });

      const session = await ctx.db.session.create({
        data: {
          pairingId: pairing.id,
          tutorId: ctx.session.tutorId,
          date: input.date,
          status: input.status,
          startMin,
          endMin,
          ratingPreparedness: input.ratingPreparedness,
          ratingParticipation: input.ratingParticipation,
          ratingUnderstanding: input.ratingUnderstanding,
          ratingBehavior: input.ratingBehavior,
          ratingProgress: input.ratingProgress,
          comments: input.comments,
          month: computed.month,
          durationMin: computed.durationMin,
          shFactor: computed.shFactor,
          shCount: computed.shCount,
          tutees: {
            create: uniqueTuteeIds.map((tuteeId) => ({ tuteeId })),
          },
        },
        select: { id: true, month: true, shCount: true },
      });

      // Disciplinary cards from this survey:
      //  - tutor-requested cards -> PENDING (team rechecks), with the required reason;
      //  - auto-issued: an unexcused tutee absence -> RED for each absent rostered tutee
      //    (created VALID per policy; still appealable / flaggable INVALID by the team).
      const cardRows: {
        tuteeId: string;
        color: "YELLOW" | "RED";
        source: "TUTOR" | "AUTO";
        reason: string;
        reviewStatus: "PENDING" | "VALID";
        issuedByTutorId: string | null;
        sessionId: string;
      }[] = cardRequests.map((c) => ({
        tuteeId: c.tuteeId,
        color: c.color,
        source: "TUTOR",
        reason: c.reason,
        reviewStatus: "PENDING",
        issuedByTutorId: ctx.session.tutorId,
        sessionId: session.id,
      }));

      if (input.status === "TUTEE_ABSENT_UNEXCUSED") {
        const presentSet = new Set(uniqueTuteeIds);
        for (const tuteeId of roster) {
          if (!presentSet.has(tuteeId)) {
            cardRows.push({
              tuteeId,
              color: "RED",
              source: "AUTO",
              reason: "Unexcused absence (auto-issued).",
              reviewStatus: "VALID",
              issuedByTutorId: ctx.session.tutorId,
              sessionId: session.id,
            });
          }
        }
      }

      if (cardRows.length > 0) {
        await ctx.db.disciplinaryCard.createMany({ data: cardRows });
      }

      return session;
    }),

  // --------------------------------------------------------------------------
  // Availability: the tutor marks which catalog time slots they can teach.
  // Slots are reference-only; admins use them when assigning tutees/pairings.
  // --------------------------------------------------------------------------

  /** The active time-slot catalog plus the slot ids the signed-in tutor has selected. */
  myAvailability: tutorProcedure.query(async ({ ctx }) => {
    const [slots, selected] = await Promise.all([
      ctx.db.timeSlot.findMany({
        where: { active: true },
        orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
        select: { id: true, label: true, dayOfWeek: true, startMin: true, endMin: true },
      }),
      ctx.db.tutorAvailability.findMany({
        where: { tutorId: ctx.session.tutorId },
        select: { slotId: true },
      }),
    ]);
    return { slots, selectedSlotIds: selected.map((s) => s.slotId) };
  }),

  /** Replace the signed-in tutor's availability with the given set of slot ids. */
  setAvailability: tutorProcedure
    .input(z.object({ slotIds: z.array(z.string().min(1)) }))
    .mutation(async ({ ctx, input }) => {
      const slotIds = [...new Set(input.slotIds)];
      // Ignore any inactive/unknown slots defensively.
      const valid = await ctx.db.timeSlot.findMany({
        where: { id: { in: slotIds }, active: true },
        select: { id: true },
      });
      const validIds = valid.map((s) => s.id);

      await ctx.db.$transaction([
        ctx.db.tutorAvailability.deleteMany({ where: { tutorId: ctx.session.tutorId } }),
        ctx.db.tutorAvailability.createMany({
          data: validIds.map((slotId) => ({ tutorId: ctx.session.tutorId, slotId })),
        }),
      ]);
      return { ok: true, count: validIds.length };
    }),

  /** The signed-in tutor's own domain record (used to gate the pending-approval state). */
  me: tutorProcedure.query(({ ctx }) =>
    ctx.db.tutor.findUniqueOrThrow({
      where: { id: ctx.session.tutorId },
      select: { id: true, englishName: true, active: true, email: true },
    }),
  ),

  // --------------------------------------------------------------------------
  // Announcements: team broadcasts surfaced on the dashboard every login until acked.
  // --------------------------------------------------------------------------

  /** Active announcements, newest first, each flagged with whether the caller acked it. */
  myAnnouncements: tutorProcedure.query(async ({ ctx }) => {
    const announcements = await ctx.db.announcement.findMany({
      where: { active: true },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        body: true,
        pinned: true,
        createdAt: true,
        acks: { where: { userId: ctx.session.user.id }, select: { userId: true } },
      },
    });
    return announcements.map(({ acks, ...a }) => ({ ...a, acked: acks.length > 0 }));
  }),

  /** Mark an announcement acknowledged for the signed-in user (idempotent). */
  acknowledgeAnnouncement: tutorProcedure
    .input(z.object({ announcementId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.announcementAck.upsert({
        where: {
          announcementId_userId: {
            announcementId: input.announcementId,
            userId: ctx.session.user.id,
          },
        },
        update: {},
        create: { announcementId: input.announcementId, userId: ctx.session.user.id },
      });
      return { ok: true };
    }),

  /**
   * Set (or clear) the default reference time slot for one of the caller's pairings.
   * Row-scoped: the pairing MUST belong to this tutor. Choosing a slot copies its
   * day/start/end onto the pairing so attendance defaults follow the slot.
   */
  setPairingSlot: tutorProcedure
    .input(z.object({ pairingId: z.string().min(1), slotId: z.string().min(1).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const pairing = await ctx.db.pairing.findFirst({
        where: { id: input.pairingId, tutorId: ctx.session.tutorId },
        select: { id: true },
      });
      if (!pairing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pairing not found for this tutor." });
      }

      if (input.slotId === null) {
        return ctx.db.pairing.update({
          where: { id: pairing.id },
          data: { timeSlotId: null },
        });
      }

      const slot = await ctx.db.timeSlot.findFirst({
        where: { id: input.slotId, active: true },
        select: { dayOfWeek: true, startMin: true, endMin: true },
      });
      if (!slot) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Time slot not found." });
      }
      return ctx.db.pairing.update({
        where: { id: pairing.id },
        data: {
          timeSlotId: input.slotId,
          dayOfWeek: slot.dayOfWeek,
          startMin: slot.startMin,
          endMin: slot.endMin,
        },
      });
    }),

  /**
   * Read-only schedule for the room grid on the tutor page: rooms, the active slot catalog,
   * every scheduled pairing (room + slot occupancy), and room blackout periods. This is
   * non-sensitive scheduling data (no tutee PII), shown so tutors can see room assignments.
   */
  schedule: tutorProcedure.query(async ({ ctx }) => {
    const [rooms, slots, pairings, blocks] = await Promise.all([
      ctx.db.room.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      ctx.db.timeSlot.findMany({
        where: { active: true },
        orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
        select: { id: true, label: true, dayOfWeek: true, startMin: true, endMin: true },
      }),
      ctx.db.pairing.findMany({
        select: {
          id: true,
          subject: true,
          dayOfWeek: true,
          startMin: true,
          endMin: true,
          tutorId: true,
          roomId: true,
          timeSlotId: true,
          tutor: { select: { englishName: true } },
        },
      }),
      ctx.db.roomUnavailability.findMany({
        select: { id: true, roomId: true, dayOfWeek: true, startMin: true, endMin: true, reason: true },
      }),
    ]);
    return { rooms, slots, pairings, blocks, myTutorId: ctx.session.tutorId };
  }),

  // --------------------------------------------------------------------------
  // Tutor-applicant interviews (this tutor is an assigned interviewer)
  // --------------------------------------------------------------------------

  /** Applications the signed-in tutor is assigned to interview, with candidate details. */
  myInterviews: tutorProcedure.query(async ({ ctx }) => {
    const assignments = await ctx.db.interviewAssignment.findMany({
      where: { tutorId: ctx.session.tutorId },
      orderBy: { application: { createdAt: "desc" } },
      select: {
        isHead: true,
        application: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            interviewAt: true,
            courseIntents: {
              select: {
                taken: true,
                grade: true,
                course: { select: { name: true } },
              },
            },
            interviewers: {
              select: { isHead: true, tutor: { select: { englishName: true } } },
            },
          },
        },
      },
    });
    return assignments.map((a) => ({ isHead: a.isHead, ...a.application }));
  }),

  /**
   * Set the interview time for an application. Only the HEAD interviewer of that
   * application may do this (row-scoped check on the caller's tutorId + isHead).
   */
  setInterviewTime: tutorProcedure
    .input(
      z.object({
        applicationId: z.string().min(1),
        interviewAt: z.coerce.date().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const assignment = await ctx.db.interviewAssignment.findUnique({
        where: {
          applicationId_tutorId: {
            applicationId: input.applicationId,
            tutorId: ctx.session.tutorId,
          },
        },
        select: { isHead: true },
      });
      if (!assignment?.isHead) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the head interviewer can set the interview time.",
        });
      }
      return ctx.db.tutorApplication.update({
        where: { id: input.applicationId },
        data: { interviewAt: input.interviewAt },
      });
    }),
});
