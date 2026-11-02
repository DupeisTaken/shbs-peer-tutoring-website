import { applyProgramRefresh, refreshProgramInput } from "~/server/program/refresh";
import {
  scheduleRefreshInput, cancelRefreshInput, scheduleProgramRefresh,
  cancelProgramRefresh, readRefreshSchedule,
} from "~/server/program/scheduled-refresh";
import {
  allocateAndPersistRoomUnit,
  roomUnitInclude,
} from "~/server/room-allocation";
import { reconcileTutorContinuations } from "~/server/student-continuation-assignment";
import { lockSessionPlanning } from "~/server/session-planning";
import {
  autoAssignUnassignedRooms,
  bulkRoomAllocationInput,
} from "~/server/bulk-room-allocation";
import {
  meetingPeriodInput,
  meetingPeriods,
  meetingScope,
} from "~/server/meeting-periods";
import { roomReference } from "~/lib/room-reference";
import {
  deleteAccount,
  deleteAccountInput,
  previewDeleteAccount,
} from "~/server/delete-account";
import {
  assertNoPublishedTuteeDeletion,
  assertNoSchedulingNoticeDeletion,
} from "~/server/session-planning/deletion-guards";
import { notificationInAppEvent } from "~/lib/notification-details";
import { programDateKey } from "~/lib/program-time";
import { getProgramTimeZone } from "~/server/program/time-zone";
import { clearInterviewHours } from "~/server/interview-hours";
import { SESSION_FLAG_FILTERS } from "~/lib/session-flag-state";
import { tutorWorkloads } from "~/server/tutor-workload";
import { optionalPersonNameFields, fullPersonName } from "~/lib/person-name";
import {
  lockProgramRooms,
  programRoomOrder,
  reorderProgramRooms,
  roomOrderInput,
} from "~/server/room-order";
import {
  configuredNewNames,
  configuredProfileNames,
  configuredLegacyIntakeName,
  ensureNameFallbackForRole,
} from "~/server/program/name-fields";
import {
  assertRequestProcessable,
  assertTuteeInvalidityCleared,
  emptyRequestInvalidity,
  requestInvalidity,
  requestInvalidityInput,
  setApplicationInvalidity,
  setSignupInvalidity,
  lockApplicationReview,
  lockStudentRequestReview,
} from "~/server/request-invalidity";
import { synchronizeStudentSignupAnswers } from "~/server/student-signup-revisions";
import { assertHeadDiscretionarySignupChange } from "~/server/student-signup-management";
import { hasReadyCredentials } from "~/lib/account-readiness";
import {
  accountDirectoryDetails,
  groupDirectoryRows,
  type TutorDirectorySource,
} from "~/server/account-directory";
import {
  changeSchoolDeparture,
  requireSchoolParticipation,
  requireStudentSchoolParticipation,
} from "~/server/school-departure";
import {
  currentAcademicInput,
  academicSummary,
  normalizeGrade,
} from "~/lib/academics";
import {
  accountAcademics,
  confirmCurrentAccountAcademics,
  initializeAccountAcademics,
  legacyAcademic,
} from "~/server/academics";
import {
  assertPrimaryName,
  assertOfferedGrade,
} from "~/server/program/profile-policy";
import { historicalOwners } from "~/server/tutee-history";
import { isHistoricalTutee } from "~/lib/tutee-history";
import {
  isHistoricalTutor,
  legacyAcademicRecordId,
} from "~/lib/historical-academics";
import { preserveHistoricalAcademics } from "~/server/historical-academics";
import { REGISTRATION_KINDS, isManagementCode } from "~/lib/registration-kind";
import { enforceAssignmentQualification } from "~/server/assignment-qualification";
import {
  accountUsernameSchema,
  updateAccountUsername,
} from "~/server/account-username";
import { accountMembership, membershipSchema } from "~/lib/account-membership";
import { databaseScope, approvalScope } from "~/server/db-scope";
import { courseChoices } from "~/server/course-choices";
import { courseImportInput } from "~/lib/course-import";
import { importCourseGroups } from "~/server/course-import";
import {
  courseGroupInput,
  saveCourseGroup,
  writeVariant,
  reorderCatalogue,
} from "~/server/course-catalogue";
import { lockCatalogue } from "~/server/qualifications";
import {
  lockAccountProfile,
  updateAccountProfile,
} from "~/server/account-profile";
import { decideMembership } from "~/server/membership";
import { auditActors } from "~/lib/audit-actors";
import {
  announcementAudienceSchema,
  selectAnnouncementRecipients,
} from "~/lib/announcement-recipients";
import { announcementCandidates } from "~/server/announcement-recipients";
import { auditFilters, auditWhere } from "~/server/audit/filters";
import {
  assertStudentRequestAssignable,
  stampStudentAssignment,
} from "~/server/student-request-state";
import { validatePanel } from "~/server/interviews";
import { reconcileMeetingHours } from "~/server/meeting-hours";
import {
  createRoomBlockSchema,
  updateRoomBlockSchema,
  removeRoomBlockSchema,
} from "~/lib/room-blocks";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "../../../../generated/prisma";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

import {
  adminOnlyProcedure,
  adminProcedure,
  createTRPCRouter,
  headProcedure,
  viewerProcedure,
} from "~/server/api/trpc";
import { monthKey } from "~/lib/service-hours";
import {
  lockAttendanceSchedule,
  propagateSlotAttendance,
} from "~/server/attendance-schedule";
import { recruitmentStatus, recruitmentWindow } from "~/lib/recruitment";
import {
  defaultUsername,
  ensureUniqueUsername,
  canonicalUsername,
  backfillStudentUsernames,
  ensureUserUsername,
  splitDisplayName,
} from "~/server/auth/username";
import { verifyPasswordConfirmation } from "~/server/auth/password-confirmation";
import {
  issueAccountVerification,
  issueTutorSetupLink,
} from "~/server/auth/password-reset";
import { issueRegistrationCode } from "~/server/auth/registration";
import { applicationAccountSetup } from "~/server/application-account-setup";
import {
  applicationIdentityCorrectionInput,
  applicationIdentitySnapshot,
  applicationIdentitySummaries,
  correctApplicationIdentity,
} from "~/server/tutors/application-identity";
import { decideCrewApplication } from "~/server/crew/signup";
import { reconcileApplication } from "~/server/tutors/application-status";
import {
  beginAdmissionRecoveryCapture,
  finishAdmissionRecoveryCapture,
} from "~/server/recovery/capture";
import {
  notifyAdmins,
  notifyTutors,
  notifyUsers,
  reconcileManagementReviewNotifications,
} from "~/server/notifications/create";
import { standingFromCounts } from "~/lib/discipline";
import {
  finalizeDueOptOuts,
  syncPunishmentRemoval,
} from "~/server/discipline/removal";
import {
  QUARTERS,
  type Quarter,
  crossesSemester,
  crossesYear,
  nextPeriod,
  periodLabel,
  quarterSemester,
  semesterQuarters,
} from "~/lib/period";
import { getActivePeriod, getActivePeriodOrNull } from "~/server/period";
import {
  assertFeatureEnabled,
  getFeatures,
} from "~/server/program/features";
import { applyUndo, recordAudit } from "~/server/audit/log";
import { expectedUpdatedAt, staleConflict } from "~/server/concurrency";
import {
  allocateRoom,
  allocationData,
  allocateSlotCohort,
  assertRoomVersion,
  notifyRoomShortage,
} from "~/server/room-allocation";
import { assertPairingGroupsRemainEligible } from "~/server/tutor-scheduling";
import { pairingCreationReceipt } from "~/server/pairing-creation";
import {
  assertRoomBlackoutAvailable,
  lockPlannedRoomSchedule,
  roomBlockForWrite,
} from "~/server/room-bookings";
import { studentRequestRows } from "~/server/student-workflow";

/** Role writers acquire the namespace/leadership barriers first. Freeze the actor
 * afterwards so suspension, retirement or demotion cannot pass a waiting write. */
async function activeManagementActor(
  tx: TransactionDb,
  userId: string,
  headOnly = false,
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: userId } });
  if (
    !actor ||
    actor.suspendedAt ||
    actor.mergedIntoId ||
    !(headOnly ? ["HEAD"] : ["ADMIN", "HEAD"]).includes(actor.role)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: headOnly
        ? "Head access required."
        : "Administrator access required.",
    });
  return actor;
}

/** Recheck the password against the locked current account, after any barrier wait. */
function requireManagementPassword(
  actor: { id: string; passwordHash: string | null },
  password: string,
) {
  if (!actor.passwordHash)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Set a password on your account before performing this action.",
    });
  if (!verifyPasswordConfirmation(actor.id, password, actor.passwordHash))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Password is incorrect.",
    });
}

/**
 * Detach an inactive tutor's active-term tutees from their pairings and re-queue them (set PENDING)
 * for reassignment on /admin/requests. This is the single inverse used whenever a tutor stops
 * serving — opt-out approval, can-tutor off, or a direct status change — so tutees are never
 * stranded on a tutor who can no longer act. Returns how many were re-queued. No-op without an
 * active term.
 */
async function requeueTutorActiveTermTutees(
  db: DomainDb,
  tutorId: string,
): Promise<number> {
  return inTransaction(db, async (tx) => {
    const term = await tx.term.findFirst({
      where: { active: true },
      select: { id: true },
    });
    if (!term) return 0;
    const pairings = await tx.pairing.findMany({
      where: { tutorId, termId: term.id },
      select: { id: true, tutees: { select: { tuteeId: true } } },
    });
    const tuteeIds = [
      ...new Set(pairings.flatMap((p) => p.tutees.map((t) => t.tuteeId))),
    ];
    if (tuteeIds.length === 0) return 0;
    await tx.pairingTutee.deleteMany({
      where: {
        pairingId: { in: pairings.map((p) => p.id) },
        tuteeId: { in: tuteeIds },
      },
    });
    await tx.tutee.updateMany({
      where: { id: { in: tuteeIds }, status: "ACTIVE" },
      data: { status: "PENDING" },
    });
    return tuteeIds.length;
  });
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
  db: {
    timeSlot: {
      findUnique: (args: { where: { id: string } }) => Promise<{
        dayOfWeek: number;
        startMin: number;
        endMin: number;
      } | null>;
    };
  },
  timeSlotId: string,
) {
  const slot = await db.timeSlot.findUnique({ where: { id: timeSlotId } });
  if (!slot) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Pick a valid time slot.",
    });
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

const TUTEE_STATUS = ["PENDING", "ACTIVE", "INACTIVE"] as const;
const TUTOR_STATUS = [
  "ACTIVE",
  "PENDING",
  "GRADUATED",
  "TRANSFERRED",
  "OPTED_OUT",
  "ARCHIVED",
] as const;
const TUTOR_APP_STATUS = [
  "PENDING",
  "INTERVIEW",
  "ACCEPTED",
  "REJECTED",
] as const;

export const adminRouter = createTRPCRouter({
  /**
   * Exact counts for the activity board's management-only queues. The summary is computed on the
   * server so paginated review screens cannot undercount their pending work. Modern survey-first
   * requests carry their linked tutee ids; the client excludes those ids from the legacy pending
   * roster and therefore never presents one student twice.
   */
  activitySummary: adminProcedure.query(async ({ ctx }) => {
    const activeTerm = await ctx.db.term.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const requests = await studentRequestRows(
      ctx.db,
      undefined,
      undefined,
      true,
    );
    const invalidLegacy = await ctx.db.tuteeRequestInvalidity.findMany({
      where: { invalidatedAt: { not: null } },
      select: { tuteeId: true },
    });
    const linkedTuteeIds = requests.flatMap((row) =>
      row.tuteeId ? [row.tuteeId] : [],
    );
    const unverified = requests.filter(
      (row) =>
        !row.isInvalid && row.state === "OPEN" && row.confirmedAt == null,
    );
    const matching = requests.filter(
      (row) =>
        !row.isInvalid &&
        row.state === "OPEN" &&
        row.confirmedAt != null &&
        row.subjects.some(
          (subject) =>
            !row.pairings.some((pairing) => pairing.subject === subject.name),
        ),
    );
    const [
      legacyPending,
      legacyReviews,
      studentAppeals,
      accountAppeals,
      translationDrafts,
      approvalRequests,
    ] = await Promise.all([
      ctx.db.tutee.count({
        where: {
          status: "PENDING",
          ...(linkedTuteeIds.length > 0 || invalidLegacy.length > 0
            ? {
                id: {
                  notIn: [
                    ...linkedTuteeIds,
                    ...invalidLegacy.map((row) => row.tuteeId),
                  ],
                },
              }
            : {}),
        },
      }),
      activeTerm
        ? ctx.db.studentRequestReview.count({
            where: {
              surveyId: null,
              legacyIntakeTermId: activeTerm.id,
              state: "PENDING",
            },
          })
        : Promise.resolve(0),
      ctx.db.studentAppeal.count({ where: { state: "PENDING" } }),
      ctx.db.accountAppeal.count({ where: { state: "PENDING" } }),
      ctx.db.translationDraft.count({ where: { state: "PENDING" } }),
      ["HEAD", "ADMIN"].includes(ctx.session.role)
        ? ctx.db.approvalRequest.count({ where: { state: "PENDING" } })
        : Promise.resolve(null),
    ]);

    return {
      linkedTuteeIds,
      unverified: unverified.length,
      matching: matching.length + legacyPending,
      studentReviews:
        legacyReviews +
        requests.reduce(
          (count, row) =>
            count +
            row.reviews.filter((review) => review.state === "PENDING").length,
          0,
        ),
      studentAppeals,
      accountAppeals,
      translationDrafts,
      // Coordinators can track their proposals on /admin/approvals but cannot review the
      // collective approval queue, so the board omits that management-only count for them.
      approvalRequests,
      intakeRows: [...unverified, ...matching]
        .sort((a, b) => +a.submittedAt - +b.submittedAt)
        .map((row) => ({
          id: row.id,
          name: row.name,
          username: row.username,
          submittedAt: row.submittedAt,
          stage:
            row.confirmedAt == null
              ? ("UNVERIFIED" as const)
              : ("MATCHING" as const),
          subjects: row.subjects.map((subject) => subject.name),
        })),
    };
  }),

  // --------------------------------------------------------------------------
  // Reference lists
  // --------------------------------------------------------------------------
  /** Workload preferences are assignment context for staff, not an observer data grant. */
  assignmentWorkloads: adminProcedure.query(({ ctx }) =>
    tutorWorkloads(ctx.db),
  ),
  tutors: viewerProcedure.query(async ({ ctx }) => {
    const [term, tutors] = await Promise.all([
      ctx.db.term.findFirst({
        where: { active: true },
        select: { schoolYear: true },
      }),
      ctx.db.tutor.findMany({
        orderBy: { englishName: "asc" },
        // Login/account status so the roster can show who still needs to set up their account.
        include: {
          user: {
            select: {
              id: true,
              role: true,
              tutorAccessRevoked: true,
              suspendedAt: true,
              name: true,
              alternativeNames: true,
              profileVersion: true,
              academicProfile: true,
              username: true,
              email: true,
              emailVerifiedAt: true,
              mustChangePassword: true,
            },
          },
        },
      }),
    ]);
    const preservedAcademics = await ctx.db.historicalAcademicRecord.findMany({
      where: {
        id: {
          in: tutors.map((tutor) => legacyAcademicRecordId("TUTOR", tutor.id)),
        },
      },
      select: { tutorId: true },
    });
    const preservedTutorIds = new Set(
      preservedAcademics.map((record) => record.tutorId),
    );
    return tutors.map((tutor) => ({
      ...tutor,
      historicalGrade:
        isHistoricalTutor(tutor) || preservedTutorIds.has(tutor.id),
      academic: academicSummary(
        tutor.user?.academicProfile ??
          (!tutor.academicallyGraduated &&
          tutor.gradeSchoolYear &&
          tutor.gradeConfirmedAt
            ? {
                status: "REPORTED",
                gradeLevel: tutor.gradeLevel,
                rawGrade: null,
                schoolYear: tutor.gradeSchoolYear,
                confirmedAt: tutor.gradeConfirmedAt,
                reconfirmRequired: false,
              }
            : legacyAcademic(tutor.gradeLevel, tutor.academicallyGraduated)),
        term?.schoolYear,
      ),
    }));
  }),
  /**
   * Per-tutee stats for the admin tutees view: session attendance + discipline standing.
   * Aggregated in Postgres (two `GROUP BY`s) so this returns ~one row per tutee instead of
   * pulling every session-tutee / card row into Node — keeps it cheap as history grows.
   */
  tuteeStats: viewerProcedure.query(async ({ ctx }) => {
    const [sessionGroups, cardGroups] = await Promise.all([
      ctx.db.sessionTutee.groupBy({
        by: ["tuteeId", "status"],
        _count: { _all: true },
      }),
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
        sessions: 0,
        present: 0,
        excused: 0,
        unexcused: 0,
        validYellow: 0,
        validRed: 0,
        pendingYellow: 0,
        pendingRed: 0,
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
    const isViewer = ctx.portalAccess.maskManagementData;
    const active = await getActivePeriodOrNull(ctx.db);
    const periodKey = active ? `${active.schoolYear} ${active.quarter}` : null;
    const [tutees, removed] = await Promise.all([
      ctx.db.tutee.findMany({
        orderBy: [{ status: "asc" }, { englishName: "asc" }],
        include: {
          user: {
            select: {
              id: true,
              name: true,
              alternativeNames: true,
              profileVersion: true,
              academicProfile: true,
              username: true,
              email: true,
              emailVerifiedAt: true,
            },
          },
          firstChoice: { select: { id: true, name: true } },
          secondChoice: { select: { id: true, name: true } },
          availabilities: {
            include: {
              slot: {
                select: {
                  id: true,
                  label: true,
                  dayOfWeek: true,
                  startMin: true,
                  endMin: true,
                },
              },
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
            select: {
              tutee: {
                select: {
                  id: true,
                  englishName: true,
                  email: true,
                  phone: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const norm = (s: string | null | undefined) => {
      const v = s?.trim().toLowerCase();
      if (!v) return null;
      return v;
    };
    const bannedNames = new Set(
      removed.map((r) => norm(r.tutee.englishName)).filter(Boolean),
    );
    const bannedEmails = new Set(
      removed.map((r) => norm(r.tutee.email)).filter(Boolean),
    );
    const bannedPhones = new Set(
      removed.map((r) => norm(r.tutee.phone)).filter(Boolean),
    );

    // Resolve enrollment periods in one query; historical grades must never borrow today's year.
    const [retainedOwners, enrollmentTerms, correctedAcademics] =
      await Promise.all([
        historicalOwners(
          ctx.db,
          tutees.map((row) => row.id),
        ),
        ctx.db.term.findMany({
          where: {
            id: {
              in: [
                ...new Set(
                  tutees.flatMap((row) =>
                    row.intakeTermId ? [row.intakeTermId] : [],
                  ),
                ),
              ],
            },
          },
          select: { id: true, schoolYear: true, quarter: true },
        }),
        ctx.db.historicalAcademicRecord.findMany({
          where: {
            id: {
              in: tutees.map((row) => legacyAcademicRecordId("TUTEE", row.id)),
            },
          },
          select: {
            tuteeId: true,
            rawGrade: true,
            schoolYear: true,
            academicallyGraduated: true,
            corrections: {
              orderBy: { revision: "desc" },
              take: 1,
              select: { rawGrade: true, schoolYear: true },
            },
          },
        }),
      ]);
    const correctionsByTutee = new Map(
      correctedAcademics.map((row) => [
        row.tuteeId,
        row.corrections[0] ?? null,
      ]),
    );
    // Current-account synchronization can change roster mirrors after preservation.
    // Summaries must prefer the saved original, including deliberately unknown values.
    const originalsByTutee = new Map(
      correctedAcademics.map(
        ({ tuteeId, rawGrade, schoolYear, academicallyGraduated }) => [
          tuteeId,
          { rawGrade, schoolYear, academicallyGraduated },
        ],
      ),
    );
    const periods = new Map(
      enrollmentTerms.map(({ id, ...period }) => [id, period]),
    );
    // Legacy public signup review is not part of participant-facing roster scalars.
    const invalidities = await ctx.db.tuteeRequestInvalidity.findMany({
      where: { tuteeId: { in: tutees.map((row) => row.id) } },
    });
    const invaliditiesByTutee = new Map(
      invalidities.map((row) => [row.tuteeId, row]),
    );
    return tutees.map((t) => {
      // Flag a (still-pending) re-signup that matches a banned identity this quarter — by exact
      // name / email / phone — so an admin can vet it. Never auto-blocks; it just labels.
      const match =
        t.status === "PENDING"
          ? {
              name:
                !!norm(t.englishName) && bannedNames.has(norm(t.englishName)),
              email: !!norm(t.email) && bannedEmails.has(norm(t.email)),
              phone: !!norm(t.phone) && bannedPhones.has(norm(t.phone)),
            }
          : null;
      const bannedMatch =
        match && (match.name || match.email || match.phone) ? match : null;
      // Withhold staff free-text (notes) and the tutee's typed legal-name signature from VIEWER.
      const owner = t.user ?? retainedOwners.get(t.id) ?? null;
      const historical = isHistoricalTutee(t, active?.termId ?? null);
      const historicalGrade = historical || correctionsByTutee.has(t.id);
      const enrollmentPeriod = t.intakeTermId
        ? (periods.get(t.intakeTermId) ?? null)
        : null;
      const academic = academicSummary(
        owner?.academicProfile ??
          legacyAcademic(t.gradeLevel, t.academicallyGraduated),
        active?.schoolYear,
      );
      const enrollmentCorrection = correctionsByTutee.get(t.id) ?? null;
      const enrollmentOriginal = originalsByTutee.get(t.id) ?? null;
      return isViewer
        ? {
            ...t,
            ...requestInvalidity(
              invaliditiesByTutee.get(t.id) ?? emptyRequestInvalidity,
              false,
            ),
            notes: null,
            signatureName: null,
            bannedMatch,
            academic,
            owner,
            historical,
            historicalGrade,
            enrollmentPeriod,
            enrollmentCorrection,
            enrollmentOriginal,
          }
        : {
            ...t,
            ...requestInvalidity(
              invaliditiesByTutee.get(t.id) ?? emptyRequestInvalidity,
            ),
            bannedMatch,
            academic,
            owner,
            historical,
            historicalGrade,
            enrollmentPeriod,
            enrollmentCorrection,
            enrollmentOriginal,
          };
    });
  }),
  rooms: viewerProcedure.query(({ ctx }) =>
    ctx.db.room.findMany({
      orderBy: [...programRoomOrder],
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
  subjects: viewerProcedure.query(({ ctx }) => courseChoices(ctx.db)),

  /** Concrete approved eligibility; consumers must not infer it from application intents. */
  subjectEligibility: viewerProcedure.query(({ ctx }) =>
    ctx.db.qualificationGrant.findMany({
      where: { qualification: { status: "APPROVED" } },
      distinct: ["tutorId", "subjectId"],
      select: { tutorId: true, subjectId: true },
    }),
  ),
  courseGroups: viewerProcedure.query(({ ctx }) =>
    ctx.db.courseGroup.findMany({
      orderBy: [{ rank: "asc" }, { id: "asc" }],
      include: {
        subjects: {
          include: { level: true },
          orderBy: [
            { level: { rank: "asc" } },
            { level: { id: "asc" } },
            { id: "asc" },
          ],
        },
      },
    }),
  ),
  saveCourseGroup: adminProcedure
    .input(courseGroupInput)
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, (tx) => saveCourseGroup(tx, input)),
    ),
  reorderCatalogue: adminProcedure
    .input(z.object({ kind: z.enum(["levels", "groups"]), ids: z.array(cuid) }))
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, (tx) =>
        reorderCatalogue(tx, input.kind, input.ids),
      ),
    ),
  subjectLevels: viewerProcedure.query(({ ctx }) =>
    ctx.db.subjectLevel.findMany({
      orderBy: [{ rank: "asc" }, { id: "asc" }],
    }),
  ),
  createSubjectLevel: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(60),
        prefix: z.string().trim().max(60).optional(),
        rank: z.number().int().default(0),
        apScored: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockCatalogue(tx);
        return tx.subjectLevel.create({
          data: {
            ...input,
            prefix:
              input.prefix ??
              (input.name.toLowerCase() === "standard" ? "" : input.name),
          },
        });
      }),
    ),
  updateSubjectLevel: adminProcedure
    .input(
      z.object({
        id: cuid,
        name: z.string().trim().min(1).max(60).optional(),
        prefix: z.string().trim().max(60).optional(),
        rank: z.number().int().optional(),
        apScored: z.boolean().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockCatalogue(tx);
        const { id, ...data } = input;
        const level = await tx.subjectLevel.update({ where: { id }, data });
        if (input.prefix !== undefined) {
          const variants = await tx.subject.findMany({
            where: { levelId: id },
          });
          for (const variant of variants)
            await writeVariant(tx, {
              id: variant.id,
              baseName: variant.baseName || variant.name,
              levelId: id,
              active: variant.active,
            });
        }
        return level;
      }),
    ),
  deleteSubjectLevel: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockCatalogue(tx);
        if (await tx.subject.count({ where: { levelId: input.id } }))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This level has subject variants. Retain it to preserve their meaning.",
          });
        return tx.subjectLevel.delete({ where: { id: input.id } });
      }),
    ),
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
    const isViewer = ctx.portalAccess.maskManagementData;
    const pairings = await ctx.db.pairing.findMany({
      where: { term: { active: true } },
      orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
      include: {
        tutor: true,
        room: true,
        term: true,
        timeSlot: true,
        group: { select: { primaryPairingId: true } },
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
        overrideTicket: z.string().optional(),
        clientKey: z.string().uuid().optional(),
        tutorId: cuid,
        roomId: roomReference.optional(),
        roomMode: z.enum(["AUTO", "FIXED", "NONE"]).optional(),
        // Pairings are scheduled by picking a published time slot — the slot is the single
        // source of truth for day/start/end (no free-form time entry).
        timeSlotId: cuid,
        subject: z.string().min(1),
        subjectId: cuid.optional(),
        tuteeIds: z.array(cuid).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tuteeIds, tutorId, roomId, timeSlotId, subject } = input;
      // Confirmation evidence and catalogue identity are never spread into Pairing columns.
      const data = { tutorId, roomId, timeSlotId, subject };
      return inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "program:period");
        const receipt = await pairingCreationReceipt(
          tx,
          ctx.session.user.id,
          input,
        );
        if (receipt?.replay) return receipt.replay;
        await enforceAssignmentQualification(
          tx,
          ctx.session.user.id,
          "admin.createPairing",
          input,
        );
        await lockPlannedRoomSchedule(tx);

        // New pairings always belong to the active program period.
        const [slot, period] = await Promise.all([
          resolveSlot(tx, input.timeSlotId),
          getActivePeriod(tx),
        ]);
        const allocation = await allocateRoom(
          tx,
          {
            termId: period.termId,
            tutorId,
            tuteeIds,
            scheduleConfirmed: true,
            dayOfWeek: slot.dayOfWeek,
            startMin: slot.startMin,
            endMin: slot.endMin,
          },
          input,
        );
        // Generic roster tools share the same request lock and first-assignment clock.
        for (const tuteeId of [...tuteeIds].sort())
          await assertStudentRequestAssignable(tx, tuteeId);
        const pairing = await tx.pairing.create({
          data: {
            ...data,
            ...allocationData(allocation),
            termId: period.termId,
            scheduleConfirmed: true,
            dayOfWeek: slot.dayOfWeek,
            startMin: slot.startMin,
            endMin: slot.endMin,
            tutees: { create: tuteeIds.map((tuteeId) => ({ tuteeId })) },
          },
        });
        for (const tuteeId of tuteeIds)
          await stampStudentAssignment(tx, tuteeId);
        await notifyRoomShortage(tx, pairing.id, allocation);
        if (receipt)
          await tx.pairingCreationRequest.create({
            data: {
              actorId: receipt.actorId,
              clientKey: receipt.clientKey,
              payloadHash: receipt.payloadHash,
              pairingId: pairing.id,
            },
          });
        // Nested roster writes advance the independent schedule snapshot in the database.
        return {
          ...(await tx.pairing.findUniqueOrThrow({
            where: { id: pairing.id },
          })),
          roomOutcome: allocation.roomOutcome,
        };
      });
    }),

  updatePairing: adminProcedure
    .input(
      z.object({
        overrideTicket: z.string().optional(),
        id: cuid,
        tutorId: cuid,
        roomId: roomReference.nullable().optional(),
        roomMode: z.enum(["AUTO", "FIXED", "NONE"]).optional(),
        releaseRoomToAuto: z.boolean().optional(),
        expectedRoomVersion: z.number().int().nonnegative().optional(),
        timeSlotId: cuid,
        subject: z.string().min(1),
        subjectId: cuid.optional(),
        tuteeIds: z.array(cuid),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, tuteeIds, tutorId, timeSlotId, subject } = input;
      const data = { tutorId, timeSlotId, subject };
      // Replace roster atomically; day/start/end follow the chosen slot.
      return inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "program:period");
        await enforceAssignmentQualification(
          tx,
          ctx.session.user.id,
          "admin.updatePairing",
          input,
        );
        await assertHeadDiscretionarySignupChange(
          tx,
          ctx.session.user.id,
          "admin.updatePairing",
          input,
        );
        await lockPlannedRoomSchedule(tx);
        const [slot, current] = await Promise.all([
          resolveSlot(tx, input.timeSlotId),
          tx.pairing.findUniqueOrThrow({
            where: { id },
            include: roomUnitInclude,
          }),
        ]);

        assertRoomVersion(current, input.expectedRoomVersion);
        // Retained roster/subject edits preserve an explicit group. Independent
        // tutor, schedule or room-intent edits keep the existing member-detach rule.
        const requestedMode =
          input.roomMode ??
          (input.roomId
            ? "FIXED"
            : input.roomId === null
              ? "NONE"
              : current.roomMode);
        const retainGroup =
          current.groupId &&
          tutorId === current.tutorId &&
          timeSlotId === current.timeSlotId &&
          requestedMode === current.roomMode &&
          (requestedMode !== "FIXED" ||
            input.roomId === undefined ||
            input.roomId === current.roomId);
        await assertPairingGroupsRemainEligible(tx, {
          replacement: { id, subject, tuteeIds, detach: !retainGroup },
        });
        const allocation = retainGroup
          ? { ...current, roomOutcome: "RETAINED" as const }
          : await allocateRoom(
              tx,
              {
                id,
                tutorId,
                tuteeIds,
                scheduleConfirmed: true,
                termId: current.termId,
                dayOfWeek: slot.dayOfWeek,
                startMin: slot.startMin,
                endMin: slot.endMin,
              },
              input,
              current,
            );
        for (const tuteeId of [...tuteeIds].sort())
          await assertStudentRequestAssignable(tx, tuteeId);
        await tx.pairingTutee.deleteMany({ where: { pairingId: id } });
        const pairing = await tx.pairing.update({
          where: { id },
          data: {
            ...data,
            ...allocationData(allocation),
            ...(current.groupId && !retainGroup ? { groupId: null } : {}),
            roomVersion: { increment: 1 },
            scheduleConfirmed: true,
            dayOfWeek: slot.dayOfWeek,
            startMin: slot.startMin,
            endMin: slot.endMin,
            tutees: { create: tuteeIds.map((tuteeId) => ({ tuteeId })) },
          },
        });
        for (const tuteeId of tuteeIds)
          await stampStudentAssignment(tx, tuteeId);
        if (retainGroup) {
          const selected = await tx.pairing.findUniqueOrThrow({
            where: { id },
            include: roomUnitInclude,
          });
          return allocateAndPersistRoomUnit(tx, selected, {
            ...input,
            expectedRoomVersion: undefined,
          });
        }
        await notifyRoomShortage(
          tx,
          pairing.id,
          allocation,
          current.roomShortageKey,
        );
        return {
          ...(await tx.pairing.findUniqueOrThrow({
            where: { id: pairing.id },
          })),
          roomOutcome: allocation.roomOutcome,
        };
      });
    }),

  /** Room intent is its own save scope: never replace a roster or consume an assignment ticket. */
  setPairingRoom: adminProcedure
    .input(
      z.object({
        id: cuid,
        expectedRoomVersion: z.number().int().nonnegative(),
        roomMode: z.enum(["AUTO", "FIXED", "NONE"]),
        roomId: roomReference.nullable().optional(),
        releaseRoomToAuto: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "program:period");
        await lockPlannedRoomSchedule(tx);
        const pairing = await tx.pairing.findFirst({
          where: { id: input.id, term: { active: true } },
          include: roomUnitInclude,
        });
        if (!pairing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Current pairing not found.",
          });
        return allocateAndPersistRoomUnit(tx, pairing, input);
      }),
    ),

  /** Room-only recovery deliberately leaves roster and qualification/ticket evidence alone. */
  retryRoomAllocation: adminProcedure
    .input(
      z.object({
        id: cuid,
        expectedRoomVersion: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "program:period");
        await lockPlannedRoomSchedule(tx);
        const pairing = await tx.pairing.findFirst({
          where: { id: input.id, term: { active: true } },
          include: roomUnitInclude,
        });
        if (!pairing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Current pairing not found.",
          });
        assertRoomVersion(pairing, input.expectedRoomVersion);
        if (pairing.roomMode !== "AUTO" || !pairing.roomNeedsAssignment)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only an automatic room shortage can be retried.",
          });
        return allocateAndPersistRoomUnit(tx, pairing, {
          expectedRoomVersion: input.expectedRoomVersion,
        });
      }),
    ),

  /** One reviewed batch owns complete reservation units; never move assigned rooms. */
  autoAssignUnassignedRooms: adminProcedure
    .input(bulkRoomAllocationInput)
    .mutation(({ ctx, input }) => autoAssignUnassignedRooms(ctx.db, input)),

  deletePairing: adminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      return inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "program:period");
        await lockCatalogue(tx);
        await assertHeadDiscretionarySignupChange(
          tx,
          ctx.session.user.id,
          "admin.deletePairing",
          input,
        );
        await assertPairingGroupsRemainEligible(tx, {
          pairingIds: [input.id],
          removePairingIds: [input.id],
        });
        const sessions = await tx.session.count({
          where: { pairingId: input.id },
        });
        if (sessions > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot delete a pairing that has attendance submissions.",
          });
        }
        await tx.pairingTutee.deleteMany({ where: { pairingId: input.id } });
        return tx.pairing.delete({ where: { id: input.id } });
      });
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
      // These flags distinguish proposal access from direct application in Program & Refresh.
      canEdit: ["ADMIN", "HEAD"].includes(ctx.session.role),
      canApply: ctx.session.role === "HEAD",
      termId: active.termId,
      schoolYear: active.schoolYear,
      quarter: active.quarter,
      semester: active.semester,
      name: curSemester ? periodLabel(from, true) : active.name,
      recruitment: {
        tutor: recruitmentWindow(active, "tutor"),
        tutee: recruitmentWindow(active, "tutee"),
      },
      signupOpensAt: active.signupOpensAt,
      signupPreviewUrl: active.signupPreviewUrl,
      signupIsOpen:
        recruitmentStatus(recruitmentWindow(active, "tutee")) === "open",
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

      const earnedBy = new Map(
        sessionAgg.map((s) => [s.tutorId, s._sum.shCount ?? 0]),
      );
      const sessionsBy = new Map(
        sessionAgg.map((s) => [s.tutorId, s._count._all]),
      );
      const punishBy = new Map<string, number>();
      const extraBy = new Map<string, number>();
      for (const a of adjustments) {
        const target = a.type === "PUNISHMENT" ? punishBy : extraBy;
        target.set(
          a.tutorId,
          (target.get(a.tutorId) ?? 0) + (a._sum.amount ?? 0),
        );
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

      const mask = input.maskPii || ctx.portalAccess.maskManagementData;
      const maskContact = (v: string | null | undefined): string | null =>
        mask ? null : (v ?? null);

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
          windowStart = selected.reduce((a, b) =>
            a.createdAt < b.createdAt ? a : b,
          ).createdAt;
          const latest = selected.reduce((a, b) =>
            a.createdAt > b.createdAt ? a : b,
          );
          const idx = allTerms.findIndex((tm) => tm.id === latest.id);
          windowEnd =
            idx >= 0 && idx + 1 < allTerms.length
              ? allTerms[idx + 1]!.createdAt
              : null;
        }
      }
      const wq = windowStart
        ? {
            createdAt: {
              gte: windowStart,
              ...(windowEnd ? { lt: windowEnd } : {}),
            },
          }
        : null;
      const periodWhere = input.month
        ? { month: input.month }
        : { schoolYear, quarter: { in: quarters } };

      const meetingWhere = input.month
        ? { date: { gte: windowStart!, lt: windowEnd! } }
        : { termId: { in: termIds } };
      const patrolWhere = input.month
        ? { createdAt: { gte: windowStart!, lt: windowEnd! } }
        : { termId: { in: termIds } };

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

      const earnedBy = new Map(
        sessionAgg.map((s) => [s.tutorId, s._sum.shCount ?? 0]),
      );
      const sessionsBy = new Map(
        sessionAgg.map((s) => [s.tutorId, s._count._all]),
      );
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
        .filter(
          (r) =>
            r.sessions > 0 ||
            r.earned !== 0 ||
            r.extras !== 0 ||
            r.punishments !== 0,
        );

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

      const [
        signupCount,
        cardCount,
        meetingCount,
        appCount,
        removalCount,
        statusReqCount,
        patrolCount,
        flagCount,
      ] = await Promise.all([
        wq ? ctx.db.tutee.count({ where: wq }) : Promise.resolve(0),
        wq ? ctx.db.disciplinaryCard.count({ where: wq }) : Promise.resolve(0),
        input.month || termIds.length
          ? ctx.db.tutorMeeting.count({ where: meetingWhere })
          : Promise.resolve(0),
        wq ? ctx.db.tutorApplication.count({ where: wq }) : Promise.resolve(0),
        wq
          ? ctx.db.tuteeRemovalRequest.count({ where: wq })
          : Promise.resolve(0),
        wq
          ? ctx.db.tutorStatusRequest.count({ where: wq })
          : Promise.resolve(0),
        input.month || termIds.length
          ? ctx.db.patrol.count({ where: patrolWhere })
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
            tutees: {
              select: {
                status: true,
                tutee: { select: { englishName: true } },
              },
            },
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
        input.month || termIds.length
          ? ctx.db.tutorMeeting.findMany({
              where: meetingWhere,
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
      const mTally = new Map<
        string,
        { present: number; excused: number; unexcused: number }
      >();
      for (const m of meetings) {
        for (const r of m.attendances) {
          const e = mTally.get(r.tutorId) ?? {
            present: 0,
            excused: 0,
            unexcused: 0,
          };
          if (r.status === "PRESENT") e.present++;
          else if (r.status === "EXCUSED_ABSENT") e.excused++;
          else if (r.status === "UNEXCUSED_ABSENT") e.unexcused++;
          mTally.set(r.tutorId, e);
        }
      }
      const tutorNameById = new Map(tutors.map((t) => [t.id, t.englishName]));
      const meetingStats = [...mTally.entries()]
        .map(([id, c]) => ({
          tutorId: id,
          tutor: tutorNameById.get(id) ?? "?",
          ...c,
        }))
        .filter((x) => x.present + x.excused + x.unexcused > 0)
        .sort(
          (a, b) =>
            b.unexcused - a.unexcused ||
            b.excused - a.excused ||
            a.tutor.localeCompare(b.tutor),
        );

      // Crew patrol tallies (per crew member) + the period's attendance-discrepancy flags.
      const [patrolAgg, flagRows] = await Promise.all([
        input.month || termIds.length
          ? ctx.db.patrol.groupBy({
              by: ["crewUserId"],
              where: patrolWhere,
              _count: { _all: true },
              _sum: { hours: true },
            })
          : Promise.resolve(
              [] as {
                crewUserId: string;
                _count: { _all: number };
                _sum: { hours: number | null };
              }[],
            ),
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
            session: {
              select: { date: true, pairing: { select: { subject: true } } },
            },
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
      const crewNameById = new Map(
        crewUsers.map((u) => [u.id, u.name ?? u.username ?? "?"]),
      );
      const crewStats = patrolAgg
        .map((p) => ({
          userId: p.crewUserId,
          member: crewNameById.get(p.crewUserId) ?? "?",
          patrols: p._count._all,
          hours: p._sum.hours ?? 0,
        }))
        .sort(
          (a, b) => b.patrols - a.patrols || a.member.localeCompare(b.member),
        );
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
          tutees: s.tutees.map((tt) => ({
            name: tt.tutee.englishName,
            status: tt.status,
          })),
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
      const [applications, signups, removals, statusRequests] =
        await Promise.all([
          wq
            ? ctx.db.tutorApplication.findMany({
                where: wq,
                orderBy: { createdAt: "desc" },
                select: {
                  id: true,
                  createdAt: true,
                  name: true,
                  status: true,
                  email: true,
                  preferredContact: true,
                },
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
                select: {
                  id: true,
                  createdAt: true,
                  kind: true,
                  state: true,
                  tutee: { select: { englishName: true } },
                },
              })
            : Promise.resolve([]),
          wq
            ? ctx.db.tutorStatusRequest.findMany({
                where: wq,
                orderBy: { createdAt: "desc" },
                select: {
                  id: true,
                  createdAt: true,
                  kind: true,
                  state: true,
                  tutor: { select: { englishName: true } },
                },
              })
            : Promise.resolve([]),
        ]);

      // Reports project effective enrollment evidence without rewriting the archive
      // or borrowing a linked account's current grade. A preserved null is meaningful.
      const signupAcademics = signups.length
        ? await ctx.db.historicalAcademicRecord.findMany({
            where: {
              id: {
                in: signups.map((s) => legacyAcademicRecordId("TUTEE", s.id)),
              },
            },
            select: {
              tuteeId: true,
              rawGrade: true,
              corrections: {
                orderBy: { revision: "desc" },
                take: 1,
                select: { rawGrade: true },
              },
            },
          })
        : [];
      const signupGrades = new Map(
        signupAcademics.map((record) => [
          record.tuteeId,
          record.corrections[0]
            ? record.corrections[0].rawGrade
            : record.rawGrade,
        ]),
      );

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
          grade: signupGrades.has(s.id)
            ? signupGrades.get(s.id)!
            : s.gradeLevel,
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

  /** Head applies now; Admin submits the exact refresh for Head review. */
  refresh: adminOnlyProcedure.input(refreshProgramInput)
    .mutation(({ ctx, input }) => applyProgramRefresh(ctx.db, input, ctx.session.user)),

  refreshSchedule: adminProcedure.input(z.object({ id: z.string().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => ({
      ...await readRefreshSchedule(ctx.db, input?.id),
      canEdit: ["ADMIN", "HEAD"].includes(ctx.session.role), canApply: ctx.session.role === "HEAD",
    })),
  scheduleRefresh: adminOnlyProcedure.input(scheduleRefreshInput)
    .mutation(({ ctx, input }) => scheduleProgramRefresh(ctx.db, input, ctx.session.user)),
  cancelRefresh: adminOnlyProcedure.input(cancelRefreshInput)
    .mutation(({ ctx, input }) => cancelProgramRefresh(ctx.db, input, ctx.session.user)),
