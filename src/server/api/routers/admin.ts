import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  adminOnlyProcedure,
  adminProcedure,
  createTRPCRouter,
} from "~/server/api/trpc";
import { monthKey } from "~/lib/service-hours";
import { defaultUsername, ensureUniqueUsername } from "~/server/auth/username";
import { promoteApplicantToTutor } from "~/server/tutors/promote";

const monthInput = z.string().regex(/^\d{4}-\d{2}$/);
const cuid = z.string().min(1);

/** Trim a string and collapse empty/whitespace-only values to null. */
function blankToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

const MEETING_STATUS = [
  "PRESENT",
  "EXCUSED_ABSENT",
  "UNEXCUSED_ABSENT",
  "EXEMPT",
] as const;
const ADJUSTMENT_TYPE = ["PUNISHMENT", "EXTRA"] as const;
const TUTEE_STATUS = ["PENDING", "ACTIVE", "INACTIVE"] as const;
const TUTOR_APP_STATUS = ["PENDING", "INTERVIEW", "ACCEPTED", "REJECTED"] as const;
const courseTag = z.enum(["AP", "HONORS", "STANDARD"]);

export const adminRouter = createTRPCRouter({
  // --------------------------------------------------------------------------
  // Reference lists
  // --------------------------------------------------------------------------
  tutors: adminProcedure.query(({ ctx }) =>
    ctx.db.tutor.findMany({ orderBy: { englishName: "asc" } }),
  ),
  tutees: adminProcedure.query(({ ctx }) =>
    ctx.db.tutee.findMany({
      orderBy: [{ status: "asc" }, { englishName: "asc" }],
      include: {
        firstChoice: { select: { id: true, name: true } },
        secondChoice: { select: { id: true, name: true } },
        availabilities: {
          include: {
            slot: { select: { id: true, label: true, dayOfWeek: true, startMin: true, endMin: true } },
          },
        },
      },
    }),
  ),
  rooms: adminProcedure.query(({ ctx }) =>
    ctx.db.room.findMany({
      orderBy: { name: "asc" },
      include: {
        unavailabilities: {
          orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
        },
      },
    }),
  ),
  terms: adminProcedure.query(({ ctx }) =>
    ctx.db.term.findMany({ orderBy: { createdAt: "desc" } }),
  ),
  courses: adminProcedure.query(({ ctx }) =>
    ctx.db.course.findMany({ orderBy: { name: "asc" } }),
  ),
  timeSlots: adminProcedure.query(({ ctx }) =>
    ctx.db.timeSlot.findMany({
      orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
    }),
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
        timeSlot: true,
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
        timeSlotId: cuid.optional(),
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
        timeSlotId: cuid.nullable().optional(),
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
      const { id, tuteeIds, roomId, timeSlotId, ...data } = input;
      // Replace roster atomically.
      return ctx.db.$transaction(async (tx) => {
        await tx.pairingTutee.deleteMany({ where: { pairingId: id } });
        return tx.pairing.update({
          where: { id },
          data: {
            ...data,
            roomId: roomId ?? null,
            timeSlotId: timeSlotId ?? null,
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
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        // Free-text, full Unicode (e.g. Chinese name) — no charset restriction.
        alternativeNames: z.string().trim().max(200).optional(),
        email: z.string().email().optional(),
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const username = await ensureUniqueUsername(
        defaultUsername(input.firstName, input.lastName),
      );
      return ctx.db.tutor.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          englishName: `${input.firstName} ${input.lastName}`,
          alternativeNames: input.alternativeNames?.trim()
            ? input.alternativeNames.trim()
            : null,
          username,
          active: input.active,
          email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
        },
      });
    }),

  updateTutor: adminProcedure
    .input(
      z.object({
        id: cuid,
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        alternativeNames: z.string().trim().max(200).nullable().optional(),
        // Admin may override the auto-generated handle; blank regenerates the default.
        username: z.string().trim().optional(),
        email: z.string().email().nullable().optional(),
        active: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const trimmedUsername = input.username?.trim();
      const desired =
        trimmedUsername && trimmedUsername.length > 0
          ? trimmedUsername
          : defaultUsername(input.firstName, input.lastName);
      const username = await ensureUniqueUsername(desired, input.id);
      return ctx.db.tutor.update({
        where: { id: input.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          englishName: `${input.firstName} ${input.lastName}`,
          alternativeNames: input.alternativeNames?.trim()
            ? input.alternativeNames.trim()
            : null,
          username,
          active: input.active,
          email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
        },
      });
    }),

  createTutee: adminProcedure
    .input(
      z.object({
        englishName: z.string().trim().min(1),
        email: z.string().email().nullable().optional(),
        phone: z.string().trim().nullable().optional(),
        gradeLevel: z.string().trim().nullable().optional(),
        notes: z.string().trim().nullable().optional(),
        status: z.enum(TUTEE_STATUS).default("ACTIVE"),
        firstChoiceId: cuid.nullable().optional(),
        secondChoiceId: cuid.nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.tutee.create({
        data: {
          englishName: input.englishName,
          email: blankToNull(input.email)?.toLowerCase() ?? null,
          phone: blankToNull(input.phone),
          gradeLevel: blankToNull(input.gradeLevel),
          notes: blankToNull(input.notes),
          status: input.status,
          firstChoiceId: input.firstChoiceId ?? null,
          secondChoiceId: input.secondChoiceId ?? null,
        },
      }),
    ),

  updateTutee: adminProcedure
    .input(
      z.object({
        id: cuid,
        englishName: z.string().trim().min(1),
        email: z.string().email().nullable().optional(),
        phone: z.string().trim().nullable().optional(),
        gradeLevel: z.string().trim().nullable().optional(),
        notes: z.string().trim().nullable().optional(),
        status: z.enum(TUTEE_STATUS),
        firstChoiceId: cuid.nullable().optional(),
        secondChoiceId: cuid.nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.tutee.update({
        where: { id: input.id },
        data: {
          englishName: input.englishName,
          email: blankToNull(input.email)?.toLowerCase() ?? null,
          phone: blankToNull(input.phone),
          gradeLevel: blankToNull(input.gradeLevel),
          notes: blankToNull(input.notes),
          status: input.status,
          firstChoiceId: input.firstChoiceId ?? null,
          secondChoiceId: input.secondChoiceId ?? null,
        },
      }),
    ),

  /**
   * Review action: assign a tutee to a tutor. Creates a pairing (subject defaults to the
   * tutee's first-choice course) in the given term and marks the tutee ACTIVE. The tutor
   * then picks the default time slot from their own dashboard.
   */
  assignTuteeToTutor: adminProcedure
    .input(
      z.object({
        tuteeId: cuid,
        tutorId: cuid,
        termId: cuid,
        subject: z.string().trim().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tutee = await ctx.db.tutee.findUnique({
        where: { id: input.tuteeId },
        select: { id: true, firstChoice: { select: { name: true } } },
      });
      if (!tutee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tutee not found." });
      }
      const subject = input.subject ?? tutee.firstChoice?.name;
      if (!subject) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No subject: pick a course for this tutee or pass a subject.",
        });
      }

      return ctx.db.$transaction(async (tx) => {
        const pairing = await tx.pairing.create({
          data: {
            tutorId: input.tutorId,
            termId: input.termId,
            subject,
            // Placeholder schedule — the tutor sets the real time when they pick a slot.
            dayOfWeek: 1,
            startMin: 15 * 60 + 30,
            endMin: 16 * 60 + 30,
            tutees: { create: [{ tuteeId: input.tuteeId }] },
          },
          select: { id: true },
        });
        await tx.tutee.update({
          where: { id: input.tuteeId },
          data: { status: "ACTIVE" },
        });
        return pairing;
      });
    }),

  /** Quick status change (e.g. approve a PENDING signup → ACTIVE). */
  setTuteeStatus: adminProcedure
    .input(z.object({ id: cuid, status: z.enum(TUTEE_STATUS) }))
    .mutation(({ ctx, input }) =>
      ctx.db.tutee.update({ where: { id: input.id }, data: { status: input.status } }),
    ),

  deleteTutee: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      const sessions = await ctx.db.sessionTutee.count({ where: { tuteeId: input.id } });
      if (sessions > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete a tutee with attendance history. Set them inactive instead.",
        });
      }
      await ctx.db.pairingTutee.deleteMany({ where: { tuteeId: input.id } });
      return ctx.db.tutee.delete({ where: { id: input.id } });
    }),

  // --------------------------------------------------------------------------
  // Course catalog (subjects offered; tutees pick first/second choice at signup)
  // --------------------------------------------------------------------------
  createCourse: adminProcedure
    .input(z.object({ name: z.string().trim().min(1), tag: courseTag.optional() }))
    .mutation(({ ctx, input }) =>
      ctx.db.course.create({ data: { name: input.name, tag: input.tag ?? "STANDARD" } }),
    ),

  updateCourse: adminProcedure
    .input(
      z.object({
        id: cuid,
        name: z.string().trim().min(1),
        tag: courseTag,
        active: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.course.update({
        where: { id: input.id },
        data: { name: input.name, tag: input.tag, active: input.active },
      }),
    ),

  deleteCourse: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      const used = await ctx.db.tutee.count({
        where: { OR: [{ firstChoiceId: input.id }, { secondChoiceId: input.id }] },
      });
      if (used > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Course is chosen by one or more tutees. Mark it inactive instead.",
        });
      }
      return ctx.db.course.delete({ where: { id: input.id } });
    }),

  // --------------------------------------------------------------------------
  // Time-slot catalog (reference scheduling; tutors/tutees mark availability)
  // --------------------------------------------------------------------------
  createTimeSlot: adminProcedure
    .input(
      z.object({
        label: z.string().trim().min(1),
        dayOfWeek: z.number().int().min(1).max(7),
        startMin: z.number().int().min(0).max(1439),
        endMin: z.number().int().min(1).max(1440),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (input.endMin <= input.startMin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
      }
      return ctx.db.timeSlot.create({ data: input });
    }),

  updateTimeSlot: adminProcedure
    .input(
      z.object({
        id: cuid,
        label: z.string().trim().min(1),
        dayOfWeek: z.number().int().min(1).max(7),
        startMin: z.number().int().min(0).max(1439),
        endMin: z.number().int().min(1).max(1440),
        active: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (input.endMin <= input.startMin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
      }
      const { id, ...data } = input;
      return ctx.db.timeSlot.update({ where: { id }, data });
    }),

  deleteTimeSlot: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      const used = await ctx.db.pairing.count({ where: { timeSlotId: input.id } });
      if (used > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Slot is referenced by a pairing. Mark it inactive instead.",
        });
      }
      // Tutor/tutee availability rows cascade-delete with the slot.
      return ctx.db.timeSlot.delete({ where: { id: input.id } });
    }),

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
  // Room unavailability (recurring weekly blackout periods, shown on the grid)
  // --------------------------------------------------------------------------
  createRoomUnavailability: adminProcedure
    .input(
      z.object({
        roomId: cuid,
        dayOfWeek: z.number().int().min(1).max(7),
        startMin: z.number().int().min(0).max(1439),
        endMin: z.number().int().min(1).max(1440),
        reason: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (input.endMin <= input.startMin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
      }
      return ctx.db.roomUnavailability.create({
        data: {
          roomId: input.roomId,
          dayOfWeek: input.dayOfWeek,
          startMin: input.startMin,
          endMin: input.endMin,
          reason: blankToNull(input.reason),
        },
      });
    }),

  deleteRoomUnavailability: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(({ ctx, input }) =>
      ctx.db.roomUnavailability.delete({ where: { id: input.id } }),
    ),

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
  // Tutor applications + interview assignment
  // --------------------------------------------------------------------------
  tutorApplications: adminProcedure.query(({ ctx }) =>
    ctx.db.tutorApplication.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        courseIntents: {
          include: { course: { select: { name: true, tag: true } } },
        },
        interviewers: {
          include: { tutor: { select: { id: true, englishName: true } } },
        },
        votes: {
          select: { accept: true, comment: true, tutor: { select: { englishName: true } } },
        },
        decidedByTutor: { select: { englishName: true } },
      },
    }),
  ),

  /** Assign up to three tutors (one head) to interview an applicant; moves it to INTERVIEW. */
  assignInterviewers: adminProcedure
    .input(
      z.object({
        applicationId: cuid,
        tutorIds: z.array(cuid).min(1, "Pick at least one interviewer").max(8),
        headTutorId: cuid,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tutorIds = [...new Set(input.tutorIds)];
      if (!tutorIds.includes(input.headTutorId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The head must be one of the assigned interviewers.",
        });
      }
      const found = await ctx.db.tutor.count({ where: { id: { in: tutorIds } } });
      if (found !== tutorIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown tutor selected." });
      }

      return ctx.db.$transaction(async (tx) => {
        await tx.interviewAssignment.deleteMany({
          where: { applicationId: input.applicationId },
        });
        await tx.interviewAssignment.createMany({
          data: tutorIds.map((tutorId) => ({
            applicationId: input.applicationId,
            tutorId,
            isHead: tutorId === input.headTutorId,
          })),
        });
        return tx.tutorApplication.update({
          where: { id: input.applicationId },
          data: { status: "INTERVIEW" },
        });
      });
    }),

  setApplicationStatus: adminProcedure
    .input(z.object({ id: cuid, status: z.enum(TUTOR_APP_STATUS) }))
    .mutation(async ({ ctx, input }) => {
      const prev = await ctx.db.tutorApplication.findUnique({
        where: { id: input.id },
        select: { status: true },
      });
      const updated = await ctx.db.tutorApplication.update({
        where: { id: input.id },
        data: { status: input.status },
      });
      // On the transition to ACCEPTED, add the applicant to the tutors list.
      if (input.status === "ACCEPTED" && prev?.status !== "ACCEPTED") {
        await promoteApplicantToTutor(input.id);
      }
      return updated;
    }),

  deleteApplication: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(({ ctx, input }) =>
      ctx.db.tutorApplication.delete({ where: { id: input.id } }),
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

  // --------------------------------------------------------------------------
  // Policy documents (editable handbooks)
  // --------------------------------------------------------------------------
  policies: adminProcedure.query(({ ctx }) =>
    ctx.db.policyDocument.findMany({
      orderBy: { slug: "asc" },
      select: {
        id: true,
        slug: true,
        title: true,
        body: true,
        version: true,
        updatedAt: true,
        updatedBy: { select: { name: true, email: true } },
      },
    }),
  ),

  updatePolicy: adminProcedure
    .input(
      z.object({
        id: cuid,
        title: z.string().trim().min(1).max(200),
        version: z.string().trim().max(40).nullable().optional(),
        body: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.policyDocument.update({
        where: { id: input.id },
        data: {
          title: input.title,
          version: input.version?.trim() ? input.version.trim() : null,
          body: input.body,
          updatedById: ctx.session.user.id,
        },
      }),
    ),

  // --------------------------------------------------------------------------
  // Announcements (broadcast to tutors)
  // --------------------------------------------------------------------------
  announcements: adminProcedure.query(({ ctx }) =>
    ctx.db.announcement.findMany({
      orderBy: [{ active: "desc" }, { pinned: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        body: true,
        pinned: true,
        active: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        _count: { select: { acks: true } },
      },
    }),
  ),

  createAnnouncement: adminProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(5000),
        pinned: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.announcement.create({
        data: {
          title: input.title,
          body: input.body,
          pinned: input.pinned,
          createdById: ctx.session.user.id,
        },
      }),
    ),

  updateAnnouncement: adminProcedure
    .input(
      z.object({
        id: cuid,
        title: z.string().trim().min(1).max(200).optional(),
        body: z.string().trim().min(1).max(5000).optional(),
        pinned: z.boolean().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...rest } = input;
      return ctx.db.announcement.update({ where: { id }, data: rest });
    }),

  deleteAnnouncement: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(({ ctx, input }) =>
      ctx.db.announcement.delete({ where: { id: input.id } }),
    ),

  // --------------------------------------------------------------------------
  // Disciplinary cards (team recheck of yellow/red cards)
  // --------------------------------------------------------------------------
  disciplinaryCards: adminProcedure.query(({ ctx }) =>
    ctx.db.disciplinaryCard.findMany({
      orderBy: [{ reviewStatus: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        color: true,
        source: true,
        reason: true,
        reviewStatus: true,
        reviewNote: true,
        createdAt: true,
        tutee: { select: { id: true, englishName: true } },
        issuedByTutor: { select: { englishName: true } },
        session: { select: { date: true } },
      },
    }),
  ),

  reviewCard: adminProcedure
    .input(
      z.object({
        id: cuid,
        reviewStatus: z.enum(["VALID", "INVALID"]),
        reviewNote: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.disciplinaryCard.update({
        where: { id: input.id },
        data: {
          reviewStatus: input.reviewStatus,
          reviewNote: input.reviewNote?.trim() ? input.reviewNote.trim() : null,
          reviewedById: ctx.session.user.id,
          reviewedAt: new Date(),
        },
      }),
    ),
});
