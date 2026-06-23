import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { activeTutorProcedure, createTRPCRouter, tutorProcedure } from "~/server/api/trpc";
import { computeSessionHours } from "~/lib/service-hours";
import { semesterQuarters } from "~/lib/period";
import { getActivePeriodOrNull } from "~/server/period";
import { promoteApplicantToTutor } from "~/server/tutors/promote";
import { notifyAdmins, notifyTutors } from "~/server/notifications/create";
import { hashPassword, verifyPassword } from "~/server/auth/password";
import { expectedUpdatedAt, staleConflict } from "~/server/concurrency";

const TUTOR_STATUS = ["PRESENT", "RESCHEDULED", "EXTRA", "TUTOR_ABSENT"] as const;
const TUTEE_STATUS = ["PRESENT", "EXCUSED_ABSENT", "UNEXCUSED_ABSENT"] as const;

/** Cooldown before an admin may approve an opt-out request — the tutor can recall it meanwhile. */
const OPT_OUT_COOLDOWN_DAYS = 7;

/** A tutor may self-excuse a meeting absence only up to this many minutes before it starts. */
const MEETING_EXCUSE_CUTOFF_MIN = 30;

const rating = z.number().int().min(1).max(5).optional();
const RATING_KEYS = [
  "ratingPreparedness",
  "ratingParticipation",
  "ratingUnderstanding",
  "ratingBehavior",
  "ratingProgress",
] as const;
const monthInput = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .optional();

export const tutorRouter = createTRPCRouter({
  /** The signed-in tutor's *current* pairings (active program period), with tutees/room/term. */
  myPairings: tutorProcedure.query(async ({ ctx }) => {
    return ctx.db.pairing.findMany({
      where: { tutorId: ctx.session.tutorId, term: { active: true } },
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
   * Live service-hour total for the signed-in tutor, scoped to the **current semester** (hours
   * accumulate across the semester's two quarters and reset when a new semester begins):
   *   SUM(shCount) - PUNISHMENT adjustments + EXTRA adjustments.
   */
  myMonthlyTotal: tutorProcedure.query(async ({ ctx }) => {
    const active = await getActivePeriodOrNull(ctx.db);
    if (!active) {
      return {
        periodLabel: null,
        schoolYear: null,
        semester: null,
        earned: 0,
        punishments: 0,
        extras: 0,
        total: 0,
      };
    }
    const where = {
      tutorId: ctx.session.tutorId,
      schoolYear: active.schoolYear,
      quarter: { in: semesterQuarters(active.semester) },
    };

    const [sessionAgg, adjustments] = await Promise.all([
      ctx.db.session.aggregate({ where, _sum: { shCount: true } }),
      ctx.db.serviceHourAdjustment.findMany({
        where,
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
      periodLabel: `${active.schoolYear} ${active.semester}`,
      schoolYear: active.schoolYear,
      semester: active.semester,
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
      z
        .object({
          pairingId: z.string().min(1),
          // Other pairings (subjects) run in the same combined block. Each becomes its own
          // Session linked by mergeGroupId; the block's clock time is counted once.
          mergePairingIds: z.array(z.string().min(1)).max(5).optional(),
          date: z.coerce.date(),
          // Tutor's own status (did the session happen?) + reason when absent.
          tutorStatus: z.enum(TUTOR_STATUS),
          tutorAbsentReason: z.string().trim().max(500).optional(),
          // Per-tutee attendance; a reason is required for an excused absence.
          tutees: z
            .array(
              z.object({
                tuteeId: z.string().min(1),
                status: z.enum(TUTEE_STATUS),
                absenceReason: z.string().trim().max(500).optional(),
              }),
            )
            .min(1),
          // Optional overrides; default to the pairing's scheduled time.
          startMin: z.number().int().min(0).max(1439).optional(),
          endMin: z.number().int().min(1).max(1440).optional(),
          ratingPreparedness: rating,
          ratingParticipation: rating,
          ratingUnderstanding: rating,
          ratingBehavior: rating,
          ratingProgress: rating,
          // Comments are required (policy §I.5 / survey accuracy).
          comments: z.string().trim().min(1, "Comments are required").max(2000),
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
        })
        .superRefine((val, ctx) => {
          if (val.tutorStatus === "TUTOR_ABSENT" && !val.tutorAbsentReason?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tutorAbsentReason"],
              message: "Give a reason for the tutor absence.",
            });
          }
          for (const [i, tuteeRow] of val.tutees.entries()) {
            if (tuteeRow.status === "EXCUSED_ABSENT" && !tuteeRow.absenceReason?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["tutees", i, "absenceReason"],
                message: "Give a reason for the excused absence.",
              });
            }
          }
          // Ratings are required when a session was actually held with a present tutee
          // (present / rescheduled / extra — anything but a tutor absence).
          const held =
            val.tutorStatus !== "TUTOR_ABSENT" &&
            val.tutees.some((tt) => tt.status === "PRESENT");
          if (held) {
            for (const key of RATING_KEYS) {
              if (val[key] == null) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [key],
                  message: "Ratings are required for a held session.",
                });
              }
            }
          }
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const tutorId = ctx.session.tutorId;
      // The block can cover several subjects (pairings). Primary first, then the merged ones.
      const mergeIds = [...new Set(input.mergePairingIds ?? [])].filter(
        (id) => id !== input.pairingId,
      );
      const allPairingIds = [input.pairingId, ...mergeIds];

      // Row scoping: every pairing in the block must belong to this tutor.
      const found = await ctx.db.pairing.findMany({
        where: { id: { in: allPairingIds }, tutorId },
        include: {
          tutees: { select: { tuteeId: true } },
          // The session is stamped with this pairing's program period (for semester-scoped hours).
          term: { select: { schoolYear: true, quarter: true } },
        },
      });
      const primary = found.find((p) => p.id === input.pairingId);
      if (!primary || found.length !== allPairingIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pairing not found for this tutor.",
        });
      }
      // Keep the requested order: primary, then merges as given.
      const ordered = [primary, ...mergeIds.map((id) => found.find((p) => p.id === id)!)];

      // Roster per pairing + the union across the whole block.
      const rosterByPairing = new Map(
        found.map((p) => [p.id, new Set(p.tutees.map((t) => t.tuteeId))]),
      );
      const unionRoster = new Set<string>();
      for (const set of rosterByPairing.values()) for (const id of set) unionRoster.add(id);

      // Every listed tutee must be on at least one pairing in the block (de-duplicated).
      const tuteeRows = [...new Map(input.tutees.map((t) => [t.tuteeId, t])).values()];
      for (const t of tuteeRows) {
        if (!unionRoster.has(t.tuteeId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected tutee is not on any of these pairings.",
          });
        }
      }

      // Any carded tutee must also be in the block's roster.
      const cardRequests = input.cards ?? [];
      for (const c of cardRequests) {
        if (!unionRoster.has(c.tuteeId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot card a tutee who is not on these pairings.",
          });
        }
      }

      const startMin = input.startMin ?? primary.startMin;
      const endMin = input.endMin ?? primary.endMin;
      if (endMin <= startMin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End time must be after start time.",
        });
      }

      // Service hours for the block are computed once from the shared window.
      const computed = computeSessionHours({
        tutorStatus: input.tutorStatus,
        tuteeStatuses: tuteeRows.map((t) => t.status),
        startMin,
        endMin,
        date: input.date,
      });
      const merged = ordered.length > 1;

      const ratings = {
        ratingPreparedness: input.ratingPreparedness,
        ratingParticipation: input.ratingParticipation,
        ratingUnderstanding: input.ratingUnderstanding,
        ratingBehavior: input.ratingBehavior,
        ratingProgress: input.ratingProgress,
      };

      const result = await ctx.db.$transaction(async (tx) => {
        const sessionIds: string[] = [];
        let primaryId = "";
        for (const [i, p] of ordered.entries()) {
          const isPrimary = i === 0;
          const roster = rosterByPairing.get(p.id)!;
          const rows = tuteeRows.filter((t) => roster.has(t.tuteeId));
          // The block's clock time counts once — on the primary session. Siblings carry 0 hours.
          const created = await tx.session.create({
            data: {
              pairingId: p.id,
              tutorId,
              date: input.date,
              tutorStatus: input.tutorStatus,
              tutorAbsentReason:
                input.tutorStatus === "TUTOR_ABSENT"
                  ? (input.tutorAbsentReason?.trim() ?? null)
                  : null,
              startMin,
              endMin,
              ...ratings,
              comments: input.comments,
              month: computed.month,
              // Program period this session counts toward (from the pairing's term).
              schoolYear: p.term.schoolYear,
              quarter: p.term.quarter,
              durationMin: computed.durationMin,
              shFactor: isPrimary ? computed.shFactor : 0,
              shCount: isPrimary ? computed.shCount : 0,
              tutees: {
                create: rows.map((t) => ({
                  tuteeId: t.tuteeId,
                  status: t.status,
                  absenceReason:
                    t.status === "EXCUSED_ABSENT" ? (t.absenceReason?.trim() ?? null) : null,
                })),
              },
            },
            select: { id: true },
          });
          if (isPrimary) primaryId = created.id;
          sessionIds.push(created.id);
        }

        // Link merged siblings under the primary session's id as the group key.
        if (merged) {
          await tx.session.updateMany({
            where: { id: { in: sessionIds } },
            data: { mergeGroupId: primaryId },
          });
        }

        // Disciplinary cards for the whole block, attached to the primary session and
        // de-duplicated by tutee (so a merged block can't double-card the same person):
        //  - tutor-requested -> PENDING (team rechecks), with the required reason;
        //  - auto-issued: each UNEXCUSED_ABSENT tutee -> RED (created VALID per policy).
        const autoRed = new Set(
          tuteeRows.filter((t) => t.status === "UNEXCUSED_ABSENT").map((t) => t.tuteeId),
        );
        const cardRows: {
          tuteeId: string;
          color: "YELLOW" | "RED";
          source: "TUTOR" | "AUTO";
          reason: string;
          reviewStatus: "PENDING" | "VALID";
          issuedByTutorId: string | null;
          sessionId: string;
        }[] = [
          ...cardRequests.map((c) => ({
            tuteeId: c.tuteeId,
            color: c.color,
            source: "TUTOR" as const,
            reason: c.reason,
            reviewStatus: "PENDING" as const,
            issuedByTutorId: tutorId,
            sessionId: primaryId,
          })),
          ...[...autoRed].map((tuteeId) => ({
            tuteeId,
            color: "RED" as const,
            source: "AUTO" as const,
            reason: "Unexcused absence (auto-issued).",
            reviewStatus: "VALID" as const,
            issuedByTutorId: tutorId,
            sessionId: primaryId,
          })),
        ];
        if (cardRows.length > 0) {
          await tx.disciplinaryCard.createMany({ data: cardRows });
        }

        return { id: primaryId, month: computed.month, shCount: computed.shCount };
      });

      // Tutor-requested cards need a team review — surface them for admins.
      if (cardRequests.length > 0) {
        await notifyAdmins({
          title: "Discipline cards to review",
          body: `${cardRequests.length} card(s) submitted with an attendance survey.`,
          link: "/admin/discipline",
        });
      }

      return result;
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

  /** The signed-in tutor's own domain record (used to gate the read-only inactive state). */
  me: tutorProcedure.query(({ ctx }) =>
    ctx.db.tutor.findUniqueOrThrow({
      where: { id: ctx.session.tutorId },
      select: { id: true, englishName: true, status: true, email: true, gradeLevel: true },
    }),
  ),

  // --------------------------------------------------------------------------
  // Self-service profile (a tutor editing their own personal information)
  // --------------------------------------------------------------------------
  /** The signed-in tutor's editable profile (+ read-only name/username/grade). */
  myProfile: tutorProcedure.query(async ({ ctx }) => {
    const [tutor, user] = await Promise.all([
      ctx.db.tutor.findUniqueOrThrow({
        where: { id: ctx.session.tutorId },
        select: { englishName: true, username: true, alternativeNames: true, gradeLevel: true },
      }),
      ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { email: true },
      }),
    ]);
    return { ...tutor, email: user.email };
  }),

  /**
   * Update the tutor's own alternative name(s), contact email, and self-reported grade.
   * Grade is self-reported (handles retained grades); the class-of year is derived from it and
   * is NOT directly editable. Tutors can't change their own status here — that's the opt-out flow.
   */
  updateProfile: tutorProcedure
    .input(
      z.object({
        alternativeNames: z.string().trim().max(200).nullable().optional(),
        email: z.string().email().optional(),
        gradeLevel: z.number().int().min(6).max(12).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.email) {
        const email = input.email.trim().toLowerCase();
        const clash = await ctx.db.user.findFirst({
          where: { email, id: { not: ctx.session.user.id } },
          select: { id: true },
        });
        if (clash) {
          throw new TRPCError({ code: "CONFLICT", message: "That email is already in use." });
        }
        await ctx.db.user.update({ where: { id: ctx.session.user.id }, data: { email } });
      }
      const tutorData: { alternativeNames?: string | null; gradeLevel?: number | null } = {};
      if (input.alternativeNames !== undefined) {
        tutorData.alternativeNames = input.alternativeNames?.trim()
          ? input.alternativeNames.trim()
          : null;
      }
      if (input.gradeLevel !== undefined) tutorData.gradeLevel = input.gradeLevel;
      if (Object.keys(tutorData).length > 0) {
        await ctx.db.tutor.update({ where: { id: ctx.session.tutorId }, data: tutorData });
      }
      return { ok: true };
    }),

  /** Change the tutor's own password (requires the current one). */
  changePassword: tutorProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "Use at least 8 characters."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { passwordHash: true },
      });
      if (!user.passwordHash || !verifyPassword(input.currentPassword, user.passwordHash)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Current password is incorrect." });
      }
      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { passwordHash: hashPassword(input.newPassword), mustChangePassword: false },
      });
      return { ok: true };
    }),

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

  /** Applications the signed-in tutor is assigned to interview, with candidate details,
   *  the panel's votes, and the head's final decision. */
  myInterviews: tutorProcedure.query(async ({ ctx }) => {
    const myTutorId = ctx.session.tutorId;
    const assignments = await ctx.db.interviewAssignment.findMany({
      where: { tutorId: myTutorId },
      orderBy: { application: { createdAt: "desc" } },
      select: {
        isHead: true,
        application: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            updatedAt: true,
            interviewAt: true,
            decisionComment: true,
            decidedAt: true,
            decidedByTutor: { select: { englishName: true } },
            subjectIntents: {
              select: {
                taken: true,
                grade: true,
                subject: { select: { name: true } },
              },
            },
            interviewers: {
              select: { isHead: true, tutor: { select: { englishName: true } } },
            },
            votes: {
              select: {
                tutorId: true,
                accept: true,
                comment: true,
                tutor: { select: { englishName: true } },
              },
            },
          },
        },
      },
    });
    return assignments.map((a) => {
      const myVote = a.application.votes.find((v) => v.tutorId === myTutorId) ?? null;
      const accepts = a.application.votes.filter((v) => v.accept).length;
      const rejects = a.application.votes.length - accepts;
      return {
        isHead: a.isHead,
        ...a.application,
        myVote: myVote ? { accept: myVote.accept, comment: myVote.comment } : null,
        tally: { accepts, rejects },
      };
    });
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
      const updated = await ctx.db.tutorApplication.update({
        where: { id: input.applicationId },
        data: { interviewAt: input.interviewAt },
      });
      // Tell the rest of the panel when a time is set (it shows on their dashboard).
      if (input.interviewAt) {
        const panel = await ctx.db.interviewAssignment.findMany({
          where: { applicationId: input.applicationId, tutorId: { not: ctx.session.tutorId } },
          select: { tutorId: true },
        });
        await notifyTutors(
          panel.map((p) => p.tutorId),
          {
            title: "Interview scheduled",
            body: `An interview was scheduled for ${input.interviewAt.toLocaleString()}.`,
            link: "/dashboard",
          },
        );
      }
      return updated;
    }),

  /**
   * Cast (or update) the caller's interview vote for an application. Any assigned panelist
   * may vote; row-scoped to applications the caller is actually on the panel for.
   */
  castInterviewVote: tutorProcedure
    .input(
      z.object({
        applicationId: z.string().min(1),
        accept: z.boolean(),
        comment: z.string().trim().max(500).optional(),
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
        select: { tutorId: true },
      });
      if (!assignment) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not on this interview panel.",
        });
      }
      const comment = input.comment?.trim() ? input.comment.trim() : null;
      return ctx.db.interviewVote.upsert({
        where: {
          applicationId_tutorId: {
            applicationId: input.applicationId,
            tutorId: ctx.session.tutorId,
          },
        },
        update: { accept: input.accept, comment },
        create: {
          applicationId: input.applicationId,
          tutorId: ctx.session.tutorId,
          accept: input.accept,
          comment,
        },
      });
    }),

  /**
   * Record the head interviewer's final decision (accept -> ACCEPTED, reject -> REJECTED),
   * with a required brief comment. Only the HEAD of the panel may decide.
   */
  decideInterview: tutorProcedure
    .input(
      z.object({
        applicationId: z.string().min(1),
        accept: z.boolean(),
        comment: z.string().trim().min(1, "Add a brief comment").max(500),
        expectedUpdatedAt,
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
          message: "Only the head interviewer can record the decision.",
        });
      }

      const prev = await ctx.db.tutorApplication.findUnique({
        where: { id: input.applicationId },
        select: { status: true },
      });

      // Concurrency guard — rejected if the application changed since it was loaded.
      const res = await ctx.db.tutorApplication.updateMany({
        where: { id: input.applicationId, updatedAt: input.expectedUpdatedAt },
        data: {
          status: input.accept ? "ACCEPTED" : "REJECTED",
          decisionComment: input.comment,
          decidedAt: new Date(),
          decidedByTutorId: ctx.session.tutorId,
        },
      });
      if (res.count === 0) staleConflict();

      // On the transition to ACCEPTED, issue a registration code so the applicant can
      // self-register a verified account (see promoteApplicantToTutor).
      if (input.accept && prev?.status !== "ACCEPTED") {
        await promoteApplicantToTutor(input.applicationId);
      }
      return { ok: true };
    }),

  // --------------------------------------------------------------------------
  // Lifecycle requests (opt-out / reentry) — a tutor manages their own membership.
  // --------------------------------------------------------------------------
  /** The signed-in tutor's open (PENDING) lifecycle request, if any, plus eligibility timing. */
  myStatusRequest: tutorProcedure.query(async ({ ctx }) => {
    const req = await ctx.db.tutorStatusRequest.findFirst({
      where: { tutorId: ctx.session.tutorId, state: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, eligibleAt: true, reason: true, createdAt: true },
    });
    return req;
  }),

  /**
   * Submit an opt-out request. Requires an ACTIVE tutor with no other open request. A one-week
   * cooldown (`eligibleAt`) must pass before an admin can approve it; the tutor may recall it
   * meanwhile. The tutor stays ACTIVE until an admin approves.
   */
  requestOptOut: activeTutorProcedure
    .input(z.object({ reason: z.string().trim().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const open = await ctx.db.tutorStatusRequest.findFirst({
        where: { tutorId: ctx.session.tutorId, state: "PENDING" },
        select: { id: true },
      });
      if (open) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already have an open request." });
      }
      const eligibleAt = new Date(Date.now() + OPT_OUT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      const req = await ctx.db.tutorStatusRequest.create({
        data: {
          tutorId: ctx.session.tutorId,
          kind: "OPT_OUT",
          eligibleAt,
          reason: input.reason?.trim() ? input.reason.trim() : null,
        },
        select: { id: true },
      });
      const tutor = await ctx.db.tutor.findUnique({
        where: { id: ctx.session.tutorId },
        select: { englishName: true },
      });
      await notifyAdmins({
        title: "Tutor opt-out request",
        body: `${tutor?.englishName ?? "A tutor"} asked to opt out (review after the cooldown).`,
        link: "/admin/tutor-requests",
      });
      return { ok: true, id: req.id, eligibleAt };
    }),

  /**
   * Request reentry to the program. Requires an OPTED_OUT tutor with no other open request.
   * No cooldown — an admin can approve immediately, flipping the tutor back to ACTIVE.
   */
  requestReentry: tutorProcedure
    .input(z.object({ reason: z.string().trim().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const tutor = await ctx.db.tutor.findUniqueOrThrow({
        where: { id: ctx.session.tutorId },
        select: { status: true, englishName: true },
      });
      if (tutor.status !== "OPTED_OUT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only opted-out tutors can request reentry.",
        });
      }
      const open = await ctx.db.tutorStatusRequest.findFirst({
        where: { tutorId: ctx.session.tutorId, state: "PENDING" },
        select: { id: true },
      });
      if (open) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already have an open request." });
      }
      const req = await ctx.db.tutorStatusRequest.create({
        data: {
          tutorId: ctx.session.tutorId,
          kind: "REENTRY",
          reason: input.reason?.trim() ? input.reason.trim() : null,
        },
        select: { id: true },
      });
      await notifyAdmins({
        title: "Tutor reentry request",
        body: `${tutor.englishName} asked to rejoin the program.`,
        link: "/admin/tutor-requests",
      });
      return { ok: true, id: req.id };
    }),

  /** Recall (cancel) the tutor's own open request while it is still PENDING. */
  recallStatusRequest: tutorProcedure
    .input(z.object({ requestId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.tutorStatusRequest.updateMany({
        where: { id: input.requestId, tutorId: ctx.session.tutorId, state: "PENDING" },
        data: { state: "RECALLED", resolvedAt: new Date(), resolvedByName: "self" },
      });
      if (res.count === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No open request to recall." });
      }
      return { ok: true };
    }),

  // --------------------------------------------------------------------------
  // Tutor meetings — self-excuse an upcoming absence (up to 30 min before the meeting).
  // --------------------------------------------------------------------------
  /** Upcoming meetings with this tutor's excuse state and whether they can still excuse. */
  myMeetings: tutorProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const meetings = await ctx.db.tutorMeeting.findMany({
      where: { date: { gte: now } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        title: true,
        date: true,
        attendances: {
          where: { tutorId: ctx.session.tutorId },
          select: { status: true, reason: true, excusedAt: true },
        },
      },
    });
    return meetings.map((m) => {
      const mine = m.attendances[0] ?? null;
      return {
        id: m.id,
        title: m.title,
        date: m.date,
        reason: mine?.reason ?? null,
        excused: mine?.status === "EXCUSED_ABSENT" && mine.excusedAt != null,
        // True until the cutoff (30 min before the meeting) passes.
        canExcuse: now.getTime() <= m.date.getTime() - MEETING_EXCUSE_CUTOFF_MIN * 60_000,
      };
    });
  }),

  /**
   * Self-excuse an absence from an upcoming meeting (sets the tutor's attendance to EXCUSED_ABSENT
   * with a reason + timestamp). Allowed only until 30 min before the meeting; an active tutor only.
   * Surfaces to coordinators on /admin/meetings (panel + notification). Clears any stray
   * unexcused-absence deduction for this meeting.
   */
  excuseMeeting: activeTutorProcedure
    .input(z.object({ meetingId: z.string().cuid(), reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.tutorMeeting.findUnique({
        where: { id: input.meetingId },
        select: { id: true, title: true, date: true },
      });
      if (!meeting) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found." });
      if (Date.now() > meeting.date.getTime() - MEETING_EXCUSE_CUTOFF_MIN * 60_000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Too late to excuse — this meeting is within 30 minutes.",
        });
      }
      const reason = input.reason?.trim() ? input.reason.trim() : null;
      await ctx.db.$transaction(async (tx) => {
        await tx.meetingAttendance.upsert({
          where: { meetingId_tutorId: { meetingId: input.meetingId, tutorId: ctx.session.tutorId } },
          update: { status: "EXCUSED_ABSENT", reason, excusedAt: new Date() },
          create: {
            meetingId: input.meetingId,
            tutorId: ctx.session.tutorId,
            status: "EXCUSED_ABSENT",
            reason,
            excusedAt: new Date(),
          },
        });
        // An excused absence carries no deduction — remove any prior unexcused-absence punishment.
        await tx.serviceHourAdjustment.deleteMany({
          where: { id: `mtgabs_${input.meetingId}_${ctx.session.tutorId}` },
        });
      });
      const tutor = await ctx.db.tutor.findUnique({
        where: { id: ctx.session.tutorId },
        select: { englishName: true },
      });
      await notifyAdmins({
        title: "Meeting absence excused",
        body: `${tutor?.englishName ?? "A tutor"} will miss "${meeting.title}".`,
        link: "/admin/meetings",
      });
      return { ok: true };
    }),

  /** Cancel a self-excuse (only one the tutor submitted, and only while still >30 min out). */
  cancelMeetingExcuse: activeTutorProcedure
    .input(z.object({ meetingId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.tutorMeeting.findUnique({
        where: { id: input.meetingId },
        select: { date: true },
      });
      if (!meeting) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found." });
      if (Date.now() > meeting.date.getTime() - MEETING_EXCUSE_CUTOFF_MIN * 60_000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Too late to change — this meeting is within 30 minutes.",
        });
      }
      // Only remove a tutor-submitted excuse (excusedAt set), never an admin-recorded status.
      await ctx.db.meetingAttendance.deleteMany({
        where: {
          meetingId: input.meetingId,
          tutorId: ctx.session.tutorId,
          excusedAt: { not: null },
        },
      });
      return { ok: true };
    }),
});
