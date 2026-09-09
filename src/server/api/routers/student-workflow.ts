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

const id = z.string().min(1).max(128);
const ticket = z.string().min(1).max(128);
const reason = z.string().trim().min(1).max(2000);

export const studentWorkflowRouter = createTRPCRouter({
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
  policyStatus: publicProcedure.query(({ ctx }) =>
    ctx.session?.user ? studentPolicyStatus(ctx.db, ctx.session.user.id) : null,
  ),
  acceptPolicy: protectedProcedure
    .input(z.object({ revision: id, ticket, agreed: z.literal(true) }))
    .mutation(({ ctx, input }) =>
      acceptStudentPolicy(
        ctx.db,
        ctx.session.user.id,
        input.revision,
        input.ticket,
      ),
    ),
  mine: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
    });
    if (!user || user.suspendedAt) throw new TRPCError({ code: "FORBIDDEN" });
    const rows = await studentRequestRows(ctx.db, user.email);
    return rows.filter((row) => row.confirmedAt !== null);
  }),
  editAvailability: protectedProcedure
    .input(z.object({ id, slotIds: z.array(id).min(1).max(100) }).strict())
    .mutation(({ ctx, input }) =>
      editStudentAvailability(
        ctx.db,
        ctx.session.user.id,
        input.id,
        input.slotIds,
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
  adminRequests: adminProcedure.query(({ ctx }) => studentRequestRows(ctx.db)),
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
      pairingId: r.pairingId,
      assignment: pairings.find((p) => p.id === r.pairingId) ?? null,
    }));
  }),
  assign: adminProcedure
    .input(z.object({ id, ticket, subjectId: id, tutorId: id }))
    .mutation(({ ctx, input }) =>
      assignStudentRequest(
        ctx.db,
        input.id,
        ctx.session.user.id,
        input.ticket,
        input.subjectId,
        input.tutorId,
      ),
    ),
  resend: adminProcedure
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      await expireStudentRequests(ctx.db);
      const row = await ctx.db.studentSurvey.findUniqueOrThrow({
        where: { id: input.id },
      });
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
