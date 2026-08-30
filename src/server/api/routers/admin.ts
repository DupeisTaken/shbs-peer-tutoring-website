import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  adminOnlyProcedure,
  adminProcedure,
  createTRPCRouter,
  headProcedure,
  viewerProcedure,
} from "~/server/api/trpc";
import { monthKey, shCount } from "~/lib/service-hours";
import { isSignupWindowOpen } from "~/lib/signup-window";
import {
  defaultUsername,
  ensureUniqueUsername,
  ensureUserUsername,
  splitDisplayName,
} from "~/server/auth/username";
import { assertCallerPassword } from "~/server/auth/reauth";
import { issueTutorSetupLink } from "~/server/auth/password-reset";
import { issueRegistrationCode } from "~/server/auth/registration";
import { promoteApplicantToTutor } from "~/server/tutors/promote";
import { notifyAdmins, notifyTutors, notifyUsers } from "~/server/notifications/create";
import { standingFromCounts } from "~/lib/discipline";
import { finalizeDueOptOuts, syncPunishmentRemoval } from "~/server/discipline/removal";
import {
  QUARTERS,
  type Quarter,
  crossesSemester,
  crossesYear,
  graduationYear,
  nextPeriod,
  periodLabel,
  quarterSemester,
  semesterQuarters,
} from "~/lib/period";
import { getActivePeriod, getActivePeriodOrNull } from "~/server/period";
import { applyPendingFeatures, assertFeatureEnabled } from "~/server/program/features";
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

/**
 * Repair tutor rows whose name was duplicated by the old single-word split bug (a one-token name
 * like "Admin" became firstName=lastName="Admin" → englishName "Admin Admin"). The signature is
 * exact — firstName equals lastName AND englishName is just that token twice — so a genuine
 * "John John" is not touched unless it matches the duplicated form, and the repair (drop the
 * duplicated last name) is benign and editable. Idempotent; runs as a cheap self-heal.
 */
async function healDuplicatedTutorNames(db: typeof dbClient): Promise<void> {
  const candidates = await db.tutor.findMany({
    where: { firstName: { not: null }, lastName: { not: null } },
    select: { id: true, firstName: true, lastName: true, englishName: true },
  });
  const broken = candidates.filter(
    (t) =>
      t.firstName &&
      t.firstName === t.lastName &&
      t.englishName === `${t.firstName} ${t.lastName}`,
  );
  if (broken.length === 0) return;
  await Promise.all(
    broken.map((t) =>
      db.tutor.update({
        where: { id: t.id },
        data: { lastName: "", englishName: t.firstName! },
      }),
    ),
  );
}

/**
 * Detach an inactive tutor's active-term tutees from their pairings and re-queue them (set PENDING)
 * for reassignment on /admin/requests. This is the single inverse used whenever a tutor stops
 * serving — opt-out approval, can-tutor off, or a direct status change — so tutees are never
 * stranded on a tutor who can no longer act. Returns how many were re-queued. No-op without an
 * active term.
 */
async function requeueTutorActiveTermTutees(
  db: typeof dbClient,
  tutorId: string,
): Promise<number> {
  const term = await db.term.findFirst({ where: { active: true }, select: { id: true } });
  if (!term) return 0;
  const pairings = await db.pairing.findMany({
    where: { tutorId, termId: term.id },
    select: { id: true, tutees: { select: { tuteeId: true } } },
  });
  const tuteeIds = [...new Set(pairings.flatMap((p) => p.tutees.map((t) => t.tuteeId)))];
  if (tuteeIds.length === 0) return 0;
  await db.$transaction([
    db.pairingTutee.deleteMany({
      where: { pairingId: { in: pairings.map((p) => p.id) }, tuteeId: { in: tuteeIds } },
    }),
    db.tutee.updateMany({ where: { id: { in: tuteeIds } }, data: { status: "PENDING" } }),
  ]);
  return tuteeIds.length;
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

  tutees: viewerProcedure.query(async ({ ctx }) => {
    const isViewer = ctx.session.role === "VIEWER";
    const active = await getActivePeriodOrNull(ctx.db);
    const periodKey = active ? `${active.schoolYear} ${active.quarter}` : null;
    const [tutees, removed] = await Promise.all([
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
      // Identities punishment-removed in the current period (for the same-person re-signup flag).
      periodKey
        ? ctx.db.tuteeRemovalRequest.findMany({
            where: {
              kind: "PUNISHMENT",
              state: "APPROVED",
              removedPeriodKey: periodKey,
              tutee: { is: { status: "INACTIVE" } },
            },
            select: { tutee: { select: { id: true, englishName: true, email: true, phone: true } } },
          })
        : Promise.resolve([]),
    ]);

    const norm = (s: string | null | undefined) => {
      const v = s?.trim().toLowerCase();
      if (!v) return null;
      return v;
    };
    const bannedNames = new Set(removed.map((r) => norm(r.tutee.englishName)).filter(Boolean));
    const bannedEmails = new Set(removed.map((r) => norm(r.tutee.email)).filter(Boolean));
    const bannedPhones = new Set(removed.map((r) => norm(r.tutee.phone)).filter(Boolean));

    return tutees.map((t) => {
      // Flag a (still-pending) re-signup that matches a banned identity this quarter — by exact
      // name / email / phone — so an admin can vet it. Never auto-blocks; it just labels.
      const match =
        t.status === "PENDING"
          ? {
              name: !!norm(t.englishName) && bannedNames.has(norm(t.englishName)),
              email: !!norm(t.email) && bannedEmails.has(norm(t.email)),
              phone: !!norm(t.phone) && bannedPhones.has(norm(t.phone)),
            }
          : null;
      const bannedMatch = match && (match.name || match.email || match.phone) ? match : null;
      // Withhold staff free-text (notes) and the tutee's typed legal-name signature from VIEWER.
      return isViewer ? { ...t, notes: null, signatureName: null, bannedMatch } : { ...t, bannedMatch };
    });
  }),
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
  pairings: viewerProcedure.query(async ({ ctx }) => {
    const isViewer = ctx.session.role === "VIEWER";
    const pairings = await ctx.db.pairing.findMany({
      where: { term: { active: true } },
      orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
      include: {
        tutor: true,
        room: true,
        term: true,
        timeSlot: true,
        tutees: { include: { tutee: true } },
      },
    });
    if (!isViewer) return pairings;
    // Withhold staff free-text (notes) + the tutee's signature from VIEWER.
    return pairings.map((p) => ({
      ...p,
      tutees: p.tutees.map((pt) => ({
        ...pt,
        tutee: { ...pt.tutee, notes: null, signatureName: null },
      })),
    }));
  }),

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
    // Quarter System off => semester mode. The current label uses the current effective mode; the
    // "next" preview uses the about-to-apply mode (a staged toggle activates at the next refresh).
    const qs = await ctx.db.programFeature.findUnique({
      where: { key: "QUARTER_SYSTEM" },
      select: { enabled: true, pendingEnabled: true },
    });
    const curSemester = !(qs?.enabled ?? true);
    const nextSemester = !(qs?.pendingEnabled ?? qs?.enabled ?? true);
    const from = { schoolYear: active.schoolYear, quarter: active.quarter };
    const np = nextPeriod(from, nextSemester);
    const yearCross = crossesYear(from, np);
    return {
      termId: active.termId,
      schoolYear: active.schoolYear,
      quarter: active.quarter,
      semester: active.semester,
      name: curSemester ? periodLabel(from, true) : active.name,
      signupOpensAt: active.signupOpensAt,
      signupPreviewUrl: active.signupPreviewUrl,
      signupIsOpen: isSignupWindowOpen(active.signupOpensAt),
      next: {
        schoolYear: np.schoolYear,
        quarter: np.quarter,
        semester: quarterSemester(np.quarter),
        name: periodLabel(np, nextSemester),
        crossesSemester: crossesSemester(from, np),
        crossesYear: yearCross,
        // Quarter mode: G12 graduate entering Q4. Semester mode: at the year boundary (no Q4).
        graduates: nextSemester ? yearCross : np.quarter === "Q4",
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
   * Comprehensive program report for a period — general stats + detailed entries — backing the
   * Reports page and its print/CSV exports. Scope resolves like periodSummary (quarter / semester /
   * whole year / month). Service-hour data (sessions, adjustments) is scoped by its exact
   * schoolYear+quarter (or month) stamp; everything else (cards, meetings, applications, signups,
   * removals, requests) is scoped by a calendar window derived from the matching Term rows (a
   * term's createdAt marks its start, the next term's its end). `depth` controls how much is
   * gathered (summary → detailed → full). PII (emails/phone/contact) is masked for VIEWER or
   * whenever `maskPii` is set, so any admin can export an anonymized copy.
   */
  periodReport: viewerProcedure
    .input(
      z.object({
        schoolYear: z.string().optional(),
        semester: z.enum(["S1", "S2"]).optional(),
        quarter: z.enum(QUARTERS).optional(),
        month: monthInput.optional(),
        depth: z.enum(["summary", "detailed", "full"]).default("summary"),
        maskPii: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const active = await getActivePeriod(ctx.db);
      const schoolYear = input.schoolYear ?? active.schoolYear;
      let quarters: Quarter[];
      let label: string;
      if (input.quarter) {
        quarters = [input.quarter];
        label = `${schoolYear} ${input.quarter}`;
      } else if (input.semester) {
        quarters = semesterQuarters(input.semester);
        label = `${schoolYear} ${input.semester}`;
      } else if (input.schoolYear) {
        quarters = [...QUARTERS];
        label = schoolYear;
      } else {
        quarters = semesterQuarters(active.semester);
        label = `${schoolYear} ${active.semester}`;
      }
      if (input.month) label = input.month;

      const mask = input.maskPii || ctx.session.role === "VIEWER";
      const maskContact = (v: string | null | undefined): string | null => (mask ? null : (v ?? null));

      // Calendar window (for createdAt/date-scoped sections) derived from the matching Term rows.
      const allTerms = await ctx.db.term.findMany({
        orderBy: [{ schoolYear: "asc" }, { quarter: "asc" }],
        select: { id: true, schoolYear: true, quarter: true, createdAt: true },
      });
      let windowStart: Date | null = null;
      let windowEnd: Date | null = null;
      let termIds: string[] = [];
      if (input.month) {
        const [y, m] = input.month.split("-").map(Number);
        windowStart = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
        windowEnd = new Date(Date.UTC(y!, m ?? 1, 1));
      } else {
        const selected = allTerms.filter(
          (tm) => tm.schoolYear === schoolYear && quarters.includes(tm.quarter),
        );
        termIds = selected.map((tm) => tm.id);
        if (selected.length > 0) {
          windowStart = selected.reduce((a, b) => (a.createdAt < b.createdAt ? a : b)).createdAt;
          const latest = selected.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
          const idx = allTerms.findIndex((tm) => tm.id === latest.id);
          windowEnd = idx >= 0 && idx + 1 < allTerms.length ? allTerms[idx + 1]!.createdAt : null;
        }
      }
      const wq = windowStart
        ? { createdAt: { gte: windowStart, ...(windowEnd ? { lt: windowEnd } : {}) } }
        : null;
      const periodWhere = input.month
        ? { month: input.month }
        : { schoolYear, quarter: { in: quarters } };

      // ---- Always: per-tutor service hours + program attendance + headline counts ----
      const [tutors, sessionAgg, adjAgg, attAgg, served] = await Promise.all([
        ctx.db.tutor.findMany({
          orderBy: { englishName: "asc" },
          select: { id: true, englishName: true, status: true },
        }),
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
        ctx.db.sessionTutee.findMany({
          where: { session: periodWhere },
          select: { tuteeId: true },
          distinct: ["tuteeId"],
        }),
      ]);

      const earnedBy = new Map(sessionAgg.map((s) => [s.tutorId, s._sum.shCount ?? 0]));
      const sessionsBy = new Map(sessionAgg.map((s) => [s.tutorId, s._count._all]));
      const punishBy = new Map<string, number>();
      const extraBy = new Map<string, number>();
      for (const a of adjAgg) {
        const m = a.type === "PUNISHMENT" ? punishBy : extraBy;
        m.set(a.tutorId, (m.get(a.tutorId) ?? 0) + (a._sum.amount ?? 0));
      }
      const tutorRows = tutors
        .map((t) => {
          const earned = earnedBy.get(t.id) ?? 0;
          const extras = extraBy.get(t.id) ?? 0;
          const punishments = punishBy.get(t.id) ?? 0;
          return {
            tutorId: t.id,
            englishName: t.englishName,
            active: t.status === "ACTIVE",
            sessions: sessionsBy.get(t.id) ?? 0,
            earned,
            extras,
            punishments,
            total: earned - punishments + extras,
          };
        })
        .filter((r) => r.sessions > 0 || r.earned !== 0 || r.extras !== 0 || r.punishments !== 0);

      const att = { present: 0, excused: 0, unexcused: 0 };
      for (const g of attAgg) {
        if (g.status === "PRESENT") att.present = g._count._all;
        else if (g.status === "EXCUSED_ABSENT") att.excused = g._count._all;
        else att.unexcused = g._count._all;
      }
      const hours = tutorRows.reduce(
        (acc, r) => ({
          earned: acc.earned + r.earned,
          extras: acc.extras + r.extras,
          punishments: acc.punishments + r.punishments,
          total: acc.total + r.total,
        }),
        { earned: 0, extras: 0, punishments: 0, total: 0 },
      );

      const [signupCount, cardCount, meetingCount, appCount, removalCount, statusReqCount, patrolCount, flagCount] =
        await Promise.all([
          wq ? ctx.db.tutee.count({ where: wq }) : Promise.resolve(0),
          wq ? ctx.db.disciplinaryCard.count({ where: wq }) : Promise.resolve(0),
          termIds.length
            ? ctx.db.tutorMeeting.count({ where: { termId: { in: termIds } } })
            : Promise.resolve(0),
          wq ? ctx.db.tutorApplication.count({ where: wq }) : Promise.resolve(0),
          wq ? ctx.db.tuteeRemovalRequest.count({ where: wq }) : Promise.resolve(0),
          wq ? ctx.db.tutorStatusRequest.count({ where: wq }) : Promise.resolve(0),
          termIds.length
            ? ctx.db.patrol.count({ where: { termId: { in: termIds } } })
            : Promise.resolve(0),
          ctx.db.sessionFlag.count({ where: { session: periodWhere } }),
        ]);

      const summary = {
        sessions: tutorRows.reduce((n, r) => n + r.sessions, 0),
        hours,
        attendance: att,
        counts: {
          tutorsServed: tutorRows.length,
          tuteesServed: served.length,
          signups: signupCount,
          cards: cardCount,
          meetings: meetingCount,
          applications: appCount,
          removals: removalCount,
          statusRequests: statusReqCount,
          patrols: patrolCount,
          flags: flagCount,
        },
      };
      const base = {
        scope: {
          label,
          schoolYear,
          quarters,
          masked: mask,
          window: windowStart ? { start: windowStart, end: windowEnd } : null,
        },
        summary,
        tutors: tutorRows,
      };
      const empty = {
        meetingStats: [] as never[],
        crewStats: [] as never[],
        flags: [] as never[],
        sessions: [] as never[],
        cards: [] as never[],
        meetings: [] as never[],
        adjustments: [] as never[],
        applications: [] as never[],
        signups: [] as never[],
        removals: [] as never[],
        statusRequests: [] as never[],
      };
      if (input.depth === "summary") return { ...base, ...empty };

      // ---- Detailed: sessions, cards, meetings, adjustments ----
      const [sessions, cards, meetings, adjustments] = await Promise.all([
        ctx.db.session.findMany({
          where: periodWhere,
          orderBy: { date: "desc" },
          select: {
            id: true,
            date: true,
            tutorStatus: true,
            shCount: true,
            comments: true,
            tutor: { select: { englishName: true } },
            pairing: { select: { subject: true } },
            tutees: { select: { status: true, tutee: { select: { englishName: true } } } },
          },
        }),
        wq
          ? ctx.db.disciplinaryCard.findMany({
              where: wq,
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                createdAt: true,
                color: true,
                source: true,
                reviewStatus: true,
                reason: true,
                tutee: { select: { englishName: true } },
                issuedByTutor: { select: { englishName: true } },
              },
            })
          : Promise.resolve([]),
        termIds.length
          ? ctx.db.tutorMeeting.findMany({
              where: { termId: { in: termIds } },
              orderBy: { date: "desc" },
              select: {
                id: true,
                title: true,
                date: true,
                attendances: { select: { status: true, tutorId: true } },
              },
            })
          : Promise.resolve([]),
        ctx.db.serviceHourAdjustment.findMany({
          where: periodWhere,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            type: true,
            amount: true,
            reason: true,
            tutor: { select: { englishName: true } },
          },
        }),
      ]);

      // Per-tutor meeting attendance summary for the period (present / excused / unexcused).
      const mTally = new Map<string, { present: number; excused: number; unexcused: number }>();
      for (const m of meetings) {
        for (const r of m.attendances) {
          const e = mTally.get(r.tutorId) ?? { present: 0, excused: 0, unexcused: 0 };
          if (r.status === "PRESENT") e.present++;
          else if (r.status === "EXCUSED_ABSENT") e.excused++;
          else if (r.status === "UNEXCUSED_ABSENT") e.unexcused++;
          mTally.set(r.tutorId, e);
        }
      }
      const tutorNameById = new Map(tutors.map((t) => [t.id, t.englishName]));
      const meetingStats = [...mTally.entries()]
        .map(([id, c]) => ({ tutorId: id, tutor: tutorNameById.get(id) ?? "?", ...c }))
        .filter((x) => x.present + x.excused + x.unexcused > 0)
        .sort(
          (a, b) =>
            b.unexcused - a.unexcused || b.excused - a.excused || a.tutor.localeCompare(b.tutor),
        );

      // Crew patrol tallies (per crew member) + the period's attendance-discrepancy flags.
      const [patrolAgg, flagRows] = await Promise.all([
        termIds.length
          ? ctx.db.patrol.groupBy({
              by: ["crewUserId"],
              where: { termId: { in: termIds } },
              _count: { _all: true },
              _sum: { hours: true },
            })
          : Promise.resolve([] as { crewUserId: string; _count: { _all: number }; _sum: { hours: number | null } }[]),
        ctx.db.sessionFlag.findMany({
          where: { session: periodWhere },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            expected: true,
            observed: true,
            state: true,
            tutor: { select: { englishName: true } },
            session: { select: { date: true, pairing: { select: { subject: true } } } },
          },
        }),
      ]);
      const crewUserIds = patrolAgg.map((p) => p.crewUserId);
      const crewUsers = crewUserIds.length
        ? await ctx.db.user.findMany({
            where: { id: { in: crewUserIds } },
            select: { id: true, name: true, username: true },
          })
        : [];
      const crewNameById = new Map(crewUsers.map((u) => [u.id, u.name ?? u.username ?? "?"]));
      const crewStats = patrolAgg
        .map((p) => ({
          userId: p.crewUserId,
          member: crewNameById.get(p.crewUserId) ?? "?",
          patrols: p._count._all,
          hours: p._sum.hours ?? 0,
        }))
        .sort((a, b) => b.patrols - a.patrols || a.member.localeCompare(b.member));
      const flags = flagRows.map((f) => ({
        id: f.id,
        date: f.session.date,
        tutor: f.tutor.englishName,
        subject: f.session.pairing.subject,
        expected: f.expected,
        observed: f.observed,
        state: f.state,
      }));

      const detailed = {
        ...base,
        meetingStats,
        crewStats,
        flags,
        sessions: sessions.map((s) => ({
          id: s.id,
          date: s.date,
          tutor: s.tutor.englishName,
          subject: s.pairing.subject,
          tutorStatus: s.tutorStatus,
          shCount: s.shCount,
          // Free-text comments are withheld when the report is masked (incl. for VIEWER).
          comments: mask ? null : s.comments,
          tutees: s.tutees.map((tt) => ({ name: tt.tutee.englishName, status: tt.status })),
        })),
        cards: cards.map((c) => ({
          id: c.id,
          date: c.createdAt,
          tutee: c.tutee.englishName,
          color: c.color,
          source: c.source,
          reviewStatus: c.reviewStatus,
          reason: mask ? null : c.reason,
          issuedBy: c.issuedByTutor?.englishName ?? null,
        })),
        meetings: meetings.map((m) => {
          const a = { present: 0, excused: 0, unexcused: 0 };
          for (const r of m.attendances) {
            if (r.status === "PRESENT") a.present++;
            else if (r.status === "EXCUSED_ABSENT") a.excused++;
            else if (r.status === "UNEXCUSED_ABSENT") a.unexcused++;
          }
          return { id: m.id, title: m.title, date: m.date, ...a };
        }),
        adjustments: adjustments.map((a) => ({
          id: a.id,
          date: a.createdAt,
          tutor: a.tutor.englishName,
          type: a.type,
          amount: a.amount,
          reason: mask ? null : a.reason,
        })),
      };
      if (input.depth === "detailed") {
        return {
          ...detailed,
          applications: [] as never[],
          signups: [] as never[],
          removals: [] as never[],
          statusRequests: [] as never[],
        };
      }

      // ---- Full: recruitment + roster changes ----
      const [applications, signups, removals, statusRequests] = await Promise.all([
        wq
          ? ctx.db.tutorApplication.findMany({
              where: wq,
              orderBy: { createdAt: "desc" },
              select: { id: true, createdAt: true, name: true, status: true, email: true, preferredContact: true },
            })
          : Promise.resolve([]),
        wq
          ? ctx.db.tutee.findMany({
              where: wq,
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                createdAt: true,
                englishName: true,
                gradeLevel: true,
                status: true,
                email: true,
                phone: true,
                preferredContact: true,
                firstChoice: { select: { name: true } },
                secondChoice: { select: { name: true } },
              },
            })
          : Promise.resolve([]),
        wq
          ? ctx.db.tuteeRemovalRequest.findMany({
              where: wq,
              orderBy: { createdAt: "desc" },
              select: { id: true, createdAt: true, kind: true, state: true, tutee: { select: { englishName: true } } },
            })
          : Promise.resolve([]),
        wq
          ? ctx.db.tutorStatusRequest.findMany({
              where: wq,
              orderBy: { createdAt: "desc" },
              select: { id: true, createdAt: true, kind: true, state: true, tutor: { select: { englishName: true } } },
            })
          : Promise.resolve([]),
      ]);

      return {
        ...detailed,
        applications: applications.map((a) => ({
          id: a.id,
          date: a.createdAt,
          name: a.name,
          status: a.status,
          contact: maskContact(a.preferredContact ?? a.email),
        })),
        signups: signups.map((s) => ({
          id: s.id,
          date: s.createdAt,
          name: s.englishName,
          grade: s.gradeLevel,
          status: s.status,
          firstChoice: s.firstChoice?.name ?? null,
          secondChoice: s.secondChoice?.name ?? null,
          contact: maskContact(s.preferredContact ?? s.email ?? s.phone),
        })),
        removals: removals.map((r) => ({
          id: r.id,
          date: r.createdAt,
          tutee: r.tutee.englishName,
          kind: r.kind,
          state: r.state,
        })),
        statusRequests: statusRequests.map((r) => ({
          id: r.id,
          date: r.createdAt,
          tutor: r.tutor.englishName,
          kind: r.kind,
          state: r.state,
        })),
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
      // A staged Quarter System change activates at THIS refresh (applyPendingFeatures runs first),
      // so the advance granularity uses the about-to-apply value: off => step a whole semester.
      const qs = await ctx.db.programFeature.findUnique({
        where: { key: "QUARTER_SYSTEM" },
        select: { enabled: true, pendingEnabled: true },
      });
      const semesterMode = !(qs?.pendingEnabled ?? qs?.enabled ?? true);
      const np = nextPeriod(from, semesterMode);
      const name = periodLabel(np, semesterMode);
      const semesterCross = crossesSemester(from, np);
      const yearCross = crossesYear(from, np);

      const out = await ctx.db.$transaction(async (tx) => {
        // Activate any HEAD-staged optional-module toggles at this period boundary.
        await applyPendingFeatures(tx);
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
        // Quarter mode graduates G12 entering Q4 (so they finish the year inactive); semester mode
        // has no Q4, so it graduates at the school-year boundary alongside aging-up.
        let graduated = 0;
        let aged = 0;
        if (semesterMode ? yearCross : np.quarter === "Q4") {
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
      const prev = await ctx.db.tutor.findUnique({
        where: { id: input.id },
        select: { status: true },
      });
      const updated = await ctx.db.tutor.update({
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
      // On an ACTIVE -> inactive transition, re-queue this tutor's tutees so none are stranded on
      // a tutor who can no longer serve them (mirrors opt-out / can-tutor-off). Only on the actual
      // transition, so re-saving an already-inactive tutor doesn't disturb anything.
      if (prev?.status === "ACTIVE" && input.status !== "ACTIVE") {
        await requeueTutorActiveTermTutees(ctx.db, input.id);
      }
      return updated;
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
      // Removing a tutee (→ INACTIVE) detaches them from their pairings so they drop off tutors'
      // rosters/attendance immediately. Session history is kept. (Re-activating doesn't re-pair —
      // a coordinator reassigns on /admin/requests, consistent with requeueTutorTutees.)
      if (input.status === "INACTIVE" && prev.status !== "INACTIVE") {
        await ctx.db.pairingTutee.deleteMany({ where: { tuteeId: input.id } });
      }
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
    .mutation(async ({ ctx, input }) => {
      if (input.endMin <= input.startMin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
      }
      const { id, ...data } = input;
      const durationMin = data.endMin - data.startMin;

      // One transaction keeps the catalog, copied pairing schedule, attendance history, and
      // derived service-hour totals from ever exposing a partially updated timetable.
      return ctx.db.$transaction(async (tx) => {
        const current = await tx.timeSlot.findUniqueOrThrow({
          where: { id },
          select: { dayOfWeek: true, startMin: true, endMin: true },
        });
        const scheduleChanged =
          current.dayOfWeek !== data.dayOfWeek ||
          current.startMin !== data.startMin ||
          current.endMin !== data.endMin;
        const timeChanged = current.startMin !== data.startMin || current.endMin !== data.endMin;

        const slot = await tx.timeSlot.update({ where: { id }, data });
        if (!scheduleChanged) {
          return { ...slot, updatedPairings: 0, updatedSessions: 0 };
        }

        const pairings = await tx.pairing.updateMany({
          where: { timeSlotId: id },
          data: {
            dayOfWeek: data.dayOfWeek,
            startMin: data.startMin,
            endMin: data.endMin,
          },
        });

        // A weekday-only change does not alter a submitted session's actual calendar date. Clock
        // edits do flow to every session stamped with this slot, including sessions from pairings
        // that have since moved elsewhere.
        if (!timeChanged) {
          return { ...slot, updatedPairings: pairings.count, updatedSessions: 0 };
        }

        const sessions = await tx.session.findMany({
          where: { timeSlotId: id },
          select: { id: true, shFactor: true },
        });
        const idsByCount = new Map<number, string[]>();
        for (const session of sessions) {
          const recalculated = shCount(durationMin, session.shFactor);
          const ids = idsByCount.get(recalculated) ?? [];
          ids.push(session.id);
          idsByCount.set(recalculated, ids);
        }

        // Grouping by the resulting credit avoids issuing one update query per session. Merged
        // sibling sessions already carry factor 0, so they correctly remain at zero hours.
        await Promise.all(
          [...idsByCount].map(([recalculated, sessionIds]) =>
            tx.session.updateMany({
              where: { id: { in: sessionIds } },
              data: {
                startMin: data.startMin,
                endMin: data.endMin,
                durationMin,
                shCount: recalculated,
              },
            }),
          ),
        );

        return {
          ...slot,
          updatedPairings: pairings.count,
          updatedSessions: sessions.length,
        };
      });
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
    .mutation(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "MEETINGS");
      return ctx.db.tutorMeeting.create({ data: input });
    }),

  deleteMeeting: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "MEETINGS");
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
      await assertFeatureEnabled(ctx.db, "MEETINGS");
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
    .query(async ({ ctx, input }) => {
      const isViewer = ctx.session.role === "VIEWER";
      const rows = await ctx.db.serviceHourAdjustment.findMany({
        where: input?.month ? { month: input.month } : {},
        orderBy: { createdAt: "desc" },
        include: { tutor: { select: { englishName: true } } },
      });
      // Withhold the staff-entered adjustment reason from VIEWER.
      return isViewer ? rows.map((r) => ({ ...r, reason: null })) : rows;
    }),

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
      await assertFeatureEnabled(ctx.db, "SERVICE_HOURS");
      // Stamp the active program period so the adjustment counts toward the right semester.
      const period = await getActivePeriod(ctx.db);
      return ctx.db.serviceHourAdjustment.create({
        data: { ...input, schoolYear: period.schoolYear, quarter: period.quarter },
      });
    }),

  deleteAdjustment: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "SERVICE_HOURS");
      return ctx.db.serviceHourAdjustment.delete({ where: { id: input.id } });
    }),

  // --------------------------------------------------------------------------
  // Tutor applications + interview assignment
  // --------------------------------------------------------------------------
  tutorApplications: viewerProcedure.query(async ({ ctx }) => {
    const isViewer = ctx.session.role === "VIEWER";
    const apps = await ctx.db.tutorApplication.findMany({
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
    });
    if (!isViewer) return apps;
    // Withhold panelist deliberation free-text (vote comments) from VIEWER.
    return apps.map((a) => ({
      ...a,
      votes: a.votes.map((v) => ({ ...v, comment: null })),
    }));
  }),

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
      await assertFeatureEnabled(ctx.db, "INTERVIEWS");
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
    const isViewer = ctx.session.role === "VIEWER";
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
      // Withhold the member-entered request reason from VIEWER.
      reason: isViewer ? null : r.reason,
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
      const requeued = await requeueTutorActiveTermTutees(ctx.db, input.tutorId);
      if (requeued > 0) {
        await recordAudit({
          userId: ctx.session.user.id,
          userName: ctx.session.user.name,
          action: `Re-queued ${requeued} tutee(s) from an opted-out tutor`,
          entity: "Tutor",
          entityId: input.tutorId,
        });
      }
      return { ok: true, requeued };
    }),

  // --------------------------------------------------------------------------
  // Tutee opt-outs & removals — the combined "/admin/tutee-requests" surface
  // --------------------------------------------------------------------------
  /**
   * Two lists for the combined page: `pendingOptOuts` (relayed opt-outs still in their recall
   * window — an admin can cancel them, or they auto-approve) and `finalized` (tutees currently
   * removed: opted-out or discipline-removed, each reinstatable). Finalizes any due opt-outs first
   * so the page reflects auto-approvals lazily (no scheduler).
   */
  tuteeRemovalRequests: viewerProcedure.query(async ({ ctx }) => {
    const isViewer = ctx.session.role === "VIEWER";
    await finalizeDueOptOuts(ctx.db);
    const [pending, finalized] = await Promise.all([
      ctx.db.tuteeRemovalRequest.findMany({
        where: { kind: "VOLUNTARY", state: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          reason: true,
          createdAt: true,
          eligibleAt: true,
          pairingId: true,
          requestedByTutorId: true,
          tutee: { select: { id: true, englishName: true } },
        },
      }),
      ctx.db.tuteeRemovalRequest.findMany({
        where: { state: "APPROVED", tutee: { is: { status: "INACTIVE" } } },
        orderBy: { resolvedAt: "desc" },
        select: {
          id: true,
          kind: true,
          reason: true,
          resolvedAt: true,
          removedPeriodKey: true,
          requestedByTutorId: true,
          tutee: { select: { id: true, englishName: true } },
        },
      }),
    ]);

    // Resolve tutor names + pairing subjects in batch (requests store scalar ids).
    const tutorIds = [
      ...new Set(
        [...pending, ...finalized].map((r) => r.requestedByTutorId).filter(Boolean) as string[],
      ),
    ];
    const pairingIds = [...new Set(pending.map((r) => r.pairingId).filter(Boolean) as string[])];
    const [tutors, pairings] = await Promise.all([
      tutorIds.length
        ? ctx.db.tutor.findMany({ where: { id: { in: tutorIds } }, select: { id: true, englishName: true } })
        : Promise.resolve([]),
      pairingIds.length
        ? ctx.db.pairing.findMany({ where: { id: { in: pairingIds } }, select: { id: true, subject: true } })
        : Promise.resolve([]),
    ]);
    const tutorName = new Map(tutors.map((t) => [t.id, t.englishName]));
    const subject = new Map(pairings.map((p) => [p.id, p.subject]));

    return {
      pendingOptOuts: pending.map((r) => ({
        id: r.id,
        // Withhold the removal reason free-text from VIEWER.
        reason: isViewer ? null : r.reason,
        createdAt: r.createdAt,
        eligibleAt: r.eligibleAt,
        tutee: r.tutee,
        tutorName: r.requestedByTutorId ? (tutorName.get(r.requestedByTutorId) ?? null) : null,
        subject: r.pairingId ? (subject.get(r.pairingId) ?? null) : null,
      })),
      finalized: finalized.map((r) => ({
        id: r.id,
        kind: r.kind,
        reason: isViewer ? null : r.reason,
        resolvedAt: r.resolvedAt,
        period: r.removedPeriodKey,
        tutee: r.tutee,
        tutorName: r.requestedByTutorId ? (tutorName.get(r.requestedByTutorId) ?? null) : null,
      })),
    };
  }),

  /**
   * Cancel an in-flight opt-out during its recall window (admin override; the tutor can also
   * recall). Closes the request as DENIED — the tutee stays active. Notifies the relaying tutor.
   */
  cancelTuteeOptOut: adminProcedure
    .input(z.object({ requestId: cuid }))
    .mutation(async ({ ctx, input }) => {
      const req = await ctx.db.tuteeRemovalRequest.findUniqueOrThrow({
        where: { id: input.requestId },
        select: { id: true, state: true, kind: true, requestedByTutorId: true, tutee: { select: { englishName: true } } },
      });
      if (req.state !== "PENDING" || req.kind !== "VOLUNTARY") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No in-flight opt-out to cancel." });
      }
      await ctx.db.tuteeRemovalRequest.update({
        where: { id: req.id },
        data: {
          state: "DENIED",
          resolvedAt: new Date(),
          resolvedById: ctx.session.user.id,
          resolvedByName: ctx.session.user.name,
        },
      });
      if (req.requestedByTutorId) {
        const tutor = await ctx.db.tutor.findUnique({
          where: { id: req.requestedByTutorId },
          select: { user: { select: { id: true } } },
        });
        if (tutor?.user?.id) {
          await notifyUsers([tutor.user.id], {
            title: "Tutee opt-out cancelled",
            body: `An admin cancelled the opt-out for ${req.tutee.englishName}.`,
            link: "/dashboard",
          });
        }
      }
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Cancelled opt-out for ${req.tutee.englishName}`,
        entity: "TuteeRemovalRequest",
        entityId: req.id,
      });
      return { ok: true };
    }),

  /**
   * Reinstate a removed tutee (opted-out or discipline-removed): set them ACTIVE again and mark
   * the removal REINSTATED, which lifts any same-quarter re-signup flag. Pairings are NOT
   * restored automatically — reassign on /admin/requests.
   */
  reinstateTutee: adminProcedure
    .input(z.object({ requestId: cuid }))
    .mutation(async ({ ctx, input }) => {
      const req = await ctx.db.tuteeRemovalRequest.findUniqueOrThrow({
        where: { id: input.requestId },
        select: { id: true, state: true, tuteeId: true, tutee: { select: { englishName: true } } },
      });
      if (req.state !== "APPROVED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This removal isn't in effect." });
      }
      await ctx.db.$transaction([
        ctx.db.tutee.update({ where: { id: req.tuteeId }, data: { status: "PENDING" } }),
        ctx.db.tuteeRemovalRequest.update({
          where: { id: req.id },
          data: {
            state: "REINSTATED",
            resolvedAt: new Date(),
            resolvedById: ctx.session.user.id,
            resolvedByName: ctx.session.user.name,
          },
        }),
      ]);
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Reinstated ${req.tutee.englishName}`,
        entity: "TuteeRemovalRequest",
        entityId: req.id,
      });
      return { ok: true };
    }),

  // --------------------------------------------------------------------------
  // Crew patrols — membership + patrol order config, and the attendance-flag review queue
  // --------------------------------------------------------------------------
  /** Set a crew member's lifecycle status: ACTIVE (enable/re-enable), INACTIVE (soft-remove,
   *  revertible), or OPTED_OUT. Use a crew registration code to add a brand-new crew member. */
  setCrewStatus: adminProcedure
    .input(z.object({ userId: cuid, status: z.enum(["ACTIVE", "INACTIVE", "OPTED_OUT"]) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.user.update({ where: { id: input.userId }, data: { crewStatus: input.status } });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Set crew status to ${input.status}`,
        entity: "User",
        entityId: input.userId,
      });
      return { ok: true };
    }),

  /** Hard-delete a crew-only login (role CREW). Soft-remove (INACTIVE) is preferred + revertible;
   *  this is the explicit, irreversible option. Guarded to crew-only accounts so it can never nuke
   *  a tutor/admin login. Patrols + requests cascade. */
  deleteCrewMember: adminOnlyProcedure
    .input(z.object({ userId: cuid }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { id: true, role: true, name: true, email: true },
      });
      if (target.role !== "CREW") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only crew-only logins can be deleted here. Use Users & Roles for other accounts.",
        });
      }
      await ctx.db.user.delete({ where: { id: target.id } });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Deleted crew account ${target.name ?? target.email}`,
        entity: "User",
        entityId: target.id,
      });
      return { ok: true };
    }),

  /** Rooms in their current patrol order, for the order editor. */
  patrolOrder: viewerProcedure.query(({ ctx }) =>
    ctx.db.room.findMany({
      orderBy: [{ patrolOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, patrolOrder: true },
    }),
  ),

  /** Crew members (anyone with a crewStatus) + their patrol tally. Crew hours are separate from
   *  tutoring. Crew-only logins (role CREW) can be hard-deleted; tutor-crew are managed via status. */
  crewRoster: viewerProcedure.query(async ({ ctx }) => {
    const [users, agg] = await Promise.all([
      ctx.db.user.findMany({
        where: { crewStatus: { not: null } },
        orderBy: { name: "asc" },
        // Fall back to username (never email) for the label — emails are PII masked from VIEWER, and
        // the unmasked `name` key must never carry one.
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          crewStatus: true,
          tutor: { select: { englishName: true } },
        },
      }),
      ctx.db.patrol.groupBy({ by: ["crewUserId"], _sum: { hours: true }, _count: { _all: true } }),
    ]);
    const byUser = new Map(agg.map((p) => [p.crewUserId, { hours: p._sum.hours ?? 0, count: p._count._all }]));
    const rank = { ACTIVE: 0, OPTED_OUT: 1, INACTIVE: 2 } as Record<string, number>;
    return users
      .map((u) => ({
        id: u.id,
        name: u.name ?? u.username ?? "—",
        tutor: u.tutor?.englishName ?? null,
        crewOnly: u.role === "CREW",
        status: u.crewStatus ?? "INACTIVE",
        patrols: byUser.get(u.id)?.count ?? 0,
        hours: byUser.get(u.id)?.hours ?? 0,
      }))
      // Active first, then by patrol count.
      .sort(
        (a, b) =>
          (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
          b.patrols - a.patrols ||
          a.name.localeCompare(b.name),
      );
  }),

  /** Save the crew's room patrol order (roomIds in the order they should be visited). */
  setPatrolOrder: adminProcedure
    .input(z.object({ roomIds: z.array(cuid).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(
        input.roomIds.map((id, i) =>
          ctx.db.room.update({ where: { id }, data: { patrolOrder: i } }),
        ),
      );
      return { ok: true };
    }),

  /** Headline crew totals for the dashboard + activity: patrols, crew hours, open discrepancy
   *  flags, active members, and the pending application / opt-out request counts. */
  crewSummary: viewerProcedure.query(async ({ ctx }) => {
    const [patrolAgg, flagCount, crewCount, appCount, reqCount] = await Promise.all([
      ctx.db.patrol.aggregate({ _sum: { hours: true }, _count: { _all: true } }),
      ctx.db.sessionFlag.count({ where: { state: "PENDING" } }),
      ctx.db.user.count({ where: { crewStatus: "ACTIVE" } }),
      ctx.db.crewApplication.count({ where: { status: "PENDING" } }),
      ctx.db.crewStatusRequest.count({ where: { state: "PENDING" } }),
    ]);
    return {
      patrols: patrolAgg._count._all,
      hours: patrolAgg._sum.hours ?? 0,
      openFlags: flagCount,
      members: crewCount,
      openApplications: appCount,
      openRequests: reqCount,
    };
  }),

  /** Pending crew applications (public "apply to be crew" submissions), earliest-first. */
  crewApplications: viewerProcedure.query(async ({ ctx }) => {
    const isViewer = ctx.session.role === "VIEWER";
    const apps = await ctx.db.crewApplication.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        gradeLevel: true,
        preferredContact: true,
        message: true,
        createdAt: true,
      },
    });
    // Withhold the applicant's free-text message from VIEWER.
    return isViewer ? apps.map((a) => ({ ...a, message: null })) : apps;
  }),

  /** Accepted crew applications with an outstanding (unused, unexpired) code — so the issued code
   *  stays visible on /admin/crew where it was issued. The code is withheld from the VIEWER.
   *  Revoking the code on /admin/registration-codes reverts the application to PENDING. */
  crewIssuedCodes: viewerProcedure.query(async ({ ctx }) => {
    const canSee = ctx.session.role !== "VIEWER";
    const codes = await ctx.db.registrationCode.findMany({
      where: { crewApplicationId: { not: null }, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, code: true, label: true, expiresAt: true, crewApplicationId: true },
    });
    const appIds = codes.map((c) => c.crewApplicationId).filter((x): x is string => !!x);
    const apps = appIds.length
      ? await ctx.db.crewApplication.findMany({ where: { id: { in: appIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(apps.map((a) => [a.id, a.name]));
    return codes.map((c) => ({
      id: c.id,
      code: canSee ? c.code : null,
      name: (c.crewApplicationId ? nameById.get(c.crewApplicationId) : null) ?? c.label ?? "—",
      expiresAt: c.expiresAt,
    }));
  }),

  /** Decide a crew application: ACCEPT issues a CREW registration code bound to the applicant's
   *  email (shown on /admin/registration-codes to hand over); REJECT closes it. */
  decideCrewApplication: adminProcedure
    .input(z.object({ applicationId: cuid, action: z.enum(["ACCEPT", "REJECT"]), comment: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.crewApplication.findUniqueOrThrow({
        where: { id: input.applicationId },
        select: { id: true, name: true, email: true, status: true },
      });
      if (app.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This application is already decided." });
      }
      let code: string | null = null;
      if (input.action === "ACCEPT") {
        const issued = await issueRegistrationCode({
          email: app.email,
          kind: "CREW",
          crewApplicationId: app.id,
          label: `${app.name} (crew)`,
          issuedById: ctx.session.user.id,
          issuedByName: ctx.session.user.name,
        });
        code = issued.code;
      }
      await ctx.db.crewApplication.update({
        where: { id: app.id },
        data: {
          status: input.action === "ACCEPT" ? "ACCEPTED" : "REJECTED",
          decisionComment: input.comment?.trim() ? input.comment.trim() : null,
          decidedByName: ctx.session.user.name,
          decidedAt: new Date(),
        },
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `${input.action === "ACCEPT" ? "Accepted" : "Rejected"} crew application from ${app.name}`,
        entity: "CrewApplication",
        entityId: app.id,
      });
      return { ok: true, code };
    }),

  /** Pending crew opt-out/reentry requests (member-initiated), earliest-first. Opt-out becomes
   *  approvable only after its recall cooldown elapses. */
  crewRequests: viewerProcedure.query(async ({ ctx }) => {
    const isViewer = ctx.session.role === "VIEWER";
    const now = new Date();
    const reqs = await ctx.db.crewStatusRequest.findMany({
      where: { state: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        eligibleAt: true,
        reason: true,
        createdAt: true,
        user: { select: { id: true, name: true, username: true } },
      },
    });
    return reqs.map((r) => ({
      id: r.id,
      kind: r.kind,
      member: r.user.name ?? r.user.username ?? "—",
      // Withhold the member-entered request reason from VIEWER.
      reason: isViewer ? null : r.reason,
      eligibleAt: r.eligibleAt,
      approvable: r.kind === "REENTRY" || !r.eligibleAt || r.eligibleAt <= now,
      createdAt: r.createdAt,
    }));
  }),

  /** Approve or deny a crew opt-out/reentry request. Approving OPT_OUT sets crewStatus OPTED_OUT
   *  (only after the cooldown); approving REENTRY sets ACTIVE. The member is notified. */
  decideCrewRequest: adminProcedure
    .input(z.object({ requestId: cuid, action: z.enum(["APPROVE", "DENY"]) }))
    .mutation(async ({ ctx, input }) => {
      const req = await ctx.db.crewStatusRequest.findUniqueOrThrow({
        where: { id: input.requestId },
        select: { id: true, kind: true, state: true, eligibleAt: true, userId: true },
      });
      if (req.state !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This request is already decided." });
      }
      if (input.action === "APPROVE" && req.kind === "OPT_OUT" && req.eligibleAt && req.eligibleAt > new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The recall cooldown hasn't elapsed yet." });
      }
      await ctx.db.crewStatusRequest.update({
        where: { id: req.id },
        data: { state: input.action === "APPROVE" ? "APPROVED" : "DENIED", decidedByName: ctx.session.user.name, decidedAt: new Date() },
      });
      if (input.action === "APPROVE") {
        await ctx.db.user.update({
          where: { id: req.userId },
          data: { crewStatus: req.kind === "OPT_OUT" ? "OPTED_OUT" : "ACTIVE" },
        });
      }
      await notifyUsers([req.userId], {
        title: "Crew request",
        body:
          input.action === "DENY"
            ? "Your crew request was declined."
            : req.kind === "OPT_OUT"
              ? "Your crew opt-out was approved."
              : "Welcome back — your crew reentry was approved.",
        link: "/patrol",
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `${input.action === "APPROVE" ? "Approved" : "Denied"} crew ${req.kind} request`,
        entity: "CrewStatusRequest",
        entityId: req.id,
      });
      return { ok: true };
    }),

  /** Open (PENDING) attendance-discrepancy flags — the crew saw fewer students than reported. */
  sessionFlags: viewerProcedure.query(async ({ ctx }) => {
    const flags = await ctx.db.sessionFlag.findMany({
      where: { state: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        expected: true,
        observed: true,
        createdAt: true,
        tutor: { select: { englishName: true } },
        session: {
          select: {
            id: true,
            date: true,
            startMin: true,
            endMin: true,
            pairing: { select: { subject: true } },
            actualRoom: { select: { name: true } },
          },
        },
      },
    });
    return flags.map((f) => ({
      id: f.id,
      expected: f.expected,
      observed: f.observed,
      createdAt: f.createdAt,
      tutor: f.tutor.englishName,
      subject: f.session.pairing.subject,
      room: f.session.actualRoom?.name ?? null,
      date: f.session.date,
      startMin: f.session.startMin,
      endMin: f.session.endMin,
    }));
  }),

  /**
   * Decide a flagged session: dismiss as valid, record a warning, apply a service-hour penalty
   * (a PUNISHMENT adjustment for the session's period), or escalate for removal review. Notifies
   * the tutor (except a silent dismissal).
   */
  decideSessionFlag: adminProcedure
    .input(
      z.object({
        flagId: cuid,
        action: z.enum(["DISMISS", "WARN", "PENALIZE", "ESCALATE"]),
        note: z.string().trim().max(500).optional(),
        penaltyHours: z.number().min(0).max(24).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const flag = await ctx.db.sessionFlag.findUniqueOrThrow({
        where: { id: input.flagId },
        select: {
          id: true,
          state: true,
          tutorId: true,
          tutor: { select: { englishName: true, user: { select: { id: true } } } },
          session: { select: { schoolYear: true, quarter: true, month: true } },
        },
      });
      if (flag.state !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This flag is already resolved." });
      }
      const stateByAction = {
        DISMISS: "DISMISSED",
        WARN: "WARNED",
        PENALIZE: "PENALIZED",
        ESCALATE: "ESCALATED",
      } as const;
      const note = input.note?.trim() ? input.note.trim() : null;

      await ctx.db.sessionFlag.update({
        where: { id: flag.id },
        data: {
          state: stateByAction[input.action],
          decisionNote: note,
          resolvedAt: new Date(),
          resolvedById: ctx.session.user.id,
          resolvedByName: ctx.session.user.name,
        },
      });

      if (input.action === "PENALIZE") {
        await ctx.db.serviceHourAdjustment.create({
          data: {
            tutorId: flag.tutorId,
            month: flag.session.month,
            schoolYear: flag.session.schoolYear,
            quarter: flag.session.quarter,
            type: "PUNISHMENT",
            amount: input.penaltyHours ?? 0.5,
            reason: `Attendance discrepancy (crew check)${note ? ` — ${note}` : ""}.`,
          },
        });
      }

      if (input.action !== "DISMISS" && flag.tutor.user?.id) {
        const body =
          input.action === "WARN"
            ? "An attendance entry was flagged after a crew check — a warning was recorded."
            : input.action === "PENALIZE"
              ? "An attendance entry was flagged after a crew check — a service-hour penalty was applied."
              : "An attendance entry was flagged after a crew check and escalated for review.";
        await notifyUsers([flag.tutor.user.id], { title: "Attendance review", body, link: "/dashboard" });
      }
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `${input.action} attendance flag for ${flag.tutor.englishName}`,
        entity: "SessionFlag",
        entityId: flag.id,
      });
      return { ok: true };
    }),

  // --------------------------------------------------------------------------
  // Registration codes (admins + coordinators) — the security keys handed to new tutors
  // --------------------------------------------------------------------------
  /**
   * Every registration code with its status. The plaintext code + issuer email are withheld from
   * the read-only VIEWER. `issuedByEmail` is the issuing admin/coordinator's email (resolved from
   * `issuedById`; null for system-issued codes, e.g. from an accepted application). Newest-first.
   */
  registrationCodes: viewerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    // The code + issuer email are withheld from the read-only VIEWER.
    const canSee = ctx.session.role !== "VIEWER";
    const codes = await ctx.db.registrationCode.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        code: true,
        kind: true,
        email: true,
        label: true,
        issuedById: true,
        issuedByName: true,
        tutorId: true,
        applicationId: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        tutor: { select: { englishName: true } },
      },
    });
    // Resolve the issuer's email (the admin/coordinator who issued the code).
    const issuerIds = [...new Set(codes.map((c) => c.issuedById).filter(Boolean) as string[])];
    const issuers = issuerIds.length
      ? await ctx.db.user.findMany({ where: { id: { in: issuerIds } }, select: { id: true, email: true } })
      : [];
    const issuerEmail = new Map(issuers.map((u) => [u.id, u.email]));
    return codes.map((c) => ({
      id: c.id,
      code: canSee ? c.code : null,
      kind: c.kind,
      email: c.email,
      label: c.label,
      issuedByName: c.issuedByName,
      issuedByEmail: canSee && c.issuedById ? (issuerEmail.get(c.issuedById) ?? null) : null,
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
        kind: z.enum(["TUTOR", "CREW"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // If bound to a tutor, default the label/email from that tutor for the menu.
      let label = input.label?.trim() ? input.label.trim() : null;
      let email = input.email?.trim() ? input.email.trim().toLowerCase() : null;
      const kind = input.kind ?? "TUTOR";
      if (kind === "TUTOR" && input.tutorId) {
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
        tutorId: kind === "TUTOR" ? (input.tutorId ?? null) : null,
        kind,
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
        select: { usedAt: true, crewApplicationId: true },
      });
      if (code.usedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This code has already been used." });
      }
      await ctx.db.$transaction(async (tx) => {
        await tx.registrationCode.delete({ where: { id: input.id } });
        // Revertability: revoking a crew-application code returns the application to the pending
        // queue (visible/actionable again on /admin/crew).
        if (code.crewApplicationId) {
          await tx.crewApplication.updateMany({
            where: { id: code.crewApplicationId, status: "ACCEPTED" },
            data: { status: "PENDING", decidedByName: null, decidedAt: null, decisionComment: null },
          });
        }
      });
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
    // Self-heal any tutor whose name was duplicated by the old single-word split (e.g. the
    // auto-created "Admin Admin") before listing, so the page mirrors clean data.
    await healDuplicatedTutorNames(ctx.db);
    const [term, users, unlinkedTutors, openCodes] = await Promise.all([
      ctx.db.term.findFirst({ where: { active: true }, select: { schoolYear: true } }),
      ctx.db.user.findMany({
        orderBy: { email: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          role: true,
          canTranslate: true,
          affiliation: true,
          suspendedAt: true,
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

    // Uphold the "every account has a username" invariant: backfill any login that predates the
    // field (e.g. a bootstrap admin who never had a tutor record), then reflect the new handles.
    const missingUsername = users.filter((u) => !u.username);
    if (missingUsername.length > 0) {
      await Promise.all(missingUsername.map((u) => ensureUserUsername(u.id)));
      const filled = await ctx.db.user.findMany({
        where: { id: { in: missingUsername.map((u) => u.id) } },
        select: { id: true, username: true },
      });
      const byId = new Map(filled.map((f) => [f.id, f.username]));
      for (const u of missingUsername) u.username = byId.get(u.id) ?? u.username;
    }

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
      username: u.username ?? u.tutor?.username ?? null,
      role: u.role,
      isSelf: u.id === ctx.session.user.id,
      tutorId: u.tutorId,
      tutor: u.tutor,
      tutorStatus: u.tutor?.status ?? null,
      classOf: classOf(u.tutor?.gradeLevel),
      canTranslate: u.canTranslate,
      tutorHasEmail: !!u.tutor?.email,
      // Viewer (VIEWER) identity + suspension state, for the suspend/reinstate controls.
      affiliation: u.affiliation,
      suspended: !!u.suspendedAt,
      // registered = finished setup; setup = login exists but not finished; (no "none"/"invited"
      // here — those only apply to login-less tutors below).
      account: u.emailVerifiedAt && !u.mustChangePassword ? "registered" : "setup",
    }));

    const tutorRows = unlinkedTutors.map((tu) => ({
      userId: null,
      name: tu.englishName,
      email: tu.email,
      username: tu.username,
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
      affiliation: null,
      suspended: false,
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
    .input(
      z.object({
        userId: cuid,
        role: z.enum(["VIEWER", "TUTOR", "COORDINATOR", "ADMIN"]),
        confirmPassword: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCallerPassword(ctx.session.user.id, input.confirmPassword);
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
    .input(z.object({ userId: cuid, confirmPassword: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertCallerPassword(ctx.session.user.id, input.confirmPassword);
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

  /**
   * Delete a login account (HEAD only, identity-confirmed). The linked Tutor record is NOT
   * deleted — the user's tutor link is dropped first so its username/class/history stay on the
   * roster and the person can be re-invited later (revertible). The login's personal rows
   * (notifications, acks, verification codes, reset tokens) cascade away; authored content
   * (announcements, card reviews, policy edits) is detached (set-null), not lost. You cannot
   * delete yourself or another head — transfer leadership first.
   */
  deleteUser: headProcedure
    .input(z.object({ userId: cuid, confirmPassword: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertCallerPassword(ctx.session.user.id, input.confirmPassword);
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot delete your own account." });
      }
      const target = await ctx.db.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { id: true, role: true, name: true, email: true, tutorId: true },
      });
      if (target.role === "HEAD") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Transfer leadership before deleting the head account.",
        });
      }
      await ctx.db.$transaction(async (tx) => {
        // Preserve the tutor: detach it from the login before deleting so the roster row
        // (username, class, attendance history) survives.
        if (target.tutorId) {
          await tx.user.update({ where: { id: target.id }, data: { tutorId: null } });
        }
        await tx.user.delete({ where: { id: target.id } });
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Deleted account ${target.name ?? target.email}`,
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

  /** Suspend a suspicious viewer (VIEWER) account: blocks access until reinstated; the user is
   *  notified and can appeal. Scoped to viewer accounts so it can't lock out staff. */
  suspendUser: adminProcedure
    .input(z.object({ userId: cuid, reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { id: true, role: true, name: true },
      });
      if (target.role !== "VIEWER") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only viewer (VIEWER) accounts can be suspended." });
      }
      await ctx.db.user.update({
        where: { id: target.id },
        data: { suspendedAt: new Date(), suspendedReason: input.reason?.trim() ? input.reason.trim() : null },
      });
      await notifyUsers([target.id], {
        title: "Account suspended",
        body: "Your account access was suspended pending review. You can submit an appeal.",
        link: "/suspended",
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Suspended viewer ${target.name ?? target.id}`,
        entity: "User",
        entityId: target.id,
      });
      return { ok: true };
    }),

  /** Reinstate a suspended account (clears suspension, approves any pending appeal). */
  reinstateUser: adminProcedure
    .input(z.object({ userId: cuid }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: input.userId },
          data: { suspendedAt: null, suspendedReason: null },
        });
        await tx.accountAppeal.updateMany({
          where: { userId: input.userId, state: "PENDING" },
          data: { state: "APPROVED", decidedByName: ctx.session.user.name, decidedAt: new Date() },
        });
      });
      await notifyUsers([input.userId], {
        title: "Account reinstated",
        body: "Your account access has been restored.",
        link: "/",
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: "Reinstated a suspended account",
        entity: "User",
        entityId: input.userId,
      });
      return { ok: true };
    }),

  /** Pending reinstatement appeals from suspended users. */
  appeals: adminProcedure.query(({ ctx }) =>
    ctx.db.accountAppeal
      .findMany({
        where: { state: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          message: true,
          createdAt: true,
          user: { select: { id: true, name: true, username: true, affiliation: true } },
        },
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          message: r.message,
          createdAt: r.createdAt,
          userId: r.user.id,
          name: r.user.name ?? r.user.username ?? "—",
          affiliation: r.user.affiliation,
        })),
      ),
  ),

  /** Decide an appeal: APPROVE reinstates the account; DENY keeps it suspended. User notified. */
  decideAppeal: adminProcedure
    .input(z.object({ appealId: cuid, action: z.enum(["APPROVE", "DENY"]) }))
    .mutation(async ({ ctx, input }) => {
      const appeal = await ctx.db.accountAppeal.findUniqueOrThrow({
        where: { id: input.appealId },
        select: { id: true, state: true, userId: true },
      });
      if (appeal.state !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This appeal is already decided." });
      }
      await ctx.db.$transaction(async (tx) => {
        await tx.accountAppeal.update({
          where: { id: appeal.id },
          data: {
            state: input.action === "APPROVE" ? "APPROVED" : "DENIED",
            decidedByName: ctx.session.user.name,
            decidedAt: new Date(),
          },
        });
        if (input.action === "APPROVE") {
          await tx.user.update({
            where: { id: appeal.userId },
            data: { suspendedAt: null, suspendedReason: null },
          });
        }
      });
      await notifyUsers([appeal.userId], {
        title: input.action === "APPROVE" ? "Appeal approved" : "Appeal declined",
        body:
          input.action === "APPROVE"
            ? "Your account access has been restored."
            : "Your appeal was declined; your account stays suspended.",
        link: "/",
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `${input.action === "APPROVE" ? "Approved" : "Denied"} an account appeal`,
        entity: "AccountAppeal",
        entityId: appeal.id,
      });
      return { ok: true };
    }),

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
        // Archive the tutor but KEEP the link, so the account keeps its other attributes
        // (username, class, history) and the toggle is cleanly reversible. Re-enabling
        // reactivates the same record. (Tutor-area access is denied while ARCHIVED — see the
        // gate in (tutor)/layout.tsx.)
        if (user.tutorId) {
          await ctx.db.tutor.update({ where: { id: user.tutorId }, data: { status: "ARCHIVED" } });
          // Don't strand their tutees — re-queue them for reassignment (the chain's inverse).
          await requeueTutorActiveTermTutees(ctx.db, user.tutorId);
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
        // Derive a tutor name from the display name. A single-word name (e.g. "Admin") keeps an
        // empty last name — never duplicate it into "Admin Admin" (see splitDisplayName).
        const { firstName, lastName, englishName } = splitDisplayName(user.name ?? user.email);
        const usernameBase = lastName ? defaultUsername(firstName, lastName) : firstName;
        const username = await ensureUniqueUsername(usernameBase);
        const created = await ctx.db.tutor.create({
          data: {
            firstName,
            lastName,
            englishName,
            username,
            email: user.email,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        tutorId = created.id;
      }
      await ctx.db.user.update({ where: { id: user.id }, data: { tutorId } });
      // Guarantee the account carries a username (mirrors the linked tutor if it had none).
      await ensureUserUsername(user.id);
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
  disciplinaryCards: viewerProcedure.query(async ({ ctx }) => {
    const isViewer = ctx.session.role === "VIEWER";
    const cards = await ctx.db.disciplinaryCard.findMany({
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
    });
    // Withhold the card reason + staff review note free-text from VIEWER.
    return isViewer ? cards.map((c) => ({ ...c, reason: null, reviewNote: null })) : cards;
  }),

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
      await assertFeatureEnabled(ctx.db, "DISCIPLINE");
      const prev = await ctx.db.disciplinaryCard.findUniqueOrThrow({
        where: { id: input.id },
        select: {
          reviewStatus: true,
          reviewNote: true,
          tuteeId: true,
          tutee: { select: { englishName: true } },
        },
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
      // Validating a card can push the tutee over the removal threshold — auto-remove if so
      // (the helper sets them INACTIVE, detaches pairings, and notifies the tutor + admins).
      await syncPunishmentRemoval(ctx.db, prev.tuteeId);
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
