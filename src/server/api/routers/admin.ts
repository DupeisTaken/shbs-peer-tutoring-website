import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  adminOnlyProcedure,
  adminProcedure,
  createTRPCRouter,
  headProcedure,
  viewerProcedure,
} from "~/server/api/trpc";
import { monthKey } from "~/lib/service-hours";
import { defaultUsername, ensureUniqueUsername } from "~/server/auth/username";
import { issueTutorSetupLink } from "~/server/auth/password-reset";
import { issueRegistrationCode } from "~/server/auth/registration";
import { promoteApplicantToTutor } from "~/server/tutors/promote";
import { notifyAdmins, notifyTutors, notifyUsers } from "~/server/notifications/create";
import { standingFromCounts } from "~/lib/discipline";
import {
  QUARTERS,
  type Quarter,
  crossesSemester,
  crossesYear,
  graduationYear,
  nextPeriod,
  quarterSemester,
  semesterQuarters,
} from "~/lib/period";
import { getActivePeriod, getActivePeriodOrNull } from "~/server/period";
import type { db as dbClient } from "~/server/db";
import { applyUndo, recordAudit } from "~/server/audit/log";
import { expectedUpdatedAt, staleConflict } from "~/server/concurrency";

/** Class-of year for a grade in the active school year, or null when neither is known. */
async function activeGradYear(
  db: typeof dbClient,
  gradeLevel?: number | null,
): Promise<number | null> {
  if (gradeLevel == null) return null;
  const term = await db.term.findFirst({
    where: { active: true },
    select: { schoolYear: true },
  });
  return term ? graduationYear(gradeLevel, term.schoolYear) : null;
}

const monthInput = z.string().regex(/^\d{4}-\d{2}$/);
const cuid = z.string().min(1);

/** Default policy language — always present, shown as the fallback when a translation is missing. */
const DEFAULT_POLICY_LOCALE = "en";

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
/** Service hours docked per unexcused tutor-meeting absence (materialised as a PUNISHMENT adj). */
const MEETING_ABSENCE_DEDUCTION = 0.125;
const TUTEE_STATUS = ["PENDING", "ACTIVE", "INACTIVE"] as const;
const TUTOR_STATUS = ["ACTIVE", "PENDING", "GRADUATED", "OPTED_OUT", "ARCHIVED"] as const;
const TUTOR_APP_STATUS = ["PENDING", "INTERVIEW", "ACCEPTED", "REJECTED"] as const;

export const adminRouter = createTRPCRouter({
  // --------------------------------------------------------------------------
  // Reference lists
  // --------------------------------------------------------------------------
  tutors: viewerProcedure.query(({ ctx }) =>
    ctx.db.tutor.findMany({
      orderBy: { englishName: "asc" },
      // Login/account status so the roster can show who still needs to set up their account.
      include: {
        user: { select: { id: true, emailVerifiedAt: true, mustChangePassword: true } },
      },
    }),
  ),
  /**
   * Per-tutee stats for the admin tutees view: session attendance + discipline standing.
   * Aggregated in Postgres (two `GROUP BY`s) so this returns ~one row per tutee instead of
   * pulling every session-tutee / card row into Node — keeps it cheap as history grows.
   */
  tuteeStats: viewerProcedure.query(async ({ ctx }) => {
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

  tutees: viewerProcedure.query(({ ctx }) =>
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
  rooms: viewerProcedure.query(({ ctx }) =>
    ctx.db.room.findMany({
      orderBy: { name: "asc" },
      include: {
        unavailabilities: {
          orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
        },
      },
    }),
  ),
  terms: viewerProcedure.query(({ ctx }) =>
    ctx.db.term.findMany({ orderBy: { createdAt: "desc" } }),
  ),
  subjects: viewerProcedure.query(({ ctx }) =>
    ctx.db.subject.findMany({
      orderBy: { name: "asc" },
      include: { level: { select: { id: true, name: true } } },
    }),
  ),

  /** The admin-managed level catalogue (AP / Honors / Standard / …), ordered by rank. */
  subjectLevels: viewerProcedure.query(({ ctx }) =>
    ctx.db.subjectLevel.findMany({ orderBy: [{ rank: "asc" }, { name: "asc" }] }),
  ),

  createSubjectLevel: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(60),
        rank: z.number().int().default(0),
        apScored: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.subjectLevel.create({ data: input }),
    ),

  updateSubjectLevel: adminProcedure
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
      return ctx.db.subjectLevel.update({ where: { id }, data });
    }),

  deleteSubjectLevel: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      // Detach any subjects on this level first (revertible: reassign on the subjects page).
      await ctx.db.subject.updateMany({
        where: { levelId: input.id },
        data: { levelId: null },
      });
      return ctx.db.subjectLevel.delete({ where: { id: input.id } });
    }),
  timeSlots: viewerProcedure.query(({ ctx }) =>
    ctx.db.timeSlot.findMany({
      orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
    }),
  ),

  // --------------------------------------------------------------------------
  // Pairings (+ room grid)
  // --------------------------------------------------------------------------
  // "Current pairings" = those in the active term. A program refresh activates a new term, so
  // the board clears automatically; past terms' pairings remain for history but aren't shown here.
  pairings: viewerProcedure.query(({ ctx }) =>
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
  sessions: viewerProcedure
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
  currentPeriod: viewerProcedure.query(async ({ ctx }) => {
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
        // G12 tutors graduate as the program advances into Q4 (its final quarter).
        graduates: np.quarter === "Q4",
      },
    };
  }),

  /** Every program period on record (one per quarter ever activated) — for history selectors. */
  periods: viewerProcedure.query(({ ctx }) =>
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
  periodSummary: viewerProcedure
    .input(
      z
        .object({
          schoolYear: z.string().optional(),
          semester: z.enum(["S1", "S2"]).optional(),
          quarter: z.enum(QUARTERS).optional(),
          // Narrow to a single calendar month ("YYYY-MM"); overrides the period scope above.
          month: monthInput.optional(),
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
      // Service hours are month-stamped, so a month filter is exact; otherwise scope by the
      // quarter(s) of the chosen period.
      const periodWhere = input?.month
        ? { month: input.month }
        : { schoolYear, quarter: { in: quarters } };
      if (input?.month) label = input.month;

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
          active: t.status === "ACTIVE",
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
   * when the refresh crosses a semester boundary. On a semester crossing, continuing ACTIVE tutors
   * are set to PENDING: each must reactivate from their own page (choosing available or opt-out)
   * for the new semester — so the crew no longer pre-marks availability here. Requires typing
   * REFRESH to confirm.
   */
  // ADMIN only — a refresh is destructive and program-wide (coordinators can view but not run it).
  refresh: adminOnlyProcedure
    .input(z.object({ confirm: z.string() }))
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

        // Graduation happens at the START of Q4 (the program's final quarter): G12 (and up)
        // are marked GRADUATED as the term advances into Q4, so they finish the year inactive.
        // Aging-up stays at the school-year boundary (Q4 -> next year's Q1) and advances everyone
        // who remains ACTIVE by one grade — by then the graduates are already inactive and
        // untouched. (A retained tutor who self-reported staying in their grade simply isn't G12.)
        let graduated = 0;
        let aged = 0;
        if (np.quarter === "Q4") {
          const grad = await tx.tutor.updateMany({
            where: { status: "ACTIVE", gradeLevel: { gte: 12 } },
            data: { status: "GRADUATED" },
          });
          graduated = grad.count;
        }
        if (yearCross) {
          const age = await tx.tutor.updateMany({
            where: { status: "ACTIVE", gradeLevel: { not: null } },
            data: { gradeLevel: { increment: 1 } },
          });
          aged = age.count;
        }

        // Semester rollover: every continuing ACTIVE tutor must re-confirm availability. Set them
        // PENDING — they reactivate (available) or opt out from their own page, and their status
        // syncs straight back to the admin views. (Graduated/opted-out/archived are left as-is.)
        let pending = 0;
        if (semesterCross) {
          const p = await tx.tutor.updateMany({
            where: { status: "ACTIVE" },
            data: { status: "PENDING" },
          });
          pending = p.count;
        }

        return {
          termId: term.id,
          archivedTutees: tutees.count,
          graduated,
          aged,
          pending,
        };
      });

      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action:
          `Refreshed program to ${name} — archived ${out.archivedTutees} tutee(s)` +
          (out.graduated ? `, graduated ${out.graduated} tutor(s)` : "") +
          (out.aged ? `, aged up ${out.aged}` : "") +
          (out.pending ? `, ${out.pending} tutor(s) must reactivate` : "") +
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
        graduatedTutors: out.graduated,
        agedTutors: out.aged,
        pendingTutors: out.pending,
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
        status: z.enum(TUTOR_STATUS).default("ACTIVE"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const gradYear = await activeGradYear(ctx.db, input.gradeLevel);
      const username = await ensureUniqueUsername(
        defaultUsername(input.firstName, input.lastName, gradYear),
      );
      const tutor = await ctx.db.tutor.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          englishName: `${input.firstName} ${input.lastName}`,
          alternativeNames: input.alternativeNames?.trim()
            ? input.alternativeNames.trim()
            : null,
          username,
          status: input.status,
          gradeLevel: input.gradeLevel ?? null,
          email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
        },
      });
      // Manually-added tutors have no login yet — remind the team to send a setup link.
      await notifyAdmins(
        {
          title: "New tutor needs an account",
          body: `${tutor.englishName} was added — send them a setup link.`,
          link: "/admin/users",
        },
        { exclude: ctx.session.user.id },
      );
      return tutor;
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
        status: z.enum(TUTOR_STATUS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const trimmedUsername = input.username?.trim();
      const gradYear = await activeGradYear(ctx.db, input.gradeLevel);
      const desired =
        trimmedUsername && trimmedUsername.length > 0
          ? trimmedUsername
          : defaultUsername(input.firstName, input.lastName, gradYear);
      const username = await ensureUniqueUsername(desired, { excludeTutorId: input.id });
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
          status: input.status,
          ...(input.gradeLevel === undefined ? {} : { gradeLevel: input.gradeLevel }),
          email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
        },
      });
    }),

  /**
   * Provision + invite a tutor to set up their login: ensures a `User` exists and emails a
   * "set your password" link (which also confirms their email). Returns the link so the admin can
   * copy/share it directly — useful when email delivery isn't configured. Needs a tutor email.
   */
  sendTutorSetup: adminProcedure
    .input(z.object({ tutorId: cuid }))
    .mutation(async ({ ctx, input }) => {
      const result = await issueTutorSetupLink(input.tutorId);
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            result.error === "no-email"
              ? "Add an email for this tutor before sending a setup link."
              : "Tutor not found.",
        });
      }
      const tutor = await ctx.db.tutor.findUnique({
        where: { id: input.tutorId },
        select: { englishName: true },
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Sent account setup link to ${tutor?.englishName ?? "tutor"}`,
        entity: "Tutor",
        entityId: input.tutorId,
      });
      return { emailed: result.emailed, link: result.link };
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
   * tutee's first-choice subject) in the given term and marks the tutee ACTIVE. The tutor
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
          message: "No subject: pick a subject for this tutee or pass a subject.",
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
   * Assign a pending signup's subject choices to tutors in one go — e.g. their first choice
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
          .min(1, "Pick a tutor for at least one subject"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // New pairings land in the active program period.
      const period = await getActivePeriod(ctx.db);
      return ctx.db.$transaction(async (tx) => {
        const tutee = await tx.tutee.findUnique({
          where: { id: input.tuteeId },
          select: {
            status: true,
            firstChoice: { select: { name: true } },
            secondChoice: { select: { name: true } },
          },
        });
        if (tutee?.status !== "PENDING") staleConflict();

        // Subjects this tutee already has a tutor for — re-assigns of the same subject are
        // skipped so a partially-processed request can be finished without duplicating pairings.
        const existing = await tx.pairingTutee.findMany({
          where: { tuteeId: input.tuteeId },
          select: { pairing: { select: { subject: true } } },
        });
        const assignedSubjects = new Set(existing.map((e) => e.pairing.subject));

        for (const a of input.assignments) {
          if (assignedSubjects.has(a.subject)) continue;
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
          assignedSubjects.add(a.subject);
        }

        // A request is "fulfilled" once every subject choice the tutee actually provided has
        // a tutor. Only then does it leave the queue (→ ACTIVE); partial assignments keep it
        // PENDING so the remaining choice can still be processed.
        const provided = [tutee.firstChoice?.name, tutee.secondChoice?.name].filter(
          (n): n is string => !!n,
        );
        const fulfilled = provided.length > 0 && provided.every((c) => assignedSubjects.has(c));

        // Concurrency guard: the version match + still-PENDING status both must hold, or another
        // coordinator got there first. The status flip (or no-op touch) bumps updatedAt.
        const flip = await tx.tutee.updateMany({
          where: { id: input.tuteeId, status: "PENDING", updatedAt: input.expectedUpdatedAt },
          data: { status: fulfilled ? "ACTIVE" : "PENDING" },
        });
        if (flip.count === 0) staleConflict();

        return { ok: true, fulfilled };
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
  // Subject catalog (subjects offered; tutees pick first/second choice at signup)
  // --------------------------------------------------------------------------
  createSubject: adminProcedure
    .input(z.object({ name: z.string().trim().min(1), levelId: cuid.nullable().optional() }))
    .mutation(({ ctx, input }) =>
      ctx.db.subject.create({
        data: { name: input.name, levelId: input.levelId ?? null },
      }),
    ),

  updateSubject: adminProcedure
    .input(
      z.object({
        id: cuid,
        name: z.string().trim().min(1),
        levelId: cuid.nullable().optional(),
        active: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.subject.update({
        where: { id: input.id },
        data: {
          name: input.name,
          ...(input.levelId === undefined ? {} : { levelId: input.levelId }),
          active: input.active,
        },
      }),
    ),

  deleteSubject: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      const used = await ctx.db.tutee.count({
        where: { OR: [{ firstChoiceId: input.id }, { secondChoiceId: input.id }] },
      });
      if (used > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Subject is chosen by one or more tutees. Mark it inactive instead.",
        });
      }
      const subject = await ctx.db.subject.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, name: true, levelId: true, active: true },
      });
      const deleted = await ctx.db.subject.delete({ where: { id: input.id } });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Deleted subject "${subject.name}"`,
        entity: "Subject",
        entityId: subject.id,
        undo: { kind: "subject.restore", payload: subject },
      });
      return deleted;
    }),

  /** Batch-edit selected subjects: set their level and/or active flag in one go. */
  batchUpdateSubjects: adminProcedure
    .input(
      z.object({
        ids: z.array(cuid).min(1),
        levelId: cuid.nullable().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.subject.updateMany({
        where: { id: { in: input.ids } },
        data: {
          ...(input.levelId === undefined ? {} : { levelId: input.levelId }),
          ...(input.active === undefined ? {} : { active: input.active }),
        },
      }),
    ),

  /** Bulk-create subjects (e.g. from a CSV upload). Duplicate names are skipped. The optional
   *  level column is matched by name against the existing level catalogue (case-insensitive). */
  importSubjects: adminProcedure
    .input(
      z.object({
        subjects: z
          .array(z.object({ name: z.string().trim().min(1), level: z.string().trim().optional() }))
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const levels = await ctx.db.subjectLevel.findMany({ select: { id: true, name: true } });
      const levelByName = new Map(levels.map((l) => [l.name.toLowerCase(), l.id]));

      // De-dupe by name within the batch, then let the DB skip names that already exist.
      const seen = new Set<string>();
      const data: { name: string; levelId: string | null }[] = [];
      for (const c of input.subjects) {
        const key = c.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        data.push({
          name: c.name,
          levelId: c.level ? (levelByName.get(c.level.toLowerCase()) ?? null) : null,
        });
      }
      const result = await ctx.db.subject.createMany({ data, skipDuplicates: true });
      return { created: result.count, received: input.subjects.length };
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
  meetings: viewerProcedure.query(({ ctx }) =>
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
    .mutation(async ({ ctx, input }) => {
      // Remove the meeting's unexcused-absence deductions along with it (attendance cascades).
      await ctx.db.serviceHourAdjustment.deleteMany({
        where: { id: { startsWith: `mtgabs_${input.id}_` } },
      });
      return ctx.db.tutorMeeting.delete({ where: { id: input.id } });
    }),

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
      const meeting = await ctx.db.tutorMeeting.findUnique({
        where: { id: input.meetingId },
        select: { date: true, term: { select: { schoolYear: true, quarter: true } } },
      });
      if (!meeting) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found." });
      // Deductions land in the meeting's month, scoped to its term (or the active period).
      const period = meeting.term ?? (await getActivePeriod(ctx.db));
      const month = monthKey(meeting.date);

      await ctx.db.$transaction(async (tx) => {
        for (const e of input.entries) {
          await tx.meetingAttendance.upsert({
            where: {
              meetingId_tutorId: { meetingId: input.meetingId, tutorId: e.tutorId },
            },
            update: { status: e.status },
            create: { meetingId: input.meetingId, tutorId: e.tutorId, status: e.status },
          });

          // Reconcile this tutor's unexcused-absence deduction for this meeting (one
          // deterministic PUNISHMENT adjustment per meeting+tutor, so it's idempotent and
          // disappears the moment the status changes away from unexcused).
          const adjId = `mtgabs_${input.meetingId}_${e.tutorId}`;
          if (e.status === "UNEXCUSED_ABSENT") {
            await tx.serviceHourAdjustment.upsert({
              where: { id: adjId },
              update: {
                month,
                schoolYear: period.schoolYear,
                quarter: period.quarter,
                amount: MEETING_ABSENCE_DEDUCTION,
              },
              create: {
                id: adjId,
                tutorId: e.tutorId,
                month,
                schoolYear: period.schoolYear,
                quarter: period.quarter,
                type: "PUNISHMENT",
                amount: MEETING_ABSENCE_DEDUCTION,
                reason: "Unexcused tutor-meeting absence",
              },
            });
          } else {
            await tx.serviceHourAdjustment.deleteMany({ where: { id: adjId } });
          }
        }
      });
      return { ok: true };
    }),

  // --------------------------------------------------------------------------
  // Service-hour adjustments (per tutor, per month). Tutor "punishments" are PUNISHMENT-type
  // adjustments (they deduct hours); tutee discipline lives in the card system instead.
  // --------------------------------------------------------------------------
  adjustments: viewerProcedure
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
  tutorApplications: viewerProcedure.query(({ ctx }) =>
    ctx.db.tutorApplication.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        subjectIntents: {
          include: {
            subject: { select: { name: true, level: { select: { name: true } } } },
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
  // Tutor lifecycle requests (opt-out / reentry) — admin review
  // --------------------------------------------------------------------------
  /** All open (PENDING) tutor lifecycle requests, with eligibility and affected-tutee counts. */
  tutorRequests: viewerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const active = await getActivePeriodOrNull(ctx.db);
    const requests = await ctx.db.tutorStatusRequest.findMany({
      where: { state: "PENDING" },
      orderBy: { createdAt: "asc" }, // earliest-first queue
      select: {
        id: true,
        kind: true,
        reason: true,
        eligibleAt: true,
        createdAt: true,
        tutor: { select: { id: true, englishName: true, status: true, email: true } },
      },
    });

    // Affected tutees for each opting-out tutor = tutees they serve in the active term.
    const optOutTutorIds = requests.filter((r) => r.kind === "OPT_OUT").map((r) => r.tutor.id);
    const tuteeCounts = new Map<string, number>();
    if (optOutTutorIds.length > 0 && active) {
      const pairings = await ctx.db.pairing.findMany({
        where: { tutorId: { in: optOutTutorIds }, termId: active.termId },
        select: { tutorId: true, tutees: { select: { tuteeId: true } } },
      });
      for (const p of pairings) {
        const set = tuteeCounts.get(p.tutorId) ?? 0;
        tuteeCounts.set(p.tutorId, set + p.tutees.length);
      }
    }

    return requests.map((r) => ({
      id: r.id,
      kind: r.kind,
      reason: r.reason,
      createdAt: r.createdAt,
      eligibleAt: r.eligibleAt,
      // Opt-out can only be approved once the cooldown has elapsed.
      approvable: r.kind === "REENTRY" || (r.eligibleAt != null && r.eligibleAt <= now),
      tutor: r.tutor,
      affectedTutees: tuteeCounts.get(r.tutor.id) ?? 0,
    }));
  }),

  /**
   * Approve or deny a tutor lifecycle request. Approving an OPT_OUT (only after its cooldown)
   * flips the tutor to OPTED_OUT; approving a REENTRY flips them back to ACTIVE. Denying just
   * closes the request. Opting-out leaves the tutor's tutees in place — use `requeueTutorTutees`
   * to send them back to the signup queue.
   */
  decideTutorRequest: adminProcedure
    .input(z.object({ requestId: cuid, approve: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const req = await ctx.db.tutorStatusRequest.findUniqueOrThrow({
        where: { id: input.requestId },
        select: { id: true, kind: true, state: true, eligibleAt: true, tutorId: true },
      });
      if (req.state !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This request is already resolved." });
      }
      if (input.approve && req.kind === "OPT_OUT") {
        if (!req.eligibleAt || req.eligibleAt > new Date()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The one-week cooldown hasn't elapsed yet.",
          });
        }
      }

      const newState = input.approve ? "APPROVED" : "DENIED";
      const newTutorStatus = !input.approve
        ? null
        : req.kind === "OPT_OUT"
          ? "OPTED_OUT"
          : "ACTIVE";

      await ctx.db.$transaction(async (tx) => {
        await tx.tutorStatusRequest.update({
          where: { id: req.id },
          data: {
            state: newState,
            resolvedAt: new Date(),
            resolvedById: ctx.session.user.id,
            resolvedByName: ctx.session.user.name,
          },
        });
        if (newTutorStatus) {
          await tx.tutor.update({ where: { id: req.tutorId }, data: { status: newTutorStatus } });
        }
      });

      const tutor = await ctx.db.tutor.findUnique({
        where: { id: req.tutorId },
        select: { englishName: true, user: { select: { id: true } } },
      });
      if (tutor?.user?.id) {
        const titleKey = input.approve
          ? req.kind === "OPT_OUT"
            ? "Opt-out approved"
            : "Reentry approved"
          : "Request declined";
        await notifyUsers([tutor.user.id], {
          title: titleKey,
          body:
            input.approve && req.kind === "REENTRY"
              ? "Welcome back — your account is active again."
              : input.approve
                ? "You have been opted out of the program."
                : "An admin declined your request.",
          link: "/dashboard",
        });
      }
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `${input.approve ? "Approved" : "Denied"} ${req.kind} request for ${tutor?.englishName ?? "tutor"}`,
        entity: "TutorStatusRequest",
        entityId: req.id,
      });
      return { ok: true };
    }),

  /**
   * Re-queue an (opted-out) tutor's tutees back onto the signup queue: set them PENDING and
   * detach them from this tutor's active-term pairings, so a coordinator can reassign them on
   * /admin/requests. Leaves session/attendance history intact.
   */
  requeueTutorTutees: adminProcedure
    .input(z.object({ tutorId: cuid }))
    .mutation(async ({ ctx, input }) => {
      const active = await getActivePeriod(ctx.db);
      const pairings = await ctx.db.pairing.findMany({
        where: { tutorId: input.tutorId, termId: active.termId },
        select: { id: true, tutees: { select: { tuteeId: true } } },
      });
      const tuteeIds = [...new Set(pairings.flatMap((p) => p.tutees.map((t) => t.tuteeId)))];
      if (tuteeIds.length === 0) return { ok: true, requeued: 0 };

      await ctx.db.$transaction([
        ctx.db.pairingTutee.deleteMany({
          where: { pairingId: { in: pairings.map((p) => p.id) }, tuteeId: { in: tuteeIds } },
        }),
        ctx.db.tutee.updateMany({ where: { id: { in: tuteeIds } }, data: { status: "PENDING" } }),
      ]);
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Re-queued ${tuteeIds.length} tutee(s) from an opted-out tutor`,
        entity: "Tutor",
        entityId: input.tutorId,
      });
      return { ok: true, requeued: tuteeIds.length };
    }),

  // --------------------------------------------------------------------------
  // Registration codes (admins + coordinators) — the security keys handed to new tutors
  // --------------------------------------------------------------------------
  /**
   * Every registration code with its status (the plaintext code is NEVER stored — only its keyed
   * hash — so it's shown once at issue time, then only metadata here). Ordered newest-first.
   */
  registrationCodes: viewerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    // The plaintext code is withheld from the read-only VIEWER (it grants account creation).
    const canSeeCode = ctx.session.role !== "VIEWER";
    const codes = await ctx.db.registrationCode.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        code: true,
        email: true,
        label: true,
        issuedByName: true,
        tutorId: true,
        applicationId: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        tutor: { select: { englishName: true } },
      },
    });
    return codes.map((c) => ({
      id: c.id,
      code: canSeeCode ? c.code : null,
      email: c.email,
      label: c.label,
      issuedByName: c.issuedByName,
      tutorName: c.tutor?.englishName ?? null,
      fromApplication: !!c.applicationId,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      status: c.usedAt ? "used" : c.expiresAt < now ? "expired" : "active",
    }));
  }),

  /**
   * Issue a registration code. The plaintext 6-digit code is returned ONCE for the issuer to copy
   * and hand out (we never email or re-show it). Optionally bind it to an email and/or an existing
   * roster Tutor (so registration links to that record instead of creating a new one).
   */
  issueRegistrationCode: adminProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        tutorId: cuid.optional(),
        label: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // If bound to a tutor, default the label/email from that tutor for the menu.
      let label = input.label?.trim() ? input.label.trim() : null;
      let email = input.email?.trim() ? input.email.trim().toLowerCase() : null;
      if (input.tutorId) {
        const tutor = await ctx.db.tutor.findUnique({
          where: { id: input.tutorId },
          select: { englishName: true, email: true },
        });
        if (!tutor) throw new TRPCError({ code: "NOT_FOUND", message: "Tutor not found." });
        label ??= tutor.englishName;
        email ??= tutor.email?.toLowerCase() ?? null;
      }
      const result = await issueRegistrationCode({
        email,
        tutorId: input.tutorId ?? null,
        label,
        issuedById: ctx.session.user.id,
        issuedByName: ctx.session.user.name,
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Issued a registration code${label ? ` for ${label}` : ""}`,
        entity: "RegistrationCode",
        entityId: result.id,
      });
      // The plaintext code is in the return value only — copy it now.
      return { id: result.id, code: result.code, expiresAt: result.expiresAt };
    }),

  /** Revoke an unused registration code (deletes it). Used codes stay for the record. */
  revokeRegistrationCode: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      const code = await ctx.db.registrationCode.findUniqueOrThrow({
        where: { id: input.id },
        select: { usedAt: true },
      });
      if (code.usedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This code has already been used." });
      }
      await ctx.db.registrationCode.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // --------------------------------------------------------------------------
  // User / role management (ADMIN only)
  // --------------------------------------------------------------------------
  /**
   * Unified account list for the Users & Roles page: every login plus any admin-created tutor
   * that doesn't have a login yet (so they can be invited from here). Each row carries the
   * tutor's account/setup status and a `isSelf` flag; `caller` lets the client gate controls
   * (coordinators may only send links + toggle their own "can tutor"). ADMIN or COORDINATOR only.
   */
  accounts: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const [term, users, unlinkedTutors, openCodes] = await Promise.all([
      ctx.db.term.findFirst({ where: { active: true }, select: { schoolYear: true } }),
      ctx.db.user.findMany({
        orderBy: { email: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          canTranslate: true,
          emailVerifiedAt: true,
          mustChangePassword: true,
          tutorId: true,
          tutor: {
            select: { englishName: true, status: true, username: true, gradeLevel: true, email: true },
          },
        },
      }),
      ctx.db.tutor.findMany({
        where: { user: { is: null } },
        orderBy: { englishName: "asc" },
        select: { id: true, englishName: true, status: true, username: true, gradeLevel: true, email: true },
      }),
      // Outstanding (unused, unexpired) registration codes — used to flag "invited" accounts.
      ctx.db.registrationCode.findMany({
        where: { usedAt: null, expiresAt: { gt: now } },
        select: { tutorId: true, email: true },
      }),
    ]);

    const codedTutorIds = new Set(openCodes.map((c) => c.tutorId).filter(Boolean) as string[]);
    const codedEmails = new Set(openCodes.map((c) => c.email?.toLowerCase()).filter(Boolean) as string[]);
    const hasOpenCode = (tutorId: string | null, email: string | null | undefined) =>
      (tutorId != null && codedTutorIds.has(tutorId)) ||
      (!!email && codedEmails.has(email.toLowerCase()));

    // Class-of year for a grade in the active school year (null if neither is known).
    const classOf = (gradeLevel: number | null | undefined) =>
      gradeLevel != null && term ? graduationYear(gradeLevel, term.schoolYear) : null;

    const userRows = users.map((u) => ({
      userId: u.id,
      name: u.name ?? u.email,
      email: u.email,
      role: u.role,
      isSelf: u.id === ctx.session.user.id,
      tutorId: u.tutorId,
      tutor: u.tutor,
      tutorStatus: u.tutor?.status ?? null,
      classOf: classOf(u.tutor?.gradeLevel),
      canTranslate: u.canTranslate,
      tutorHasEmail: !!u.tutor?.email,
      // registered = finished setup; setup = login exists but not finished; (no "none"/"invited"
      // here — those only apply to login-less tutors below).
      account: u.emailVerifiedAt && !u.mustChangePassword ? "registered" : "setup",
    }));

    const tutorRows = unlinkedTutors.map((tu) => ({
      userId: null,
      name: tu.englishName,
      email: tu.email,
      role: null,
      isSelf: false,
      tutorId: tu.id,
      tutor: {
        englishName: tu.englishName,
        status: tu.status,
        username: tu.username,
        gradeLevel: tu.gradeLevel,
        email: tu.email,
      },
      tutorStatus: tu.status,
      classOf: classOf(tu.gradeLevel),
      canTranslate: false,
      tutorHasEmail: !!tu.email,
      // invited = a registration code is outstanding; none = no login and no code.
      account: hasOpenCode(tu.id, tu.email) ? "invited" : "none",
    }));

    return {
      caller: { id: ctx.session.user.id, role: ctx.session.role },
      rows: [...userRows, ...tutorRows],
    };
  }),

  /**
   * Change a user's role. Tier rules (enforced here on top of the procedure gate):
   *   - Changing to/from ADMIN, or any change to a HEAD, requires the caller to be HEAD.
   *   - HEAD is never assigned here (use `transferHead`); demoting the head is blocked.
   *   - ADMINs may only set roles up to COORDINATOR on non-admin, non-head users.
   * adminOnlyProcedure already restricts the caller to ADMIN or HEAD.
   */
  setUserRole: adminOnlyProcedure
    .input(z.object({ userId: cuid, role: z.enum(["VIEWER", "TUTOR", "COORDINATOR", "ADMIN"]) }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { id: true, role: true, name: true, email: true },
      });
      const callerIsHead = ctx.session.role === "HEAD";
      const touchesAdminTier = target.role === "HEAD" || input.role === "ADMIN" || target.role === "ADMIN";
      if (target.role === "HEAD") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Use leadership transfer to change the head.",
        });
      }
      if (touchesAdminTier && !callerIsHead) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the head can promote or demote administrators.",
        });
      }
      const updated = await ctx.db.user.update({
        where: { id: input.userId },
        data: { role: input.role },
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Set role of ${target.name ?? target.email} to ${input.role}`,
        entity: "User",
        entityId: target.id,
      });
      return updated;
    }),

  /**
   * Transfer leadership (HEAD only). Demotes the current head to ADMIN and promotes the target
   * (an ADMIN or COORDINATOR) to HEAD, in one transaction — so there is always exactly one head
   * and the head can't accidentally leave the program leaderless.
   */
  transferHead: headProcedure
    .input(z.object({ userId: cuid }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You are already the head." });
      }
      const target = await ctx.db.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { id: true, role: true, name: true, email: true },
      });
      if (target.role !== "ADMIN" && target.role !== "COORDINATOR") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Leadership can only pass to an admin or coordinator.",
        });
      }
      await ctx.db.$transaction([
        ctx.db.user.update({ where: { id: ctx.session.user.id }, data: { role: "ADMIN" } }),
        ctx.db.user.update({ where: { id: target.id }, data: { role: "HEAD" } }),
      ]);
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Transferred head leadership to ${target.name ?? target.email}`,
        entity: "User",
        entityId: target.id,
      });
      return { ok: true };
    }),

  /** Assign (or unassign) a user as a translator — grants access to the /localization editor. */
  setUserCanTranslate: adminOnlyProcedure
    .input(z.object({ userId: cuid, canTranslate: z.boolean() }))
    .mutation(({ ctx, input }) =>
      ctx.db.user.update({
        where: { id: input.userId },
        data: { canTranslate: input.canTranslate },
      }),
    ),

  /**
   * Let an admin/coordinator also tutor: link the user to an (active) Tutor record so they get
   * a tutor area. Re-enables an existing linked/email-matched tutor, or creates one from their
   * name. Disabling deactivates the tutor and unlinks it (revertible — re-enable relinks).
   */
  setUserCanTutor: adminProcedure
    .input(z.object({ userId: cuid, canTutor: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // Coordinators may only change their own tutoring access; the admin tier (ADMIN/HEAD), anyone's.
      const callerIsAdminTier = ctx.session.role === "ADMIN" || ctx.session.role === "HEAD";
      if (!callerIsAdminTier && input.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only change your own tutoring access.",
        });
      }
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { id: true, name: true, email: true, tutorId: true },
      });

      if (!input.canTutor) {
        if (user.tutorId) {
          await ctx.db.tutor.update({ where: { id: user.tutorId }, data: { status: "ARCHIVED" } });
          await ctx.db.user.update({ where: { id: user.id }, data: { tutorId: null } });
        }
        return { ok: true, linked: false };
      }

      // Enabling: reuse the already-linked tutor, else an existing tutor with the same email,
      // else create a fresh one from the user's display name.
      const existing =
        (user.tutorId
          ? await ctx.db.tutor.findUnique({ where: { id: user.tutorId }, select: { id: true } })
          : null) ??
        (await ctx.db.tutor.findUnique({
          where: { email: user.email },
          select: { id: true },
        }));

      let tutorId: string;
      if (existing) {
        await ctx.db.tutor.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
        tutorId = existing.id;
      } else {
        const parts = (user.name ?? user.email).trim().split(/\s+/).filter(Boolean);
        const firstName = parts[0] ?? (user.name ?? user.email).trim();
        const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;
        const username = await ensureUniqueUsername(defaultUsername(firstName, lastName));
        const created = await ctx.db.tutor.create({
          data: {
            firstName,
            lastName,
            englishName: `${firstName} ${lastName}`,
            username,
            email: user.email,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        tutorId = created.id;
      }
      await ctx.db.user.update({ where: { id: user.id }, data: { tutorId } });
      return { ok: true, linked: true };
    }),

  // --------------------------------------------------------------------------
  // Policy documents (editable handbooks)
  // --------------------------------------------------------------------------
  // Every stored policy version (one row per slug + locale); the page groups them by slug
  // and offers a per-language tab (the default `en` copy is the fallback).
  policies: viewerProcedure.query(({ ctx }) =>
    ctx.db.policyDocument.findMany({
      orderBy: [{ slug: "asc" }, { locale: "asc" }],
      select: {
        id: true,
        slug: true,
        locale: true,
        title: true,
        body: true,
        version: true,
        updatedAt: true,
        updatedBy: { select: { name: true, email: true } },
      },
    }),
  ),

  // Save a policy version for a (slug, locale) — creating the language version if it's the
  // first time that translation is edited.
  upsertPolicy: adminProcedure
    .input(
      z.object({
        slug: z.string().trim().min(1),
        locale: z.string().trim().min(1).max(10),
        title: z.string().trim().min(1).max(200),
        version: z.string().trim().max(40).nullable().optional(),
        body: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = input.version?.trim() ? input.version.trim() : null;
      // Snapshot the outgoing version into the archive before overwriting it (only when it
      // actually changes), so admins can review earlier copies.
      const existing = await ctx.db.policyDocument.findUnique({
        where: { slug_locale: { slug: input.slug, locale: input.locale } },
        select: { title: true, body: true, version: true },
      });
      if (
        existing &&
        (existing.body !== input.body ||
          existing.title !== input.title ||
          (existing.version ?? null) !== version)
      ) {
        await ctx.db.policyArchive.create({
          data: {
            slug: input.slug,
            locale: input.locale,
            title: existing.title,
            body: existing.body,
            version: existing.version,
            archivedByName: ctx.session.user.name,
          },
        });
      }
      return ctx.db.policyDocument.upsert({
        where: { slug_locale: { slug: input.slug, locale: input.locale } },
        update: {
          title: input.title,
          version,
          body: input.body,
          updatedById: ctx.session.user.id,
        },
        create: {
          slug: input.slug,
          locale: input.locale,
          title: input.title,
          version,
          body: input.body,
          updatedById: ctx.session.user.id,
        },
      });
    }),

  /**
   * Remove one language version of a policy (cannot remove the default `en` copy, which is the
   * fallback shown when a translation is missing). Snapshots into the archive first, so it's
   * recoverable from version history.
   */
  deletePolicyLocale: adminProcedure
    .input(z.object({ slug: z.string().trim().min(1), locale: z.string().trim().min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      if (input.locale === DEFAULT_POLICY_LOCALE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The default language can't be removed.",
        });
      }
      const existing = await ctx.db.policyDocument.findUnique({
        where: { slug_locale: { slug: input.slug, locale: input.locale } },
        select: { title: true, body: true, version: true },
      });
      if (!existing) return { ok: true };
      await ctx.db.policyArchive.create({
        data: {
          slug: input.slug,
          locale: input.locale,
          title: existing.title,
          body: existing.body,
          version: existing.version,
          archivedByName: ctx.session.user.name,
        },
      });
      await ctx.db.policyDocument.delete({
        where: { slug_locale: { slug: input.slug, locale: input.locale } },
      });
      return { ok: true };
    }),

  /** Archived (superseded) policy versions, newest first — for the version-history viewer. */
  policyArchives: viewerProcedure.query(({ ctx }) =>
    ctx.db.policyArchive.findMany({
      orderBy: { archivedAt: "desc" },
      select: {
        id: true,
        slug: true,
        locale: true,
        title: true,
        body: true,
        version: true,
        archivedByName: true,
        archivedAt: true,
      },
    }),
  ),

  // --------------------------------------------------------------------------
  // Announcements (broadcast to tutors)
  // --------------------------------------------------------------------------
  announcements: viewerProcedure.query(({ ctx }) =>
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
      // Notify everyone else of the new announcement, linking each to a page they can open:
      // tutors see it on their dashboard; admin-area staff (no tutor login) on /admin/announcements.
      const users = await ctx.db.user.findMany({
        where: { id: { not: ctx.session.user.id } },
        select: { id: true, tutorId: true },
      });
      const body = input.body;
      const title = `📣 ${input.title}`;
      await Promise.all([
        notifyUsers(
          users.filter((u) => u.tutorId).map((u) => u.id),
          { title, body, link: "/dashboard" },
        ),
        notifyUsers(
          users.filter((u) => !u.tutorId).map((u) => u.id),
          { title, body, link: "/admin/announcements" },
        ),
      ]);
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
  disciplinaryCards: viewerProcedure.query(({ ctx }) =>
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
  auditLog: viewerProcedure.query(({ ctx }) =>
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
