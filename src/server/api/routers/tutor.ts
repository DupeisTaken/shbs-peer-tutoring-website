import { notificationEvent } from "~/lib/notification-events";
import { isInterviewChairRole } from "~/lib/interview-chair";
import { meetingPeriodInput, meetingPeriodContext, meetingPeriods, meetingPeriodsOverlap, meetingScope, recordedMeetingPeriod } from "~/server/meeting-periods";
import {
  INTERVIEW_HOURS_REASON,
  interviewHoursId,
  interviewServiceInput,
  interviewHourRows,
  sameInterviewCompletionEvidence,
  recordInterviewApprovalService,
} from "~/server/interview-hours";
import { optionalPersonNameFields } from "~/lib/person-name";
import {
  saveWorkloadPreference,
  tutorWorkloads,
  workloadPreferenceInput,
} from "~/server/tutor-workload";
import { programRoomOrder } from "~/server/room-order";
import {
  assertRequestProcessable,
  lockApplicationReview,
} from "~/server/request-invalidity";
import { lockUsernameNamespace } from "~/server/auth/username";
import { MAX_CODE_ATTEMPTS } from "~/server/auth/registration";
import { requireSchoolParticipation } from "~/server/school-departure";
import { requireAcademicConfirmation } from "~/server/academics";
import { accountHistoryIds } from "~/server/account-history";
import {
  lockAccountProfile,
  updateAccountProfile,
} from "~/server/account-profile";
import { requestMembership, recallMembership } from "~/server/membership";
import { approvalScope } from "~/server/db-scope";
import { requirePolicy } from "~/server/policy-acceptance";
import { validateInterviewDecision } from "~/server/interviews";
import { reconcileMeetingHours } from "~/server/meeting-hours";
import { TRPCError } from "@trpc/server";
import { getProgramTimeZone } from "~/server/program/time-zone";
import { programDateKey } from "~/lib/program-time";
import { z } from "zod";
import { roomReference } from "~/lib/room-reference";
import { requireExistingRooms } from "~/server/room-references";
import { announcementVisibility } from "~/lib/announcement-recipients";
import { createHash } from "node:crypto";
import { inTransaction, lockEntity } from "~/server/transactions";
import { lockAttendanceSchedule } from "~/server/attendance-schedule";

import {
  activeTutorProcedure,
  createTRPCRouter,
  protectedProcedure,
  tutorProcedure,
} from "~/server/api/trpc";
import { computeSessionHours } from "~/lib/service-hours";
import { semesterQuarters } from "~/lib/period";
import { getActivePeriodOrNull } from "~/server/period";
import { reconcileApplication } from "~/server/tutors/application-status";
import { beginAdmissionRecoveryCapture, finishAdmissionRecoveryCapture } from "~/server/recovery/capture";
import { notifyAdmins, notifyTutors } from "~/server/notifications/create";
import { verifyPasswordConfirmation } from "~/server/auth/password-confirmation";
import { changeVerifiedPassword } from "~/server/auth/session-version";
import { issueStepUpCode, verifyStepUpCode } from "~/server/auth/step-up";
import { isEmailDeliveryAvailable } from "~/server/email/sender";
import { getFeatures, assertFeatureEnabled } from "~/server/program/features";
import { maskEmail } from "~/server/auth/mask";
import {
  TUTEE_OPT_OUT_COOLDOWN_DAYS,
  finalizeDueOptOuts,
  syncPunishmentRemoval,
} from "~/server/discipline/removal";
import { standingFromCounts } from "~/lib/discipline";
import { syncSessionFlag } from "~/server/crew/flags";
import { expectedUpdatedAt, staleConflict } from "~/server/concurrency";
import { lockPlannedRoomSchedule } from "~/server/room-bookings";
import { allocateAndPersistRoomUnit, assertRoomVersion, roomUnitInclude, roomUnitMembers } from "~/server/room-allocation";
import { pairingGroupEligibility } from "~/lib/pairing-group-eligibility";
import { pairingEntries } from "~/lib/pairing-groups";

const TUTOR_STATUS = [
  "PRESENT",
  "RESCHEDULED",
  "EXTRA",
  "TUTOR_ABSENT",
] as const;
const TUTEE_STATUS = ["PRESENT", "EXCUSED_ABSENT", "UNEXCUSED_ABSENT"] as const;

/** A tutor may self-excuse a meeting absence only up to this many minutes before it starts. */
const MEETING_EXCUSE_CUTOFF_MIN = 60;

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
  workloadPreference: tutorProcedure.query(async ({ ctx }) => {
    const workload = await tutorWorkloads(ctx.db, ctx.session.tutorId);
    const own = workload.tutors[0];
    return own
      ? {
          ...own,
          canEdit: own.status === "ACTIVE" && ctx.portalAccess.canParticipate,
        }
      : null;
  }),
  setWorkloadPreference: activeTutorProcedure
    .input(workloadPreferenceInput)
    .mutation(({ ctx, input }) =>
      saveWorkloadPreference(
        ctx.db,
        ctx.session.user.id,
        ctx.session.tutorId,
        input,
      ),
    ),
  /** The signed-in tutor's *current* pairings (active program period), with tutees/room/term. */
  myPairings: tutorProcedure.query(async ({ ctx }) => {
    return ctx.db.pairing.findMany({
      where: { tutorId: ctx.session.tutorId, term: { active: true } },
      orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
      include: {
        room: true,
        term: true,
        timeSlot: true,
        group: { select: { primaryPairingId: true } },
        // Removed (INACTIVE) tutees drop off the roster immediately — only show current ones.
        tutees: {
          where: { tutee: { status: { not: "INACTIVE" } } },
          include: {
            tutee: {
              select: {
                id: true,
                englishName: true,
                user: { select: { username: true } },
              },
            },
          },
        },
      },
    });
  }),

  /**
   * Disciplinary standing for each of the caller's active-term tutees — the 6-slot meter data
   * plus a reason-free card timeline (color / valid-or-pending / date). **Card reasons are
   * intentionally never returned to tutors** — only the count/standing is visible on their side.
   * Drives the meter in the attendance form and the punishment-history section.
   */
  myTuteeDiscipline: tutorProcedure.query(async ({ ctx }) => {
    const pairings = await ctx.db.pairing.findMany({
      where: { tutorId: ctx.session.tutorId, term: { active: true } },
      select: {
        tutees: {
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
    });
    // Current roster identity only; immutable session/audit name evidence stays raw.
    const names = new Map<string, { name: string; username: string | null }>();
    for (const p of pairings) {
      for (const x of p.tutees)
        names.set(x.tuteeId, {
          name: x.tutee.englishName,
          username: x.tutee.user?.username ?? null,
        });
    }
    const tuteeIds = [...names.keys()];
    if (tuteeIds.length === 0) return [];

    // VALID + PENDING cards only (INVALID don't count and aren't shown). No `reason` selected.
    const cards = await ctx.db.disciplinaryCard.findMany({
      where: {
        tuteeId: { in: tuteeIds },
        reviewStatus: { in: ["VALID", "PENDING"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tuteeId: true,
        color: true,
        reviewStatus: true,
        createdAt: true,
        session: { select: { date: true } },
      },
    });

    const byTutee = new Map<string, typeof cards>();
    for (const c of cards) {
      const list = byTutee.get(c.tuteeId) ?? [];
      list.push(c);
      byTutee.set(c.tuteeId, list);
    }

    return tuteeIds
      .map((id) => {
        const list = byTutee.get(id) ?? [];
        const counts = {
          validYellow: 0,
          validRed: 0,
          pendingYellow: 0,
          pendingRed: 0,
        };
        for (const c of list) {
          if (c.reviewStatus === "VALID") {
            if (c.color === "YELLOW") counts.validYellow++;
            else counts.validRed++;
          } else {
            if (c.color === "YELLOW") counts.pendingYellow++;
            else counts.pendingRed++;
          }
        }
        const standing = standingFromCounts(counts);
        return {
          tuteeId: id,
          englishName: names.get(id)?.name ?? "",
          username: names.get(id)?.username ?? null,
          validYellow: standing.validYellow,
          validRed: standing.validRed,
          pendingCount: counts.pendingYellow + counts.pendingRed,
          effectiveReds: standing.effectiveReds,
          removalPending: standing.removalPending,
          cards: list.map((c) => ({
            id: c.id,
            color: c.color,
            reviewStatus: c.reviewStatus,
            date: c.session?.date ?? c.createdAt,
          })),
        };
      })
      .sort(
        (a, b) =>
          b.effectiveReds - a.effectiveReds ||
          a.englishName.localeCompare(b.englishName),
      );
  }),

  /** Rooms catalogue (id + name) — for the "room used" picker on the attendance form. */
  rooms: tutorProcedure.query(({ ctx }) =>
    ctx.db.room.findMany({
      orderBy: [...programRoomOrder],
      select: { id: true, name: true },
    }),
  ),

  /** The signed-in tutor's crew patrol tally (separate from tutoring hours). Zero if not crew. */
  myCrew: tutorProcedure.query(async ({ ctx }) => {
    const me = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { crewStatus: true },
    });
    if (!me?.crewStatus) return { isCrew: false, patrols: 0, hours: 0 };
    const agg = await ctx.db.patrol.aggregate({
      where: {
        crewUserId: {
          in: await accountHistoryIds(ctx.db, ctx.session.user.id),
        },
      },
      _sum: { hours: true },
      _count: { _all: true },
    });
    return {
      isCrew: true,
      patrols: agg._count._all,
      hours: agg._sum.hours ?? 0,
    };
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
  submitAttendance: activeTutorProcedure
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
          // Where the session actually ran — the room used (defaults to the pairing's room) or
          // online. Used to match crew patrol observations to this session.
          actualRoomId: roomReference.nullable().optional(),
          online: z.boolean().optional(),
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
                reason: z
                  .string()
                  .trim()
                  .min(1, "Add a reason for each card")
                  .max(500),
              }),
            )
            .max(20)
            .optional(),
        })
        .superRefine((val, ctx) => {
          if (
            val.tutorStatus === "TUTOR_ABSENT" &&
            !val.tutorAbsentReason?.trim()
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["tutorAbsentReason"],
              message: "Give a reason for the tutor absence.",
            });
          }
          for (const [i, tuteeRow] of val.tutees.entries()) {
            if (
              tuteeRow.status === "EXCUSED_ABSENT" &&
              !tuteeRow.absenceReason?.trim()
            ) {
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
      // Attendance dates are school calendar dates stored at UTC midnight. Compare their date key
      // with today's configured school date so a server in another timezone cannot admit tomorrow.
      const schoolToday = programDateKey(
        new Date(),
        await getProgramTimeZone(ctx.db),
      );
      if (input.date.toISOString().slice(0, 10) > schoolToday) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Attendance cannot be submitted for a future school date.",
        });
      }
      // Discipline side-effects (auto-issued absence cards + tutor card requests + punishment
      // removal) only fire when the DISCIPLINE module is on; attendance + hours always record.
      const features = await getFeatures(ctx.db);
      // The block can cover several subjects (pairings). Primary first, then the merged ones.
      const mergeIds = [...new Set(input.mergePairingIds ?? [])].filter(
        (id) => id !== input.pairingId,
      );
      const allPairingIds = [input.pairingId, ...mergeIds];

      // Row scoping: every pairing in the block must belong to this tutor.
      const found = await ctx.db.pairing.findMany({
        where: { id: { in: allPairingIds }, tutorId },
        include: {
          tutees: { where: { tutee: { status: { not: "INACTIVE" } } }, select: { tuteeId: true } },
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
      const ordered = [
        primary,
        ...mergeIds.map((id) => found.find((p) => p.id === id)!),
      ];

      const tuteeRows = input.tutees;
      const cardRequests = input.cards ?? [];

      // Placeholder assignment times are never evidence of when a session actually ran.
      if (
        found.some((pairing) => !pairing.scheduleConfirmed) &&
        (input.startMin === undefined || input.endMin === undefined)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Enter actual start and end times for an assignment awaiting scheduling.",
        });
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

      // Where the block ran: online (no room) or a physical room (defaults to the primary
      // pairing's assigned room). Shared by every session in a merged block.
      const online = input.online ?? false;
      const actualRoomId = online
        ? null
        : (input.actualRoomId ?? primary.roomId ?? null);

      const ratings = {
        ratingPreparedness: input.ratingPreparedness,
        ratingParticipation: input.ratingParticipation,
        ratingUnderstanding: input.ratingUnderstanding,
        ratingBehavior: input.ratingBehavior,
        ratingProgress: input.ratingProgress,
      };

      return ctx.db.$transaction(
        async (tx) => {
          await lockAttendanceSchedule(tx);
          await lockEntity(tx, "policy:tutor-policy");
          await requirePolicy(tx, ctx.session.user.id, "tutor-policy");
          // Pairing subsets and slightly changed times must not buy a second credit for the
          // same teaching time. Serialize all of this tutor's submissions for the school date.
          const dateKey = input.date.toISOString().slice(0, 10);
          await lockEntity(tx, `attendance-day:${tutorId}:${dateKey}`);
          // Same tutoring block means one attendance record, even across retries/processes.
          const submissionKey = createHash("sha256")
            .update(
              JSON.stringify([
                tutorId,
                [...allPairingIds].sort(),
                input.date.toISOString().slice(0, 10),
                startMin,
                endMin,
              ]),
            )
            .digest("hex");
          const submissionPayloadHash = createHash("sha256")
            .update(
              JSON.stringify({
                ...input,
                tutees: [...input.tutees].sort((a, b) =>
                  a.tuteeId.localeCompare(b.tuteeId),
                ),
              }),
            )
            .digest("hex");
          await lockEntity(tx, `attendance:${submissionKey}`);
          const previous = await tx.session.findUnique({
            where: { submissionKey },
          });
          if (previous) {
            if (previous.submissionPayloadHash !== submissionPayloadHash)
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  "Attendance already exists for this block. Correct the existing entry instead.",
              });
            return {
              id: previous.id,
              month: previous.month,
              shCount: previous.shCount,
            };
          }
          // Preserve immutable receipt replay above, then re-read the selected
          // assignments under the same fence as roster/group/schedule writers.
          await lockPlannedRoomSchedule(tx);
          const currentMembers = await tx.pairing.findMany({
            where: { id: { in: allPairingIds }, tutorId },
            include: { tutees: { where: { tutee: { status: { not: "INACTIVE" } } }, select: { tuteeId: true } } },
          });
          // A tutor schedule may change while the initial attendance read waits
          // for this fence. Recheck defaults here; explicit actual clocks remain
          // independent, while linkage still identifies their catalog evidence.
          const currentPairing = currentMembers.find(member => member.id === primary.id);
          if (currentPairing?.timeSlotId !== primary.timeSlotId ||
            (input.startMin === undefined && (currentPairing?.startMin !== startMin || !currentPairing?.scheduleConfirmed)) ||
            (input.endMin === undefined && (currentPairing?.endMin !== endMin || !currentPairing?.scheduleConfirmed)))
            throw new TRPCError({ code: "CONFLICT", message: "The pairing schedule changed. Reload before recording attendance." });
          const rosterKey = (rows: readonly { tuteeId: string }[]) => rows.map(row => row.tuteeId).sort().join(":");
          if (currentMembers.length !== found.length || currentMembers.some(member => {
            const earlier = found.find(row => row.id === member.id);
            return earlier?.termId !== member.termId || earlier.subject !== member.subject ||
              rosterKey(earlier.tutees) !== rosterKey(member.tutees);
          })) throw new TRPCError({ code: "CONFLICT", message: "The assignment roster or subjects changed. Reload before recording attendance." });
          // New attendance uses the same active roster as the tutor reader.
          // Admission checks follow receipt replay so later roster changes cannot
          // invalidate immutable accepted evidence or turn a retry into a write.
          const rosterByPairing = new Map(currentMembers.map(member => [member.id,
            new Set(member.tutees.map(row => row.tuteeId))]));
          const unionRoster = new Set(currentMembers.flatMap(member => member.tutees.map(row => row.tuteeId)));
          const submittedIds = tuteeRows.map(row => row.tuteeId);
          const submittedIdSet = new Set(submittedIds);
          if (submittedIdSet.size !== submittedIds.length)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Record each tutee exactly once." });
          if (tuteeRows.some(row => !unionRoster.has(row.tuteeId)))
            throw new TRPCError({ code: "BAD_REQUEST", message: "Selected tutee is not on any of these pairings." });
          if (submittedIdSet.size !== unionRoster.size || [...unionRoster].some(id => !submittedIdSet.has(id)))
            throw new TRPCError({ code: "BAD_REQUEST", message: "Record attendance for every tutee in the selected block." });
          if (cardRequests.some(row => !unionRoster.has(row.tuteeId)))
            throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot card a tutee who is not on these pairings." });
          if (mergeIds.length && (currentMembers.some(member => member.termId !== primary.termId) ||
            !pairingGroupEligibility(currentMembers).eligible))
            throw new TRPCError({ code: "BAD_REQUEST", message: "Combined attendance requires every selected student to have the same complete set of subjects." });
          const explicitGroups = [...new Set(currentMembers.flatMap(member => member.groupId ? [member.groupId] : []))];
          if (mergeIds.length && explicitGroups.length) {
            const groupMembers = await tx.pairing.findMany({
              where: { groupId: { in: explicitGroups } },
              include: { group: { select: { primaryPairingId: true } },
                tutees: { where: { tutee: { status: { not: "INACTIVE" } } }, select: { tuteeId: true } } },
            });
            if (pairingEntries(groupMembers).some(entry => entry.groupStatus === "needsRepair"))
              throw new TRPCError({ code: "BAD_REQUEST", message: "This combined group needs repair. Repair or split it before recording attendance." });
          }
          await requireExistingRooms(tx, actualRoomId ? [actualRoomId] : []);
          const dayStart = new Date(`${dateKey}T00:00:00Z`);
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          const overlapping = await tx.session.findFirst({
            where: {
              tutorId,
              date: { gte: dayStart, lt: dayEnd },
              startMin: { lt: endMin },
              endMin: { gt: startMin },
            },
            select: { id: true },
          });
          if (overlapping)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Attendance already covers part of this time. Ask management to correct the saved block, including any combined subjects.",
            });
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
                submissionKey: isPrimary ? submissionKey : null,
                submissionPayloadHash: isPrimary ? submissionPayloadHash : null,
                // A merged block ran at the primary pairing's time, so every sibling retains that
                // same slot. This keeps the whole block together when an admin later edits it.
                timeSlotId: primary.timeSlotId,
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
                actualRoomId,
                online,
                tutees: {
                  create: rows.map((t) => ({
                    tuteeId: t.tuteeId,
                    status: t.status,
                    absenceReason:
                      t.status === "EXCUSED_ABSENT"
                        ? (t.absenceReason?.trim() ?? null)
                        : null,
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
            tuteeRows
              .filter((t) => t.status === "UNEXCUSED_ABSENT")
              .map((t) => t.tuteeId),
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
          if (features.DISCIPLINE && cardRows.length > 0) {
            await tx.disciplinaryCard.createMany({ data: cardRows });
          }

          const result = {
            id: primaryId,
            month: computed.month,
            shCount: computed.shCount,
          };

          // Tutor-requested cards need a team review — surface them for admins.
          if (features.DISCIPLINE && cardRequests.length > 0) {
            await notifyAdmins(
              {
                ...notificationEvent("attendance_cards_pending", {
                  count: cardRequests.length,
                }),
                title: "Discipline cards to review",
                body: `${cardRequests.length} card(s) submitted with an attendance survey.`,
                link: "/admin/discipline",
              },
              undefined,
              tx,
            );
          }

          // Auto-issued (VALID) red cards for unexcused absences can push a tutee over the removal
          // threshold — reconcile their punishment-removal request. (Tutor-requested cards stay
          // PENDING, so they don't count until reviewed.)
          const autoRedTuteeIds = [
            ...new Set(
              tuteeRows
                .filter((tt) => tt.status === "UNEXCUSED_ABSENT")
                .map((tt) => tt.tuteeId),
            ),
          ];
          // syncPunishmentRemoval removes immediately and notifies the tutor + admins itself.
          if (features.DISCIPLINE) {
            for (const tuteeId of autoRedTuteeIds) {
              await syncPunishmentRemoval(tx, tuteeId);
            }
          }

          // Historical reports remain truthful even when the actual room was allocated elsewhere.
          if (actualRoomId && input.tutorStatus !== "TUTOR_ABSENT") {
            const dayOfWeek = input.date.getUTCDay() || 7;
            const conflict = await tx.pairing.findFirst({
              where: {
                scheduleConfirmed: true,
                id: { notIn: ordered.map((p) => p.id) },
                termId: primary.termId,
                roomId: actualRoomId,
                dayOfWeek,
                startMin: { lt: endMin },
                endMin: { gt: startMin },
              },
            });
            const blocked = await tx.roomUnavailability.findFirst({
              where: {
                roomId: actualRoomId,
                dayOfWeek,
                startMin: { lt: endMin },
                endMin: { gt: startMin },
              },
            });
            if (conflict || blocked) {
              await tx.auditLog.create({
                data: {
                  userId: ctx.session.user.id,
                  entity: "Session",
                  entityId: result.id,
                  action: "Reported actual attendance in an allocated room",
                  details: {
                    roomId: actualRoomId,
                    conflictPairingId: conflict?.id ?? null,
                    blockId: blocked?.id ?? null,
                  },
                },
              });
              await notifyAdmins(
                {
                  ...notificationEvent("attendance_room_reported"),
                  title: "Attendance reported in an allocated room",
                  link: "/admin/attendance",
                },
                undefined,
                tx,
              );
            }
          }
          // Validate this entry against any crew patrol of the same room/time (raises a flag if the
          // crew saw fewer students than were marked present).
          await syncSessionFlag(tx, result.id);

          return result;
        },
        { timeout: 15000 },
      );
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
        select: {
          id: true,
          label: true,
          dayOfWeek: true,
          startMin: true,
          endMin: true,
        },
      }),
      ctx.db.tutorAvailability.findMany({
        where: { tutorId: ctx.session.tutorId },
        select: { slotId: true },
      }),
    ]);
    return { slots, selectedSlotIds: selected.map((s) => s.slotId) };
  }),

  /** Replace the signed-in tutor's availability with the given set of slot ids. */
  setAvailability: activeTutorProcedure
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
        ctx.db.tutorAvailability.deleteMany({
          where: { tutorId: ctx.session.tutorId },
        }),
        ctx.db.tutorAvailability.createMany({
          data: validIds.map((slotId) => ({
            tutorId: ctx.session.tutorId,
            slotId,
          })),
        }),
      ]);
      return { ok: true, count: validIds.length };
    }),

  /** The signed-in tutor's own domain record (used to gate the read-only inactive state). */
  me: tutorProcedure.query(({ ctx }) =>
    ctx.db.tutor.findUniqueOrThrow({
      where: { id: ctx.session.tutorId },
      select: {
        id: true,
        englishName: true,
        status: true,
        email: true,
        gradeLevel: true,
      },
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
        select: {
          englishName: true,
          username: true,
          alternativeNames: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          legacyName: true,
          gradeLevel: true,
        },
      }),
      ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { email: true, profileVersion: true },
      }),
    ]);
    return { ...tutor, email: user.email, profileVersion: user.profileVersion };
  }),

  /**
   * Update the tutor's own alternative name(s), contact email, and self-reported grade.
   * Grade is self-reported (handles retained grades); the class-of year is derived from it and
   * is NOT directly editable. Tutors can't change their own status here — that's the opt-out flow.
   */
  updateProfile: tutorProcedure
    .input(
      z.object({
        ...optionalPersonNameFields,
        expectedProfileVersion: z.number().int().nonnegative().optional(),
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
          throw new TRPCError({
            code: "CONFLICT",
            message: "That email is already in use.",
          });
        }
        const current = await ctx.db.user.findUniqueOrThrow({
          where: { id: ctx.session.user.id },
          select: { email: true },
        });
        if (email !== current.email)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Verify the new email using account email settings before changing it.",
          });
      }
      const tutorData: {
        alternativeNames?: string | null;
        gradeLevel?: number | null;
      } = {};
      if (input.alternativeNames !== undefined) {
        tutorData.alternativeNames = input.alternativeNames?.trim()
          ? input.alternativeNames.trim()
          : null;
      }
      if (input.gradeLevel !== undefined) {
        const current = await ctx.db.tutor.findUniqueOrThrow({
          where: { id: ctx.session.tutorId },
          select: { gradeLevel: true },
        });
        if (input.gradeLevel !== current.gradeLevel)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "ACADEMIC_SHARED_EDITOR_REQUIRED",
          });
      }
      if (
        Object.keys(tutorData).length > 0 ||
        input.firstName !== undefined ||
        input.lastName !== undefined ||
        input.preferredName !== undefined
      ) {
        await inTransaction(ctx.db, async (tx) => {
          await lockUsernameNamespace(tx);
          await lockAccountProfile(tx, ctx.session.user.id);
          await tx.tutor.update({
            where: { id: ctx.session.tutorId },
            data: tutorData,
          });
          await updateAccountProfile(tx, ctx.session.user.id, {
            firstName: input.firstName,
            lastName: input.lastName,
            preferredName: input.preferredName,
            expectedProfileVersion: input.expectedProfileVersion,
            alternativeNames: input.alternativeNames,
          });
        });
      }
      return { ok: true };
    }),

  /**
   * Step 1 of a password change: verify the current password, then email a one-time verification
   * code (step-up 2FA). Returns the masked address. The code is required in `changePassword`.
   */
  requestPasswordChangeCode: tutorProcedure
    .input(z.object({ currentPassword: z.string().min(1).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { passwordHash: true },
      });
      if (
        !verifyPasswordConfirmation(
          ctx.session.user.id,
          input.currentPassword,
          user.passwordHash,
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is incorrect.",
        });
      }
      const { EMAIL_2FA } = await getFeatures(ctx.db);
      if (!EMAIL_2FA) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Email two-factor authentication is disabled for this program.",
        });
      }
      if (!isEmailDeliveryAvailable("SECURITY")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email delivery is unavailable. Contact the program team.",
        });
      }
      const { email } = await issueStepUpCode(
        ctx.session.user.id,
        "PASSWORD_CHANGE",
      );
      return { sent: true, email: maskEmail(email) };
    }),

  /**
   * Step 2: change the tutor's own password. Requires the current password AND the emailed
   * verification code (issued by `requestPasswordChangeCode`). The code is single-use + expiring.
   */
  changePassword: tutorProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1).max(1024),
        newPassword: z.string().min(8, "Use at least 8 characters.").max(1024),
        code: z.string().trim().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { passwordHash: true },
      });
      if (
        !verifyPasswordConfirmation(
          ctx.session.user.id,
          input.currentPassword,
          user.passwordHash,
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is incorrect.",
        });
      }
      // The program flag gates the emailed step-up code. With the feature off, a verified current
      // password is sufficient; with it on, a delivery outage fails closed below.
      const { EMAIL_2FA } = await getFeatures(ctx.db);
      if (EMAIL_2FA) {
        if (!isEmailDeliveryAvailable("SECURITY")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Email delivery is unavailable. Contact the program team.",
          });
        }
        if (!input.code) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Request a verification code first.",
          });
        }
        const verified = await verifyStepUpCode(
          ctx.session.user.id,
          "PASSWORD_CHANGE",
          input.code,
        );
        if (!verified.ok) {
          const message =
            verified.error === "expired"
              ? "That code has expired. Request a new one."
              : verified.error === "too-many-attempts"
                ? "Too many attempts. Request a new code."
                : verified.error === "no-code"
                  ? "Request a verification code first."
                  : "That code is incorrect.";
          throw new TRPCError({ code: "BAD_REQUEST", message });
        }
      }
      await changeVerifiedPassword(
        ctx.db,
        ctx.session.user.id,
        user.passwordHash,
        input.newPassword,
      );
      return { ok: true };
    }),

  // --------------------------------------------------------------------------
  // Announcements: team broadcasts surfaced on the dashboard every login until acked.
  // --------------------------------------------------------------------------

  /** Active announcements, newest first, each flagged with whether the caller acked it. */
  myAnnouncements: tutorProcedure.query(async ({ ctx }) => {
    const announcements = await ctx.db.announcement.findMany({
      where: { active: true, ...announcementVisibility(ctx.session.tutorId) },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        body: true,
        pinned: true,
        createdAt: true,
        acks: {
          where: { userId: ctx.session.user.id },
          select: { userId: true },
        },
      },
    });
    return announcements.map(({ acks, ...a }) => ({
      ...a,
      acked: acks.length > 0,
    }));
  }),

  /** Mark an announcement acknowledged for the signed-in user (idempotent). */
  acknowledgeAnnouncement: tutorProcedure
    .input(z.object({ announcementId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const visible = await ctx.db.announcement.findFirst({
        where: {
          id: input.announcementId,
          active: true,
          ...announcementVisibility(ctx.session.tutorId),
        },
        select: { id: true },
      });
      if (!visible)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Announcement not found.",
        });
      await ctx.db.announcementAck.upsert({
        where: {
          announcementId_userId: {
            announcementId: input.announcementId,
            userId: ctx.session.user.id,
          },
        },
        update: {},
        create: {
          announcementId: input.announcementId,
          userId: ctx.session.user.id,
        },
      });
      return { ok: true };
    }),

  /**
   * Set (or clear) the default reference time slot for one of the caller's pairings.
   * Row-scoped: the pairing MUST belong to this tutor. Choosing a slot copies its
   * day/start/end onto the pairing so attendance defaults follow the slot.
   */
  setPairingSlot: activeTutorProcedure
    .input(
      z.object({
        pairingId: z.string().min(1),
        slotId: z.string().min(1).nullable(),
        expectedRoomVersion: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return inTransaction(ctx.db, async (tx) => {
        // A refresh or membership change must not turn this write into an edit of history.
        await lockEntity(tx, "program:period");
        await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id = ${ctx.session.tutorId} FOR UPDATE`;
        const tutor = await tx.tutor.findUniqueOrThrow({
          where: { id: ctx.session.tutorId },
        });
        if (tutor.status !== "ACTIVE")
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This action requires an active tutor account.",
          });
        // Lock before reading the room so a concurrent management room change
        // cannot combine with this slot change into an unvalidated final tuple.
        await lockPlannedRoomSchedule(tx);
        const pairing = await tx.pairing.findFirst({
          where: { id: input.pairingId, tutorId: ctx.session.tutorId, term: { active: true } },
          include: roomUnitInclude,
        });
        if (!pairing) throw new TRPCError({ code: "NOT_FOUND", message: "Current pairing not found for this tutor." });
        assertRoomVersion(pairing, input.expectedRoomVersion);
        if (input.slotId === null) {
          const members = await roomUnitMembers(tx, pairing);
          // Detaching only the catalog link retains the confirmed shared reservation.
          await tx.pairing.updateMany({ where: { id: { in: members.map(member => member.id) } },
            data: { timeSlotId: null, roomVersion: { increment: 1 } } });
          const saved = await tx.pairing.findUniqueOrThrow({ where: { id: pairing.id } });
          const roomOutcome = saved.roomId ? "RETAINED" as const : saved.roomNeedsAssignment ? "UNAVAILABLE" as const : saved.roomMode === "NONE" ? "NONE" as const : "UNASSIGNED" as const;
          return { ...saved, roomOutcome };
        }
        const slot = await tx.timeSlot.findFirst({ where: { id: input.slotId, active: true },
          select: { dayOfWeek: true, startMin: true, endMin: true } });
        if (!slot) throw new TRPCError({ code: "BAD_REQUEST", message: "Time slot not found." });
        return allocateAndPersistRoomUnit(tx, pairing, { expectedRoomVersion: input.expectedRoomVersion },
          { ...slot, timeSlotId: input.slotId, scheduleConfirmed: true });
      });
    }),

  /**
   * Read-only schedule for the room grid on the tutor page: rooms, the active slot catalog,
   * every scheduled pairing (room + slot occupancy), and room blackout periods. This is
   * non-sensitive scheduling data (no tutee PII), shown so tutors can see room assignments.
   */
  schedule: tutorProcedure.query(async ({ ctx }) => {
    const [rooms, slots, pairings, blocks] = await Promise.all([
      ctx.db.room.findMany({
        orderBy: [...programRoomOrder],
        select: { id: true, name: true },
      }),
      ctx.db.timeSlot.findMany({
        where: { active: true },
        orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
        select: {
          id: true,
          label: true,
          dayOfWeek: true,
          startMin: true,
          endMin: true,
        },
      }),
      ctx.db.pairing.findMany({
        where: { term: { active: true }, scheduleConfirmed: true },
        select: {
          id: true,
          groupId: true,
          termId: true,
          subject: true,
          scheduleConfirmed: true,
          dayOfWeek: true,
          startMin: true,
          endMin: true,
          tutorId: true,
          roomId: true,
          timeSlotId: true,
          tutor: {
            select: {
              englishName: true,
              username: true,
              user: { select: { username: true } },
            },
          },
        },
      }),
      ctx.db.roomUnavailability.findMany({
        select: {
          id: true,
          roomId: true,
          dayOfWeek: true,
          startMin: true,
          endMin: true,
          reason: true,
        },
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
            type: true,
            qualificationReason: true,
            invalidatedAt: true,
            email: true,
            status: true,
            updatedAt: true,
            interviewAt: true,
            interviewCompletedAt: true,
            interviewDurationMin: true,
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
              select: {
                tutorId: true,
                attended: true,
                isHead: true,
                tutor: { select: { englishName: true } },
              },
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
    const credits = await ctx.db.serviceHourAdjustment.findMany({
      where: {
        tutorId: myTutorId,
        id: {
          in: assignments.map((a) =>
            interviewHoursId(a.application.id, myTutorId),
          ),
        },
        type: "EXTRA",
        reason: INTERVIEW_HOURS_REASON,
      },
      select: { id: true, amount: true },
    });
    const pendingDecisions = await ctx.db.approvalRequest.findMany({
      where: {
        state: "PENDING",
        operation: "tutor.decideInterview",
        OR: assignments.map((a) => ({
          payload: {
            path: ["json", "applicationId"],
            equals: a.application.id,
          },
        })),
      },
      select: { payload: true },
    });
    return assignments.map((a) => {
      const { invalidatedAt, ...application } = a.application;
      const myVote =
        a.application.votes.find((v) => v.tutorId === myTutorId) ?? null;
      const accepts = a.application.votes.filter((v) => v.accept).length;
      const rejects = a.application.votes.length - accepts;
      return {
        isHead: a.isHead,
        // Keep historical chair assignment distinct from current authority after
        // a role change or when reading a panel created under the former policy.
        canChair: a.isHead && isInterviewChairRole(ctx.session.role),
        ...application,
        panel: application.interviewers.map((person) => ({
          tutorId: person.tutorId, name: person.tutor.englishName,
          isHead: person.isHead, attended: person.attended,
        })),
        isInvalid: !!invalidatedAt,
        myAwardedHours:
          credits.find(
            (row) => row.id === interviewHoursId(application.id, myTutorId),
          )?.amount ?? 0,
        pendingDecision: ["PENDING", "INTERVIEW"].includes(application.status) && pendingDecisions.some(
          ({ payload }) =>
            payload &&
            typeof payload === "object" &&
            !Array.isArray(payload) &&
            payload.json &&
            typeof payload.json === "object" &&
            !Array.isArray(payload.json) &&
            payload.json.applicationId === application.id,
        ),
        myVote: myVote
          ? { accept: myVote.accept, comment: myVote.comment }
          : null,
        tally: { accepts, rejects },
      };
    });
  }),

  /**
   * Set the interview time for an application. Only its assigned Admin/Head chair
   * may do this; other panelists' current eligibility does not block scheduling.
   */
  setInterviewTime: activeTutorProcedure
    .input(
      z.object({
        applicationId: z.string().min(1),
        interviewAt: z.coerce.date().nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        // Panel replacement uses this same lock: check current chair authority only
        // after acquiring it, and retain it through the schedule and notification writes.
        await lockApplicationReview(tx, input.applicationId);
        await assertFeatureEnabled(tx, "INTERVIEWS");
        const assignment = await tx.interviewAssignment.findUnique({
          where: {
            applicationId_tutorId: {
              applicationId: input.applicationId,
              tutorId: ctx.session.tutorId,
            },
          },
          select: { isHead: true },
        });
        const currentChair = await tx.user.findUnique({
          where: { id: ctx.session.user.id },
          select: { role: true, tutorId: true },
        });
        if (
          !assignment?.isHead ||
          currentChair?.tutorId !== ctx.session.tutorId ||
          !isInterviewChairRole(currentChair?.role)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Only the assigned Admin or Head chair can set the interview time.",
          });
        }
        const application = await tx.tutorApplication.findUniqueOrThrow({
          where: { id: input.applicationId },
          select: { status: true, invalidatedAt: true },
        });
        assertRequestProcessable(application);
        if (application.status === "RECALLED")
          throw new TRPCError({
            code: "CONFLICT",
            message: "This qualification request was recalled.",
          });
        const updated = await tx.tutorApplication.update({
          where: { id: input.applicationId },
          data: { interviewAt: input.interviewAt },
        });
        // Tell the rest of the panel when a time is set (it shows on their dashboard).
        if (input.interviewAt) {
          const panel = await tx.interviewAssignment.findMany({
            where: {
              applicationId: input.applicationId,
              tutorId: { not: ctx.session.tutorId },
            },
            select: { tutorId: true },
          });
          await notifyTutors(
            panel.map((p) => p.tutorId),
            {
              ...notificationEvent("interview_scheduled", {
                startsAt: input.interviewAt.toISOString(),
                timeZone: await getProgramTimeZone(tx),
              }),
              title: "Interview scheduled",
              body: `An interview was scheduled for ${new Intl.DateTimeFormat("en", { timeZone: await getProgramTimeZone(tx), dateStyle: "medium", timeStyle: "short" }).format(input.interviewAt)}.`,
              link: "/dashboard",
            },
            tx,
          );
        }
        return updated;
      }),
    ),

  /**
   * Cast (or update) the caller's interview vote for an application. Any assigned panelist
   * may vote; row-scoped to applications the caller is actually on the panel for.
   */
  castInterviewVote: activeTutorProcedure
    .input(
      z.object({
        applicationId: z.string().min(1),
        accept: z.boolean(),
        comment: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockApplicationReview(tx, input.applicationId);
        const app = await tx.tutorApplication.findUniqueOrThrow({
          where: { id: input.applicationId },
        });
        assertRequestProcessable(app);
        if (app.status !== "INTERVIEW")
          throw new TRPCError({
            code: "CONFLICT",
            message: "This interview is closed.",
          });
        await assertFeatureEnabled(ctx.db, "INTERVIEWS");
        const assignment = await tx.interviewAssignment.findUnique({
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
        return tx.interviewVote.upsert({
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
    ),

  /**
   * The assigned Admin/Head chair approves admission and service atomically.
   * Rejections and previously queued decisions retain their reviewed workflow.
   */
  decideInterview: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().min(1),
        accept: z.boolean(),
        comment: z.string().trim().min(1, "Add a brief comment").max(500),
        expectedUpdatedAt,
        completion: interviewServiceInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await assertFeatureEnabled(tx, "INTERVIEWS");
        await lockUsernameNamespace(tx);
        await lockApplicationReview(tx, input.applicationId);
        // The reviewer authorizes the change; the assigned chair remains the decision's author.
        const reviewId = approvalScope.getStore();
        let chairTutorId = ctx.session.tutorId;
        let chairUserId = ctx.session.user.id;
        if (reviewId) {
          const proposal = await tx.approvalRequest.findUniqueOrThrow({
            where: { id: reviewId },
          });
          if (
            proposal.operation !== "tutor.decideInterview" ||
            ctx.session.role !== "HEAD"
          )
            throw new TRPCError({ code: "FORBIDDEN" });
          const requester = await tx.user.findUnique({
            where: { id: proposal.requesterId },
            select: { tutorId: true },
          });
          chairTutorId = requester?.tutorId ?? null;
          chairUserId = proposal.requesterId;
        }
        const currentChair = await tx.user.findUnique({
          where: { id: chairUserId },
          select: { role: true, tutorId: true, suspendedAt: true, mergedIntoId: true, tutorAccessRevoked: true },
        });
        if (
          !chairTutorId ||
          currentChair?.tutorId !== chairTutorId ||
          !isInterviewChairRole(currentChair?.role) ||
          currentChair.suspendedAt || currentChair.mergedIntoId || currentChair.tutorAccessRevoked ||
          !(await tx.tutor.count({
            where: { id: chairTutorId, status: "ACTIVE" },
          }))
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "An active assigned interview chair is required.",
          });
        await validateInterviewDecision(
          tx,
          input.applicationId,
          input.accept,
          chairTutorId,
        );
        const assignment = await tx.interviewAssignment.findUnique({
          where: {
            applicationId_tutorId: {
              applicationId: input.applicationId,
              tutorId: chairTutorId,
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

        const before = await tx.tutorApplication.findUniqueOrThrow({
          where: { id: input.applicationId }, include: { interviewers: true },
        });
        if (before.type !== "INITIAL" || before.status === "RECALLED")
          throw new TRPCError({ code: "CONFLICT", message: "This application cannot receive this interview decision." });
        if (input.accept) {
          // Only a previously queued, Head-reviewed payload may omit completion.
          // A new direct approval can never recreate the former decision-only path.
          if (!input.completion && !reviewId)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Report interview duration, completion time and attendance before approving." });
          if (before.status === "ACCEPTED" && input.completion &&
            before.decidedByTutorId === chairTutorId && before.decisionComment === input.comment) {
            const credits = await interviewHourRows(tx, before.id, before.interviewers.map((p) => p.tutorId));
            if (sameInterviewCompletionEvidence(before, credits, input.completion)) return { ok: true };
          }
          if (before.status !== "INTERVIEW")
            throw new TRPCError({ code: "CONFLICT", message: "This interview has already been decided. Reload its current outcome." });
        }
        if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) staleConflict();
        if (input.accept && input.completion) {
          if (!z.string().email().safeParse(before.email.trim()).success)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Add a valid applicant email before approving so tutor registration can be prepared." });
          await recordInterviewApprovalService(tx, before.id, before, input.completion);
        }

        const recoveryActionId = input.accept
          ? await beginAdmissionRecoveryCapture(tx, input.applicationId) : null;
        // The source lock and pre-write version check cover both completion and decision.
        await tx.tutorApplication.update({
          where: { id: input.applicationId },
          data: {
            status: input.accept ? "ACCEPTED" : "REJECTED",
            decisionComment: input.comment,
            decidedAt: new Date(),
            decidedByTutorId: chairTutorId,
          },
        });

        // On the transition to ACCEPTED, issue a registration code so the applicant can
        // self-register a verified account (see promoteApplicantToTutor).
        await reconcileApplication(tx, input.applicationId);
        await finishAdmissionRecoveryCapture(tx, recoveryActionId);
        if (input.accept && input.completion) {
          // Reconciliation owns provisioning. Verify its exact outcome rather than
          // claiming success if a malformed legacy code prevented valid issuance.
          const promoted = await tx.tutorApplication.findUniqueOrThrow({
            where: { id: before.id }, select: { promotedTutorId: true },
          });
          const email = before.email.trim().toLowerCase();
          const tutorId = promoted.promotedTutorId;
          const linked = tutorId && await tx.user.count({ where: {
            tutorId, email, emailVerifiedAt: { not: null }, tutorAccessRevoked: false,
            suspendedAt: null, mergedIntoId: null,
          } });
          const codes = tutorId ? await tx.registrationCode.findMany({ where: {
            applicationId: before.id, tutorId, email, kind: "TUTOR",
            code: { not: null }, attempts: { lt: MAX_CODE_ATTEMPTS },
            usedAt: null, expiresAt: { gt: new Date() },
          }, select: { code: true } }) : [];
          // Legacy rows may contain blank plaintext, which cannot be shared for setup.
          const usableCode = codes.some(({ code }) => !!code?.trim());
          if (!linked && !usableCode)
            throw new TRPCError({ code: "CONFLICT", message: "Tutor registration could not be prepared. Review the application's existing account or invitation before approving." });
          await notifyAdmins({
            title: "Interview approved",
            ...notificationEvent("interview_approved"),
            link: `/admin/applications#application-${input.applicationId}`,
            inAppOnly: true,
          }, undefined, tx);
        }
        return { ok: true };
      }),
    ),

  // --------------------------------------------------------------------------
  // Lifecycle requests (opt-out / reentry) — a tutor manages their own membership.
  // --------------------------------------------------------------------------
  /** The signed-in tutor's open (PENDING) lifecycle request, if any, plus eligibility timing. */
  myStatusRequest: tutorProcedure.query(async ({ ctx }) => {
    const req = await ctx.db.tutorStatusRequest.findFirst({
      where: { tutorId: ctx.session.tutorId, state: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        eligibleAt: true,
        reason: true,
        createdAt: true,
      },
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
    .mutation(({ ctx, input }) =>
      requestMembership(
        ctx.db,
        { kind: "tutor", id: ctx.session.tutorId },
        "OPT_OUT",
        input.reason,
      ),
    ),

  /**
   * Request reentry to the program. Requires an OPTED_OUT tutor with no other open request.
   * No cooldown — an admin can approve immediately, flipping the tutor back to ACTIVE.
   */
  requestReentry: tutorProcedure
    .input(z.object({ reason: z.string().trim().max(1000).optional() }))
    .mutation(({ ctx, input }) =>
      requestMembership(
        ctx.db,
        { kind: "tutor", id: ctx.session.tutorId },
        "REENTRY",
        input.reason,
      ),
    ),

  /** Recall (cancel) the tutor's own open request while it is still PENDING. */
  recallStatusRequest: tutorProcedure
    .input(z.object({ requestId: z.string().cuid() }))
    .mutation(({ ctx, input }) =>
      recallMembership(
        ctx.db,
        { kind: "tutor", id: ctx.session.tutorId },
        input.requestId,
      ),
    ),

  // --------------------------------------------------------------------------
  // Tutee opt-out — the tutee asks to leave; their tutor relays it. A 7-day recall window then
  // auto-approves (removed). The tutor can recall meanwhile. (Punishment removals are automatic
  // and need no tutor action — see src/server/discipline/removal.ts.)
  // --------------------------------------------------------------------------
  /** The caller's open (PENDING) opt-out requests, keyed for the pairings UI. */
  myTuteeRemovalRequests: tutorProcedure.query(async ({ ctx }) => {
    // Lazily finalize any opt-out whose recall window elapsed (no scheduler).
    await finalizeDueOptOuts(ctx.db);
    return ctx.db.tuteeRemovalRequest.findMany({
      where: {
        requestedByTutorId: ctx.session.tutorId,
        kind: "VOLUNTARY",
        state: "PENDING",
      },
      select: {
        id: true,
        tuteeId: true,
        pairingId: true,
        reason: true,
        createdAt: true,
        eligibleAt: true,
      },
    });
  }),

  /**
   * Relay a tutee's opt-out (they asked to leave). Scoped: the pairing must belong to the caller
   * and the tutee must be on it. Opens a PENDING request with a 7-day recall window (`eligibleAt`);
   * the tutee stays active until then. If not recalled (tutor) or cancelled (admin), it
   * auto-approves and the tutee is removed. Notifies admins. Idempotent per tutee+pairing.
   */
  requestTuteeRemoval: activeTutorProcedure
    .input(
      z.object({
        pairingId: z.string().cuid(),
        tuteeId: z.string().cuid(),
        reason: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        // Bind the relay to live participation, and serialize duplicate requests and refresh.
        await lockEntity(tx, "program:period");
        await lockEntity(tx, `tutee:${input.tuteeId}`);
        const link = await tx.pairingTutee.findFirst({
          where: {
            tuteeId: input.tuteeId,
            pairingId: input.pairingId,
            pairing: { tutorId: ctx.session.tutorId, term: { active: true } },
            tutee: { status: "ACTIVE" },
          },
          select: { tuteeId: true },
        });
        if (!link) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "That tutee isn't on one of your pairings.",
          });
        }
        if (
          await tx.studentSurvey.findUnique({
            where: { tuteeId: input.tuteeId },
          })
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Tutees apply to leave the quarter from their own account. Use schedule rejection for scheduling problems.",
          });
        const open = await tx.tuteeRemovalRequest.findFirst({
          where: { tuteeId: input.tuteeId, state: "PENDING" },
          select: { id: true },
        });
        if (open) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "An opt-out for this tutee is already pending.",
          });
        }
        const [tutee, tutor] = await Promise.all([
          tx.tutee.findUnique({
            where: { id: input.tuteeId },
            select: { englishName: true },
          }),
          tx.tutor.findUnique({
            where: { id: ctx.session.tutorId },
            select: { englishName: true },
          }),
        ]);
        const eligibleAt = new Date(
          Date.now() + TUTEE_OPT_OUT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
        );
        const req = await tx.tuteeRemovalRequest.create({
          data: {
            tuteeId: input.tuteeId,
            kind: "VOLUNTARY",
            pairingId: input.pairingId,
            requestedByTutorId: ctx.session.tutorId,
            reason: input.reason?.trim() ? input.reason.trim() : null,
            eligibleAt,
          },
          select: { id: true },
        });
        await notifyAdmins(
          {
            ...notificationEvent("tutee_optout_requested"),
            title: "Tutee opt-out",
            body: `${tutor?.englishName ?? "A tutor"} relayed an opt-out for ${tutee?.englishName ?? "a tutee"} (auto-approves in ${TUTEE_OPT_OUT_COOLDOWN_DAYS} days).`,
            link: "/admin/tutee-requests",
          },
          undefined,
          tx,
        );
        return { ok: true, id: req.id, eligibleAt };
      }),
    ),

  /** Recall (cancel) the caller's own pending opt-out while it's still in the recall window. */
  recallTuteeRemoval: tutorProcedure
    .input(z.object({ requestId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.tuteeRemovalRequest.updateMany({
        where: {
          id: input.requestId,
          requestedByTutorId: ctx.session.tutorId,
          state: "PENDING",
        },
        data: {
          state: "RECALLED",
          resolvedAt: new Date(),
          resolvedByName: "self",
        },
      });
      if (res.count === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No open request to recall.",
        });
      }
      return { ok: true };
    }),

  /**
   * Start-of-term activation. After a semester refresh a continuing tutor is PENDING and must
   * choose: available (-> ACTIVE) or opt out (-> OPTED_OUT). Their choice syncs straight to the
   * admin views. Only valid while PENDING.
   */
  activateAccount: tutorProcedure
    .input(z.object({ available: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // Match rollover's period lock, then take the account lock before its tutor mirror.
      // Validation and transition see one academic report and one active school year.
      const { tutor, status } = await inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "program:period");
        await lockAccountProfile(tx, ctx.session.user.id);
        const tutor = await tx.tutor.findUniqueOrThrow({
          where: { id: ctx.session.tutorId },
          select: { status: true, englishName: true },
        });
        if (tutor.status !== "PENDING") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Your account isn't awaiting activation.",
          });
        }
        await requireSchoolParticipation(tx, ctx.session.user.id);
        if (input.available)
          await requireAcademicConfirmation(tx, ctx.session.user.id);
        const status = input.available
          ? ("ACTIVE" as const)
          : ("OPTED_OUT" as const);
        await tx.tutor.update({
          where: { id: ctx.session.tutorId },
          data: { status },
        });
        return { tutor, status };
      });
      await notifyAdmins({
        title: input.available ? "Tutor reactivated" : "Tutor opted out",
        ...notificationEvent(
          input.available ? "tutor_reactivated" : "tutor_opted_out",
        ),
        body: `${tutor.englishName} ${input.available ? "is available" : "opted out"} this term.`,
        link: "/admin/tutors",
      });
      return { ok: true, status };
    }),

  // --------------------------------------------------------------------------
  // Tutor meetings — self-excuse an upcoming absence (up to 60 min before the meeting).
  // --------------------------------------------------------------------------
  meetingPeriods: tutorProcedure.query(({ ctx }) => meetingPeriods(ctx.db, ctx.session.tutorId)),

  /** The current linked tutor's evidence only. Retained historical identities keep
   * their existing owned personal-history route; this read accepts no tutor ID. */
  meetingRecords: tutorProcedure.input(meetingPeriodInput).query(async ({ ctx, input }) => {
    const now = new Date();
    const { current } = await meetingPeriodContext(ctx.db);
    const historical = !["current", "upcomingOutside"].includes(input.period) &&
      !meetingPeriodsOverlap(input.period, current?.key);
    const meetings = await ctx.db.tutorMeeting.findMany({
      where: {
        AND: [
          await meetingScope(ctx.db, input.period, now, input.outsideCurrent),
          // A retained semester key can overlap today's quarter without granting
          // access to other tutors' past evidence in its other quarter.
          { OR: [
            { attendances: { some: { tutorId: ctx.session.tutorId } } },
            { date: { gte: now } },
            ...(current ? [recordedMeetingPeriod(current.key)] : []),
          ] },
        ],
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        id: true, title: true, date: true,
        attendances: {
          where: { tutorId: ctx.session.tutorId },
          select: { status: true, reason: true, excusedAt: true },
        },
      },
    });
    return meetings.map(meeting => {
      const own = meeting.attendances[0];
      return {
        id: meeting.id, title: meeting.title, date: meeting.date,
        status: own?.status ?? null, reason: own?.reason ?? null,
        upcoming: meeting.date >= now,
        excused: own?.status === "EXCUSED_ABSENT" && own.excusedAt != null,
        canExcuse: !historical && now.getTime() <= meeting.date.getTime() - MEETING_EXCUSE_CUTOFF_MIN * 60_000,
      };
    });
  }),

  /** Upcoming task count deliberately stays independent of period/history browsing. */
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
        // True until the cutoff (60 min before the meeting) passes.
        canExcuse:
          now.getTime() <=
          m.date.getTime() - MEETING_EXCUSE_CUTOFF_MIN * 60_000,
      };
    });
  }),

  /**
   * Self-excuse an absence from an upcoming meeting (sets the tutor's attendance to EXCUSED_ABSENT
   * with a reason + timestamp). Allowed only until 60 min before the meeting; an active tutor only.
   * Surfaces to coordinators on /admin/meetings (panel + notification). Clears any stray
   * unexcused-absence deduction for this meeting.
   */
  excuseMeeting: activeTutorProcedure
    .input(
      z.object({
        meetingId: z.string().cuid(),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "MEETINGS");
      const meeting = await ctx.db.tutorMeeting.findUnique({
        where: { id: input.meetingId },
        select: { id: true, title: true, date: true },
      });
      if (!meeting)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Meeting not found.",
        });
      if (
        Date.now() >
        meeting.date.getTime() - MEETING_EXCUSE_CUTOFF_MIN * 60_000
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Too late to excuse — this meeting is within 60 minutes.",
        });
      }
      const reason = input.reason?.trim() ? input.reason.trim() : null;
      await ctx.db.$transaction(async (tx) => {
        await lockEntity(tx, `meeting-hours:${ctx.session.tutorId}`);
        await tx.meetingAttendance.upsert({
          where: {
            meetingId_tutorId: {
              meetingId: input.meetingId,
              tutorId: ctx.session.tutorId,
            },
          },
          update: { status: "EXCUSED_ABSENT", reason, excusedAt: new Date() },
          create: {
            meetingId: input.meetingId,
            tutorId: ctx.session.tutorId,
            status: "EXCUSED_ABSENT",
            reason,
            excusedAt: new Date(),
          },
        });
        await reconcileMeetingHours(tx, ctx.session.tutorId);
      });
      const tutor = await ctx.db.tutor.findUnique({
        where: { id: ctx.session.tutorId },
        select: { englishName: true },
      });
      await notifyAdmins({
        ...notificationEvent("meeting_absence_excused"),
        title: "Meeting absence excused",
        body: `${tutor?.englishName ?? "A tutor"} will miss "${meeting.title}".`,
        link: "/admin/meetings",
      });
      return { ok: true };
    }),

  /** Cancel a self-excuse (only one the tutor submitted, and only while still >60 min out). */
  cancelMeetingExcuse: activeTutorProcedure
    .input(z.object({ meetingId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "MEETINGS");
      const meeting = await ctx.db.tutorMeeting.findUnique({
        where: { id: input.meetingId },
        select: { date: true },
      });
      if (!meeting)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Meeting not found.",
        });
      if (
        Date.now() >
        meeting.date.getTime() - MEETING_EXCUSE_CUTOFF_MIN * 60_000
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Too late to change — this meeting is within 60 minutes.",
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
