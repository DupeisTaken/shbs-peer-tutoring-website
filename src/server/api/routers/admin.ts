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
import { notifyTutors, notifyUsers } from "~/server/notifications/create";
import { standingFromCounts } from "~/lib/discipline";
import {
  QUARTERS,
  type Quarter,
  crossesSemester,
  crossesYear,
  nextPeriod,
  quarterSemester,
  semesterQuarters,
} from "~/lib/period";
import { getActivePeriod, getActivePeriodOrNull } from "~/server/period";
import { applyUndo, recordAudit } from "~/server/audit/log";
import { expectedUpdatedAt, staleConflict } from "~/server/concurrency";

const monthInput = z.string().regex(/^\d{4}-\d{2}$/);
const cuid = z.string().min(1);

/** Trim a string and collapse empty/whitespace-only values to null. */
function blankToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

/**
 * Look up a time slot and return its day/start/end. Pairings are scheduled by slot, so the
 * slot is the source of truth for the schedule — fail loudly if it's missing.
 */
async function resolveSlot(
  db: { timeSlot: { findUnique: (args: { where: { id: string } }) => Promise<{ dayOfWeek: number; startMin: number; endMin: number } | null> } },
  timeSlotId: string,
) {
  const slot = await db.timeSlot.findUnique({ where: { id: timeSlotId } });
  if (!slot) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a valid time slot." });
  }
  return slot;
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

export const adminRouter = createTRPCRouter({
  // --------------------------------------------------------------------------
  // Reference lists
  // --------------------------------------------------------------------------
  tutors: adminProcedure.query(({ ctx }) =>
    ctx.db.tutor.findMany({ orderBy: { englishName: "asc" } }),
  ),
  /**
   * Per-tutee stats for the admin tutees view: session attendance + discipline standing.
   * Aggregated in Postgres (two `GROUP BY`s) so this returns ~one row per tutee instead of
   * pulling every session-tutee / card row into Node — keeps it cheap as history grows.
   */
  tuteeStats: adminProcedure.query(async ({ ctx }) => {
    const [sessionGroups, cardGroups] = await Promise.all([
      ctx.db.sessionTutee.groupBy({ by: ["tuteeId", "status"], _count: { _all: true } }),
      ctx.db.disciplinaryCard.groupBy({
        by: ["tuteeId", "color", "reviewStatus"],
        _count: { _all: true },
      }),
    ]);

    type Agg = {
      sessions: number;
      present: number;
      excused: number;
      unexcused: number;
      validYellow: number;
      validRed: number;
      pendingYellow: number;
      pendingRed: number;
    };
    const byTutee = new Map<string, Agg>();
    const get = (id: string): Agg => {
      const existing = byTutee.get(id);
      if (existing) return existing;
      const fresh: Agg = {
        sessions: 0, present: 0, excused: 0, unexcused: 0,
        validYellow: 0, validRed: 0, pendingYellow: 0, pendingRed: 0,
      };
      byTutee.set(id, fresh);
      return fresh;
    };

    for (const g of sessionGroups) {
      const e = get(g.tuteeId);
      const n = g._count._all;
      e.sessions += n;
      if (g.status === "PRESENT") e.present += n;
      else if (g.status === "EXCUSED_ABSENT") e.excused += n;
      else e.unexcused += n;
    }
    for (const g of cardGroups) {
      const e = get(g.tuteeId);
      const n = g._count._all;
      if (g.reviewStatus === "VALID") {
        if (g.color === "YELLOW") e.validYellow += n;
        else e.validRed += n;
      } else if (g.reviewStatus === "PENDING") {
        if (g.color === "YELLOW") e.pendingYellow += n;
        else e.pendingRed += n;
      }
      // INVALID cards are ignored (don't count toward standing).
    }

    const result: Record<
      string,
      {
        sessions: number;
        present: number;
        excused: number;
        unexcused: number;
        validYellow: number;
        validRed: number;
        effectiveReds: number;
        removalPending: boolean;
      }
    > = {};
    for (const [id, e] of byTutee) {
      const s = standingFromCounts(e);
      result[id] = {
        sessions: e.sessions,
        present: e.present,
        excused: e.excused,
        unexcused: e.unexcused,
        validYellow: s.validYellow,
        validRed: s.validRed,
        effectiveReds: s.effectiveReds,
        removalPending: s.removalPending,
      };
    }
    return result;
  }),

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
    ctx.db.course.findMany({
      orderBy: { name: "asc" },
      include: { level: { select: { id: true, name: true } } },
    }),
  ),

  /** The admin-managed level catalogue (AP / Honors / Standard / …), ordered by rank. */
  courseLevels: adminProcedure.query(({ ctx }) =>
    ctx.db.courseLevel.findMany({ orderBy: [{ rank: "asc" }, { name: "asc" }] }),
  ),

  createCourseLevel: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(60),
        rank: z.number().int().default(0),
        apScored: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.courseLevel.create({ data: input }),
    ),

  updateCourseLevel: adminProcedure
    .input(
      z.object({
        id: cuid,
        name: z.string().trim().min(1).max(60).optional(),
        rank: z.number().int().optional(),
        apScored: z.boolean().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return ctx.db.courseLevel.update({ where: { id }, data });
    }),

  deleteCourseLevel: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      // Detach any courses on this level first (revertible: reassign on the courses page).
      await ctx.db.course.updateMany({
        where: { levelId: input.id },
        data: { levelId: null },
      });
      return ctx.db.courseLevel.delete({ where: { id: input.id } });
    }),
  timeSlots: adminProcedure.query(({ ctx }) =>
    ctx.db.timeSlot.findMany({
      orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
    }),
  ),

  // --------------------------------------------------------------------------
  // Pairings (+ room grid)
  // --------------------------------------------------------------------------
  // "Current pairings" = those in the active term. A program refresh activates a new term, so
  // the board clears automatically; past terms' pairings remain for history but aren't shown here.
  pairings: adminProcedure.query(({ ctx }) =>
    ctx.db.pairing.findMany({
      where: { term: { active: true } },
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
        roomId: cuid.optional(),
        // Pairings are scheduled by picking a published time slot — the slot is the single
        // source of truth for day/start/end (no free-form time entry).
        timeSlotId: cuid,
        subject: z.string().min(1),
        tuteeIds: z.array(cuid).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // New pairings always belong to the active program period.
      const [slot, period] = await Promise.all([
        resolveSlot(ctx.db, input.timeSlotId),
        getActivePeriod(ctx.db),
      ]);
      const { tuteeIds, ...data } = input;
      return ctx.db.pairing.create({
        data: {
          ...data,
          termId: period.termId,
          dayOfWeek: slot.dayOfWeek,
          startMin: slot.startMin,
          endMin: slot.endMin,
          tutees: { create: tuteeIds.map((tuteeId) => ({ tuteeId })) },
        },
      });
    }),

  updatePairing: adminProcedure
    .input(
      z.object({
        id: cuid,
        tutorId: cuid,
        roomId: cuid.nullable().optional(),
        timeSlotId: cuid,
        subject: z.string().min(1),
        tuteeIds: z.array(cuid),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const slot = await resolveSlot(ctx.db, input.timeSlotId);
      const { id, tuteeIds, roomId, ...data } = input;
      // Replace roster atomically; day/start/end follow the chosen slot.
      return ctx.db.$transaction(async (tx) => {
        await tx.pairingTutee.deleteMany({ where: { pairingId: id } });
        return tx.pairing.update({
          where: { id },
          data: {
            ...data,
            roomId: roomId ?? null,
            dayOfWeek: slot.dayOfWeek,
            startMin: slot.startMin,
            endMin: slot.endMin,
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
    .query(({ ctx, input }) => {
      // Default to the current month so this never loads the program's entire history.
      // The submissions page lets a coordinator pick any month; broader views get pagination later.
      const month = input?.month ?? monthKey(new Date());
      return ctx.db.session.findMany({
        where: {
          month,
          ...(input?.tutorId ? { tutorId: input.tutorId } : {}),
        },
        orderBy: { date: "desc" },
        include: {
          tutor: { select: { englishName: true } },
          pairing: { select: { subject: true } },
          tutees: { include: { tutee: { select: { englishName: true } } } },
        },
      });
    }),

  // --------------------------------------------------------------------------
  // Program period (current quarter/semester) + history
  // --------------------------------------------------------------------------
  /** The active period plus a preview of what the next refresh would advance to. */
  currentPeriod: adminProcedure.query(async ({ ctx }) => {
    const active = await getActivePeriodOrNull(ctx.db);
    if (!active) return null;
    const np = nextPeriod({ schoolYear: active.schoolYear, quarter: active.quarter });
    return {
      schoolYear: active.schoolYear,
      quarter: active.quarter,
      semester: active.semester,
      name: active.name,
      next: {
        schoolYear: np.schoolYear,
        quarter: np.quarter,
        semester: quarterSemester(np.quarter),
        name: `${np.schoolYear} ${np.quarter}`,
        crossesSemester: crossesSemester(
          { schoolYear: active.schoolYear, quarter: active.quarter },
          np,
        ),
        crossesYear: crossesYear(
          { schoolYear: active.schoolYear, quarter: active.quarter },
          np,
        ),
      },
    };
  }),

  /** Every program period on record (one per quarter ever activated) — for history selectors. */
  periods: adminProcedure.query(({ ctx }) =>
    ctx.db.term.findMany({
      orderBy: [{ schoolYear: "desc" }, { quarter: "desc" }],
      select: { schoolYear: true, quarter: true, active: true },
    }),
  ),

  /**
   * Per-tutor service hours + program attendance for a period. Scope resolution:
   *   quarter given -> that quarter; else semester given -> that semester's two quarters;
   *   else a schoolYear given (no semester/quarter) -> the whole year;
   *   else (no input) -> the active period's current semester (the live "this semester" view).
   */
  periodSummary: adminProcedure
    .input(
      z
        .object({
          schoolYear: z.string().optional(),
          semester: z.enum(["S1", "S2"]).optional(),
          quarter: z.enum(QUARTERS).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const active = await getActivePeriod(ctx.db);
      const schoolYear = input?.schoolYear ?? active.schoolYear;
      let quarters: Quarter[];
      let label: string;
      if (input?.quarter) {
        quarters = [input.quarter];
        label = `${schoolYear} ${input.quarter}`;
      } else if (input?.semester) {
        quarters = semesterQuarters(input.semester);
        label = `${schoolYear} ${input.semester}`;
      } else if (input?.schoolYear) {
        quarters = [...QUARTERS];
        label = schoolYear;
      } else {
        quarters = semesterQuarters(active.semester);
        label = `${schoolYear} ${active.semester}`;
      }
      const periodWhere = { schoolYear, quarter: { in: quarters } };

      const [tutors, sessionAgg, adjustments, attendance] = await Promise.all([
        ctx.db.tutor.findMany({ orderBy: { englishName: "asc" } }),
        ctx.db.session.groupBy({
          by: ["tutorId"],
          where: periodWhere,
          _sum: { shCount: true },
          _count: { _all: true },
        }),
        ctx.db.serviceHourAdjustment.groupBy({
          by: ["tutorId", "type"],
          where: periodWhere,
          _sum: { amount: true },
        }),
        ctx.db.sessionTutee.groupBy({
          by: ["status"],
          where: { session: periodWhere },
          _count: { _all: true },
        }),
      ]);

      const earnedBy = new Map(sessionAgg.map((s) => [s.tutorId, s._sum.shCount ?? 0]));
      const sessionsBy = new Map(sessionAgg.map((s) => [s.tutorId, s._count._all]));
      const punishBy = new Map<string, number>();
      const extraBy = new Map<string, number>();
      for (const a of adjustments) {
        const target = a.type === "PUNISHMENT" ? punishBy : extraBy;
        target.set(a.tutorId, (target.get(a.tutorId) ?? 0) + (a._sum.amount ?? 0));
      }

      const rows = tutors.map((t) => {
        const earned = earnedBy.get(t.id) ?? 0;
        const punishments = punishBy.get(t.id) ?? 0;
        const extras = extraBy.get(t.id) ?? 0;
        return {
          tutorId: t.id,
          englishName: t.englishName,
          active: t.active,
          earned,
          extras,
          punishments,
          total: earned - punishments + extras,
          sessions: sessionsBy.get(t.id) ?? 0,
        };
      });

      const att = { present: 0, excused: 0, unexcused: 0 };
      for (const g of attendance) {
        if (g.status === "PRESENT") att.present = g._count._all;
        else if (g.status === "EXCUSED_ABSENT") att.excused = g._count._all;
        else att.unexcused = g._count._all;
      }

      const totals = rows.reduce(
        (acc, r) => ({
          earned: acc.earned + r.earned,
          extras: acc.extras + r.extras,
          punishments: acc.punishments + r.punishments,
          total: acc.total + r.total,
          sessions: acc.sessions + r.sessions,
        }),
        { earned: 0, extras: 0, punishments: 0, total: 0, sessions: 0 },
      );

      return {
        scope: { schoolYear, quarters, label },
        rows,
        totals: { ...totals, ...att },
      };
    }),

  /**
   * Refresh the program: advance to the next quarter (Q4 -> next year's Q1), clear the current
   * pairings (the new term starts empty; past pairings + their attendance stay for history), and
   * archive every pending/active tutee to INACTIVE so they must sign up again to continue. Service
   * hours / attendance are period-stamped and untouched — the "this semester" total just rolls over
   * when the refresh crosses a semester boundary. Requires typing REFRESH to confirm.
   */
  refresh: adminProcedure
    .input(
      z.object({
        confirm: z.string(),
        // Active tutors the crew marked unavailable in the semester-rollover review — archived.
        // Ignored unless the refresh actually crosses a semester.
        unavailableTutorIds: z.array(cuid).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.confirm.trim().toUpperCase() !== "REFRESH") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Type REFRESH to confirm." });
      }
      const active = await getActivePeriod(ctx.db);
      const from = { schoolYear: active.schoolYear, quarter: active.quarter };
      const np = nextPeriod(from);
      const name = `${np.schoolYear} ${np.quarter}`;
      const semesterCross = crossesSemester(from, np);
      const yearCross = crossesYear(from, np);
      const unavailableIds = semesterCross ? [...new Set(input.unavailableTutorIds ?? [])] : [];

      const out = await ctx.db.$transaction(async (tx) => {
        await tx.term.updateMany({ where: { active: true }, data: { active: false } });
        const term = await tx.term.upsert({
          where: { schoolYear_quarter: { schoolYear: np.schoolYear, quarter: np.quarter } },
          update: { active: true },
          create: { schoolYear: np.schoolYear, quarter: np.quarter, name, active: true },
        });
        const tutees = await tx.tutee.updateMany({
          where: { status: { in: ["PENDING", "ACTIVE"] } },
          data: { status: "INACTIVE" },
        });

        // Semester rollover: archive tutors the crew flagged as no longer available.
        let archivedUnavailable = 0;
        if (unavailableIds.length > 0) {
          const r = await tx.tutor.updateMany({
            where: { id: { in: unavailableIds }, active: true },
            data: { active: false },
          });
          archivedUnavailable = r.count;
        }

        // Year rollover: G12 (and up) graduate -> archived; everyone else ages up one grade.
        let graduated = 0;
        let aged = 0;
        if (yearCross) {
          const grad = await tx.tutor.updateMany({
            where: { active: true, gradeLevel: { gte: 12 } },
            data: { active: false },
          });
          graduated = grad.count;
          const age = await tx.tutor.updateMany({
            where: { active: true, gradeLevel: { not: null } },
            data: { gradeLevel: { increment: 1 } },
          });
          aged = age.count;
        }

        return {
          termId: term.id,
          archivedTutees: tutees.count,
          archivedUnavailable,
          graduated,
          aged,
        };
      });

      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action:
          `Refreshed program to ${name} — archived ${out.archivedTutees} tutee(s)` +
          (out.archivedUnavailable ? `, ${out.archivedUnavailable} unavailable tutor(s)` : "") +
          (yearCross ? `, graduated ${out.graduated} tutor(s), aged up ${out.aged}` : "") +
          "; cleared current pairings",
        entity: "Term",
        entityId: out.termId,
      });
      return {
        schoolYear: np.schoolYear,
        quarter: np.quarter,
        name,
        crossedSemester: semesterCross,
        crossedYear: yearCross,
        archivedTutees: out.archivedTutees,
        archivedUnavailableTutors: out.archivedUnavailable,
        graduatedTutors: out.graduated,
        agedTutors: out.aged,
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
        gradeLevel: z.number().int().min(6).max(12).nullable().optional(),
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
          gradeLevel: input.gradeLevel ?? null,
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
        gradeLevel: z.number().int().min(6).max(12).nullable().optional(),
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
          ...(input.gradeLevel === undefined ? {} : { gradeLevel: input.gradeLevel }),
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

  /**
   * Assign a pending signup's course choices to tutors in one go — e.g. their first choice
   * (Chemistry) to tutor A and second choice (Biology) to tutor B. Creates a pairing per
   * assignment and flips the tutee ACTIVE. Each tutor then picks the real time slot.
   */
  assignSignup: adminProcedure
    .input(
      z.object({
        tuteeId: cuid,
        expectedUpdatedAt,
        assignments: z
          .array(z.object({ subject: z.string().trim().min(1), tutorId: cuid }))
          .min(1, "Pick a tutor for at least one course"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // New pairings land in the active program period.
      const period = await getActivePeriod(ctx.db);
      return ctx.db.$transaction(async (tx) => {
        // Concurrency guard: only one coordinator may assign a still-PENDING signup. The
        // version match + PENDING status both must hold, or another coordinator got there first.
        const flip = await tx.tutee.updateMany({
          where: { id: input.tuteeId, status: "PENDING", updatedAt: input.expectedUpdatedAt },
          data: { status: "ACTIVE" },
        });
        if (flip.count === 0) staleConflict();

        for (const a of input.assignments) {
          await tx.pairing.create({
            data: {
              tutorId: a.tutorId,
              termId: period.termId,
              subject: a.subject,
              // Placeholder schedule — the tutor sets the real time when they pick a slot.
              dayOfWeek: 1,
              startMin: 15 * 60 + 30,
              endMin: 16 * 60 + 30,
              tutees: { create: [{ tuteeId: input.tuteeId }] },
            },
          });
        }
        return { ok: true };
      });
    }),

  /** Quick status change (e.g. approve a PENDING signup → ACTIVE). */
  setTuteeStatus: adminProcedure
    .input(z.object({ id: cuid, status: z.enum(TUTEE_STATUS), expectedUpdatedAt }))
    .mutation(async ({ ctx, input }) => {
      const prev = await ctx.db.tutee.findUniqueOrThrow({
        where: { id: input.id },
        select: { status: true, englishName: true },
      });
      const updated = await ctx.db.tutee.updateMany({
        where: { id: input.id, updatedAt: input.expectedUpdatedAt },
        data: { status: input.status },
      });
      if (updated.count === 0) staleConflict();
      if (prev.status !== input.status) {
        await recordAudit({
          userId: ctx.session.user.id,
          userName: ctx.session.user.name,
          action: `Set ${prev.englishName} to ${input.status.toLowerCase()}`,
          entity: "Tutee",
          entityId: input.id,
          undo: { kind: "tutee.status", payload: { id: input.id, status: prev.status } },
        });
      }
      return { ok: true };
    }),

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
    .input(z.object({ name: z.string().trim().min(1), levelId: cuid.nullable().optional() }))
    .mutation(({ ctx, input }) =>
      ctx.db.course.create({
        data: { name: input.name, levelId: input.levelId ?? null },
      }),
    ),

  updateCourse: adminProcedure
    .input(
      z.object({
        id: cuid,
        name: z.string().trim().min(1),
        levelId: cuid.nullable().optional(),
        active: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.course.update({
        where: { id: input.id },
        data: {
          name: input.name,
          ...(input.levelId === undefined ? {} : { levelId: input.levelId }),
          active: input.active,
        },
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
      const course = await ctx.db.course.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, name: true, levelId: true, active: true },
      });
      const deleted = await ctx.db.course.delete({ where: { id: input.id } });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Deleted course "${course.name}"`,
        entity: "Course",
        entityId: course.id,
        undo: { kind: "course.restore", payload: course },
      });
      return deleted;
    }),

  /** Batch-edit selected courses: set their level and/or active flag in one go. */
  batchUpdateCourses: adminProcedure
    .input(
      z.object({
        ids: z.array(cuid).min(1),
        levelId: cuid.nullable().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.course.updateMany({
        where: { id: { in: input.ids } },
        data: {
          ...(input.levelId === undefined ? {} : { levelId: input.levelId }),
          ...(input.active === undefined ? {} : { active: input.active }),
        },
      }),
    ),

  /** Bulk-create courses (e.g. from a CSV upload). Duplicate names are skipped. The optional
   *  level column is matched by name against the existing level catalogue (case-insensitive). */
  importCourses: adminProcedure
    .input(
      z.object({
        courses: z
          .array(z.object({ name: z.string().trim().min(1), level: z.string().trim().optional() }))
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const levels = await ctx.db.courseLevel.findMany({ select: { id: true, name: true } });
      const levelByName = new Map(levels.map((l) => [l.name.toLowerCase(), l.id]));

      // De-dupe by name within the batch, then let the DB skip names that already exist.
      const seen = new Set<string>();
      const data: { name: string; levelId: string | null }[] = [];
      for (const c of input.courses) {
        const key = c.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        data.push({
          name: c.name,
          levelId: c.level ? (levelByName.get(c.level.toLowerCase()) ?? null) : null,
        });
      }
      const result = await ctx.db.course.createMany({ data, skipDuplicates: true });
      return { created: result.count, received: input.courses.length };
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
  // Service-hour adjustments (per tutor, per month). Tutor "punishments" are PUNISHMENT-type
  // adjustments (they deduct hours); tutee discipline lives in the card system instead.
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
    .mutation(async ({ ctx, input }) => {
      // Stamp the active program period so the adjustment counts toward the right semester.
      const period = await getActivePeriod(ctx.db);
      return ctx.db.serviceHourAdjustment.create({
        data: { ...input, schoolYear: period.schoolYear, quarter: period.quarter },
      });
    }),

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
          include: {
            course: { select: { name: true, level: { select: { name: true } } } },
          },
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
        expectedUpdatedAt,
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
      const app = await ctx.db.tutorApplication.findUnique({
        where: { id: input.applicationId },
        select: { name: true },
      });
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
      const found = await ctx.db.tutor.count({ where: { id: { in: tutorIds } } });
      if (found !== tutorIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown tutor selected." });
      }

      await ctx.db.$transaction(async (tx) => {
        // Concurrency guard on the application — rolls back the panel edit on a stale write.
        const upd = await tx.tutorApplication.updateMany({
          where: { id: input.applicationId, updatedAt: input.expectedUpdatedAt },
          data: { status: "INTERVIEW" },
        });
        if (upd.count === 0) staleConflict();
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
      });
      // Notify the assigned panelists.
      await notifyTutors(tutorIds, {
        title: "You're on an interview panel",
        body: `Applicant: ${app.name}`,
        link: "/dashboard",
      });
      return { ok: true };
    }),

  setApplicationStatus: adminProcedure
    .input(z.object({ id: cuid, status: z.enum(TUTOR_APP_STATUS), expectedUpdatedAt }))
    .mutation(async ({ ctx, input }) => {
      const prev = await ctx.db.tutorApplication.findUnique({
        where: { id: input.id },
        select: { status: true },
      });
      const updated = await ctx.db.tutorApplication.updateMany({
        where: { id: input.id, updatedAt: input.expectedUpdatedAt },
        data: { status: input.status },
      });
      if (updated.count === 0) staleConflict();
      // On the transition to ACCEPTED, add the applicant to the tutors list.
      if (input.status === "ACCEPTED" && prev?.status !== "ACCEPTED") {
        await promoteApplicantToTutor(input.id);
      }
      if (prev && prev.status !== input.status) {
        await recordAudit({
          userId: ctx.session.user.id,
          userName: ctx.session.user.name,
          action: `Set application status to ${input.status.toLowerCase()}`,
          entity: "TutorApplication",
          entityId: input.id,
          undo: { kind: "application.status", payload: { id: input.id, status: prev.status } },
        });
      }
      return { ok: true };
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
    .mutation(async ({ ctx, input }) => {
      const announcement = await ctx.db.announcement.create({
        data: {
          title: input.title,
          body: input.body,
          pinned: input.pinned,
          createdById: ctx.session.user.id,
        },
      });
      // Notify everyone else of the new announcement.
      const users = await ctx.db.user.findMany({
        where: { id: { not: ctx.session.user.id } },
        select: { id: true },
      });
      await notifyUsers(
        users.map((u) => u.id),
        { title: `📣 ${input.title}`, body: input.body, link: "/dashboard" },
      );
      return announcement;
    }),

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
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.db.announcement.findUniqueOrThrow({
        where: { id: input.id },
        select: {
          id: true,
          title: true,
          body: true,
          pinned: true,
          active: true,
          createdById: true,
        },
      });
      const deleted = await ctx.db.announcement.delete({ where: { id: input.id } });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Deleted announcement "${a.title}"`,
        entity: "Announcement",
        entityId: a.id,
        undo: { kind: "announcement.restore", payload: a },
      });
      return deleted;
    }),

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
        updatedAt: true,
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
        expectedUpdatedAt,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prev = await ctx.db.disciplinaryCard.findUniqueOrThrow({
        where: { id: input.id },
        select: { reviewStatus: true, reviewNote: true, tutee: { select: { englishName: true } } },
      });
      const res = await ctx.db.disciplinaryCard.updateMany({
        where: { id: input.id, updatedAt: input.expectedUpdatedAt },
        data: {
          reviewStatus: input.reviewStatus,
          reviewNote: input.reviewNote?.trim() ? input.reviewNote.trim() : null,
          reviewedById: ctx.session.user.id,
          reviewedAt: new Date(),
        },
      });
      if (res.count === 0) staleConflict();
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Flagged ${prev.tutee.englishName}'s card ${input.reviewStatus.toLowerCase()}`,
        entity: "DisciplinaryCard",
        entityId: input.id,
        undo: {
          kind: "card.review",
          payload: { id: input.id, reviewStatus: prev.reviewStatus, reviewNote: prev.reviewNote },
        },
      });
      return { ok: true };
    }),

  // --------------------------------------------------------------------------
  // Audit log + undo
  // --------------------------------------------------------------------------
  auditLog: adminProcedure.query(({ ctx }) =>
    ctx.db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ),

  undoAudit: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.auditLog.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, undone: true, undoData: true },
      });
      if (entry.undone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already undone." });
      }
      if (entry.undoData == null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This action can't be undone automatically.",
        });
      }
      let ok = false;
      try {
        ok = await applyUndo(entry.undoData);
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Undo failed — the item may have changed since.",
        });
      }
      if (!ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Undo data was invalid." });
      }
      return ctx.db.auditLog.update({
        where: { id: entry.id },
        data: { undone: true, undoneAt: new Date() },
      });
    }),
});
