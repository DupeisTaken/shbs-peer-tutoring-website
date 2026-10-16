import { applyLegacyStudentWithdrawal } from "~/server/legacy-student-withdrawal";
import {
  assertRequestProcessable,
  requestInvalidityInput,
  setStudentRequestInvalidity,
} from "~/server/request-invalidity";
import { ownedStudentIds } from "~/server/student-ownership";
import { z } from "zod";
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  activeTutorProcedure,
  tutorProcedure,
} from "../trpc";
import {
  actionNames,
  prepareStudentAction,
  cancelStudentAction,
  acceptStudentPolicy,
  studentPolicyStatus,
  assignStudentRequest,
  editStudentAvailability,
  recallStudentRequest,
  applyStudentAbort,
  applyScheduleRejection,
  resolveStudentReview,
  studentRequestRows,
} from "~/server/student-workflow";
import { resendSurvey, surveyLimit } from "~/server/student-survey";
import { expireStudentRequests } from "~/server/student-request-state";
import { TRPCError } from "@trpc/server";
import {
  inspectOwnedStudentSignup,
  editOwnedStudentSignup,
  studentSignupEditInput,
} from "~/server/student-signup-editor";
import {
  headSignupUnassignInput,
  unassignStudentSignup,
} from "~/server/student-signup-management";
import {
  signupAppealTokenInput,
  signupAppealInput,
  ownedSignupAppealInput,
  resolveSignupAppealInput,
  inspectSignupAppeal,
  appealStudentSignup,
  resolveStudentSignupAppeal,
  retrySignupNotices,
} from "~/server/student-signup-appeals";

const id = z.string().min(1).max(128);
const ticket = z.string().min(1).max(128);
const reason = z.string().trim().min(1).max(2000);

export const studentWorkflowRouter = createTRPCRouter({
  managedSignup: adminProcedure
    .input(z.object({ id }).strict())
    .query(({ ctx, input }) =>
      inspectOwnedStudentSignup(ctx.db, ctx.session.user.id, input.id, true),
    ),
  headEditSignup: adminProcedure
    .input(
      studentSignupEditInput
        .extend({
          signedTicket: ticket,
          releaseChangedAssignments: z.literal(true),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      editOwnedStudentSignup(ctx.db, ctx.session.user.id, input, {
        signedTicket: input.signedTicket,
        releaseChangedAssignments: true,
      }),
    ),
  headUnassign: adminProcedure
    .input(headSignupUnassignInput)
    .mutation(({ ctx, input }) =>
      unassignStudentSignup(ctx.db, ctx.session.user.id, input),
    ),
  inspectSignupAppeal: publicProcedure
    .input(signupAppealTokenInput)
    .mutation(({ ctx, input }) => inspectSignupAppeal(ctx.db, input.token)),
  appealSignup: publicProcedure
    .input(signupAppealInput)
    .mutation(({ ctx, input }) => appealStudentSignup(ctx.db, input)),
  appealOwnedSignup: protectedProcedure
    .input(ownedSignupAppealInput)
    .mutation(({ ctx, input }) =>
      appealStudentSignup(ctx.db, input, ctx.session.user.id),
    ),
  resolveSignupAppeal: adminProcedure
    .input(resolveSignupAppealInput)
    .mutation(({ ctx, input }) =>
      resolveStudentSignupAppeal(ctx.db, ctx.session.user.id, input),
    ),
  resendSignupNotice: adminProcedure
    .input(z.object({ id }).strict())
    .mutation(async ({ ctx, input }) => {
      const actor = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
      });
      if (
        !["HEAD", "ADMIN", "COORDINATOR"].includes(actor.role) ||
        actor.suspendedAt ||
        actor.mergedIntoId
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      return retrySignupNotices(ctx.db, input.id);
    }),
  signup: protectedProcedure
    .input(z.object({ id }).strict())
    .query(({ ctx, input }) =>
      inspectOwnedStudentSignup(ctx.db, ctx.session.user.id, input.id),
    ),
  editSignup: protectedProcedure
    .input(studentSignupEditInput)
    .mutation(({ ctx, input }) =>
      editOwnedStudentSignup(ctx.db, ctx.session.user.id, input),
    ),
  prepareAction: protectedProcedure
    .input(
      z.object({
        action: z.enum(actionNames),
        target: z.string().min(1).max(300),
      }),
    )
    .mutation(({ ctx, input }) => {
      surveyLimit(`actions:${ctx.session.user.id}`, 100);
      return prepareStudentAction(
        ctx.db,
        ctx.session.user.id,
        input.action,
        input.target,
      );
    }),
  cancelAction: protectedProcedure
    .input(z.object({ ticket }))
    .mutation(({ ctx, input }) => cancelStudentAction(ctx.db, ctx.session.user.id, input.ticket)),
  policyStatus: publicProcedure
    .input(z.object({ tuteeEntry: z.boolean().default(false) }).optional())
    .query(({ ctx, input }) =>
      ctx.session?.user
        ? studentPolicyStatus(ctx.db, ctx.session.user.id, input?.tuteeEntry)
        : null,
    ),
  acceptPolicy: protectedProcedure
    .input(
      z.object({
        revision: id,
        ticket,
        agreed: z.literal(true),
        slug: z.enum(["tutee-policy", "tutor-policy"]).default("tutee-policy"),
      }),
    )
    .mutation(({ ctx, input }) =>
      acceptStudentPolicy(
        ctx.db,
        ctx.session.user.id,
        input.revision,
        input.ticket,
        input.slug,
      ),
    ),
  mine: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
    });
    if (!user || user.suspendedAt) throw new TRPCError({ code: "FORBIDDEN" });
    const rows = await studentRequestRows(ctx.db, undefined, user.id);
    // Already scoped by retained/direct ownership, including explicitly owned unverified
    // materialized requests. A matching email never adds a row here.
    return rows;
  }),
  legacyParticipation: protectedProcedure.query(async ({ ctx }) => {
    const ids = await ownedStudentIds(ctx.db, ctx.session.user.id);
    const account = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { studentId: true },
    });
    const term = await ctx.db.term.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!term || !ids.length) return [];
    const withdrawalIds = await ctx.db.studentRequestReview.findMany({
      where: {
        legacyTuteeId: { in: ids },
        legacyIntakeTermId: term.id,
        kind: "STUDENT_ABORT",
      },
      select: { legacyTuteeId: true },
    });
    const [students, surveys, reviews] = await Promise.all([
      ctx.db.tutee.findMany({
        where: {
          id: { in: ids },
          OR: [
            {
              id: {
                in: withdrawalIds.flatMap((r) =>
                  r.legacyTuteeId ? [r.legacyTuteeId] : [],
                ),
              },
            },
            { intakeTermId: term.id },
            ...(account?.studentId
              ? [
                  {
                    id: account.studentId,
                    intakeTermId: null,
                    status: { not: "INACTIVE" as const },
                  },
                ]
              : []),
            { pairings: { some: { pairing: { termId: term.id } } } },
          ],
        },
        select: { id: true, englishName: true, status: true },
      }),
      ctx.db.studentSurvey.findMany({
        where: { tuteeId: { in: ids } },
        select: { tuteeId: true },
      }),
      ctx.db.studentRequestReview.findMany({
        where: {
          legacyTuteeId: { in: ids },
          legacyIntakeTermId: term.id,
          kind: "STUDENT_ABORT",
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return students
      .filter(
        (student) => !surveys.some((survey) => survey.tuteeId === student.id),
      )
      .map((student) => ({
        ...student,
        reviews: reviews
          .filter((review) => review.legacyTuteeId === student.id)
          .map((review) => ({
            id: review.id,
            state: review.state,
            createdAt: review.createdAt,
            resolvedAt: review.resolvedAt,
          })),
      }));
  }),
  applyLegacyWithdrawal: protectedProcedure
    .input(z.object({ tuteeId: id, reason, ticket }).strict())
    .mutation(({ ctx, input }) =>
      applyLegacyStudentWithdrawal(
        ctx.db,
        ctx.session.user.id,
        input.tuteeId,
        input.reason,
        input.ticket,
      ),
    ),
  editAvailability: protectedProcedure
    .input(
      z
        .object({
          id,
          slotIds: z.array(id).min(1).max(100),
          expectedVersion: z.number().int().nonnegative().default(0),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      editStudentAvailability(
        ctx.db,
        ctx.session.user.id,
        input.id,
        input.slotIds,
        input.expectedVersion,
      ),
    ),
  recall: protectedProcedure
    .input(z.object({ id, ticket }))
    .mutation(({ ctx, input }) =>
      recallStudentRequest(ctx.db, ctx.session.user.id, input.id, input.ticket),
    ),
  applyAbort: protectedProcedure
    .input(z.object({ id, ticket, reason }))
    .mutation(({ ctx, input }) =>
      applyStudentAbort(
        ctx.db,
        ctx.session.user.id,
        input.id,
        input.reason,
        input.ticket,
      ),
    ),
  adminRequests: adminProcedure.query(({ ctx }) =>
    studentRequestRows(ctx.db, undefined, undefined, true),
  ),
  setRequestInvalidity: adminProcedure
    .input(requestInvalidityInput)
    .mutation(({ ctx, input }) =>
      setStudentRequestInvalidity(ctx.db, input, ctx.session.user),
    ),
  legacyReviews: adminProcedure.query(async ({ ctx }) => {
    const term = await ctx.db.term.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!term) return [];
    const reviews = await ctx.db.studentRequestReview.findMany({
      where: { surveyId: null, legacyIntakeTermId: term.id },
      orderBy: { createdAt: "asc" },
    });
    const tutees = await ctx.db.tutee.findMany({
      where: { id: { in: reviews.map((r) => r.legacyTuteeId!) } },
      select: { id: true, englishName: true },
    });
    const pairings = await ctx.db.pairing.findMany({
      where: {
        id: { in: reviews.flatMap((r) => (r.pairingId ? [r.pairingId] : [])) },
      },
      select: {
        id: true,
        subject: true,
        tutor: { select: { englishName: true } },
      },
    });
    return reviews.map((r) => ({
      id: r.id,
      name: tutees.find((t) => t.id === r.legacyTuteeId)?.englishName ?? "—",
      kind: r.kind,
      reason: r.reason,
      state: r.state,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      pairingId: r.pairingId,
      assignment: pairings.find((p) => p.id === r.pairingId) ?? null,
    }));
  }),
  assign: adminProcedure
    .input(
      z.object({
        id,
        ticket,
        subjectId: id,
        tutorId: id,
        overrideTicket: ticket.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      assignStudentRequest(
        ctx.db,
        input.id,
        ctx.session.user.id,
        input.ticket,
        input.subjectId,
        input.tutorId,
        input.overrideTicket,
      ),
    ),
  resend: adminProcedure
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      await expireStudentRequests(ctx.db);
      const row = await ctx.db.studentSurvey.findUniqueOrThrow({
        where: { id: input.id },
      });
      assertRequestProcessable(row);
      const term = await ctx.db.term.findUnique({
        where: { id: row.intakeTermId },
      });
      if (row.state !== "OPEN" || row.confirmedAt || !term?.active)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Only current unverified requests can receive a signup link.",
        });
      return { emailSent: await resendSurvey(ctx.db, row.email) };
    }),
  resolveReview: adminProcedure
    .input(z.object({ id, approve: z.boolean(), ticket }))
    .mutation(({ ctx, input }) =>
      resolveStudentReview(
        ctx.db,
        ctx.session.user.id,
        input.id,
        input.approve,
        input.ticket,
      ),
    ),
  tutorRoster: tutorProcedure.query(async ({ ctx }) => {
    await expireStudentRequests(ctx.db);
    const assigned = await ctx.db.pairingTutee.findMany({
      where: {
        pairing: { tutorId: ctx.session.tutorId, term: { active: true } },
      },
      include: {
        tutee: { include: { availabilities: { include: { slot: true } } } },
      },
    });
    const surveys = await ctx.db.studentSurvey.findMany({
      where: { tuteeId: { in: assigned.map((a) => a.tuteeId) }, state: "OPEN" },
      include: {
        reviews: { where: { state: "PENDING", kind: "SCHEDULE_CONFLICT" } },
      },
    });
    const legacyReviews = await ctx.db.studentRequestReview.findMany({
      where: {
        legacyTuteeId: { in: assigned.map((a) => a.tuteeId) },
        state: "PENDING",
      },
    });
    return assigned.map((a) => {
      const s = surveys.find((r) => r.tuteeId === a.tuteeId);
      return {
        tuteeId: a.tuteeId,
        pairingId: a.pairingId,
        managed: !!s,
        editedAt: s?.editedAt ?? null,
        verified: s ? !!s.confirmedAt : true,
        verificationDueAt: s?.verificationDueAt ?? null,
        slots: a.tutee.availabilities.map((x) => x.slot),
        pending: s
          ? s.reviews.some((r) => r.pairingId === a.pairingId)
          : legacyReviews.some(
              (r) =>
                r.legacyTuteeId === a.tuteeId && r.pairingId === a.pairingId,
            ),
      };
    });
  }),
  rejectSchedule: activeTutorProcedure
    .input(z.object({ tuteeId: id, pairingId: id, reason, ticket }))
    .mutation(({ ctx, input }) =>
      applyScheduleRejection(
        ctx.db,
        ctx.session.user.id,
        ctx.session.tutorId,
        input.tuteeId,
        input.pairingId,
        input.reason,
        input.ticket,
      ),
    ),
});
