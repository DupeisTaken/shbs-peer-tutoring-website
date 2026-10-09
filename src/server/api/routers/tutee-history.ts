import { TRPCError } from "@trpc/server";
import {
  issueHistoryAccountInvitation,
  historyInvitationDigest,
} from "~/server/auth/account-invitations";
import { z } from "zod";
import {
  createTRPCRouter,
  adminProcedure,
  adminOnlyProcedure,
  protectedProcedure,
  publicProcedure,
} from "../trpc";
import { ownedStudentIds } from "~/server/student-ownership";
import { rateLimit } from "~/server/rate-limit";
import {
  ownedTutorHistory,
  personalTutorHistory,
} from "~/server/personal-tutor-history";
import { normalizeRegCode } from "~/server/auth/code";
import { withSignupAdmission } from "~/server/signup-admission";
import {
  startHistoryAccount,
  verifyHistoryAccount,
  historyInvitationStatus,
  cancelHistoryInvitation,
} from "~/server/history-account-setup";
import {
  historyPairInput,
  historyLinkInput,
  historyInviteInput,
  previewHistoryLink,
  linkTuteeHistory,
  inviteTuteeHistory,
  inspectHistoryClaim,
  claimTuteeHistory,
  tuteeHistoryDetails,
} from "~/server/tutee-history";

const detailInput = z.object({
  tuteeId: z.string().min(1).max(128),
  page: z.number().int().min(0).max(10000).default(0),
});
const tokenInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
const claimInput = z.union([
  tokenInput,
  z.object({ invitationId: z.string().min(1).max(128) }),
]);
const setupInput = tokenInput.extend({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
});
function limit(actorId: string) {
  if (
    !rateLimit(`history-link:${actorId}`, { max: 20, windowMs: 15 * 60000 }).ok
  )
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "HISTORY_RATE_LIMIT",
    });
}

/** Historical ownership is independent of current tutee membership. Every personal read
 * is scoped again on the server; knowing another record ID never grants access. */
export const tuteeHistoryRouter = createTRPCRouter({
  myTutorRecords: protectedProcedure.query(({ ctx }) =>
    ownedTutorHistory(ctx.db, ctx.session.user.id),
  ),
  myTutorDetails: protectedProcedure
    .input(
      z.object({
        tutorId: z.string().min(1).max(128),
        page: z.number().int().min(0).max(10000).default(0),
      }),
    )
    .query(({ ctx, input }) =>
      personalTutorHistory(
        ctx.db,
        ctx.session.user.id,
        input.tutorId,
        input.page,
      ),
    ),
  // Possession of an exact staff invitation replaces open signup admission; delivery/CPU
  // budgets still apply. Signed-in people use their existing account and claim explicitly.
  startAccount: publicProcedure.input(setupInput).mutation(({ ctx, input }) => {
    if (ctx.session?.user)
      throw new TRPCError({ code: "CONFLICT", message: "HISTORY_EMAIL_TAKEN" });
    return withSignupAdmission(ctx.db, ctx.headers, "mail", input.email, () =>
      startHistoryAccount(ctx.db, input),
    );
  }),
  verifyAccount: publicProcedure
    .input(
      setupInput.extend({
        code: z.string().max(30).transform(normalizeRegCode),
      }),
    )
    .mutation(({ ctx, input }) =>
      withSignupAdmission(
        ctx.db,
        ctx.headers,
        "complete",
        input.email,
        async () => {
          const verified = await verifyHistoryAccount(ctx.db, input);
          const invitation = await issueHistoryAccountInvitation(ctx.db, {
            ...input,
            completionProof: verified.completionProof,
          });
          return { ...verified, ...invitation };
        },
      ),
    ),
  completeAccount: publicProcedure
    .input(
      setupInput.extend({
        completionProof: z.string().regex(/^[a-f0-9]{64}$/),
        password: z.string().min(8).max(200),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (ctx.session?.user)
        throw new TRPCError({
          code: "CONFLICT",
          message: "HISTORY_EMAIL_TAKEN",
        });
      return withSignupAdmission(
        ctx.db,
        ctx.headers,
        "complete",
        input.email,
        () => issueHistoryAccountInvitation(ctx.db, input),
      );
    }),
  invitationStatus: adminOnlyProcedure
    .input(z.object({ tuteeId: z.string().min(1).max(128) }))
    .query(({ ctx, input }) => historyInvitationStatus(ctx.db, input.tuteeId)),
  cancelInvitation: adminOnlyProcedure
    .input(
      z.object({
        tuteeId: z.string().min(1).max(128),
        revision: z.string().length(64),
      }),
    )
    .mutation(({ ctx, input }) =>
      cancelHistoryInvitation(ctx.db, ctx.session.user.id, input),
    ),
  permissions: protectedProcedure.query(({ ctx }) => ({
    canLink: ["HEAD", "ADMIN"].includes(ctx.session.role),
    isHead: ctx.session.role === "HEAD",
  })),
  details: adminProcedure
    .input(detailInput)
    .query(({ ctx, input }) =>
      tuteeHistoryDetails(ctx.db, input.tuteeId, input.page),
    ),
  candidates: adminOnlyProcedure
    .input(z.object({ search: z.string().trim().min(2).max(100) }))
    .query(({ ctx, input }) =>
      ctx.db.user.findMany({
        where: {
          mergedIntoId: null,
          suspendedAt: null,
          emailVerifiedAt: { not: null },
          passwordHash: { not: null },
          mustChangePassword: false,
          OR: [
            { name: { contains: input.search, mode: "insensitive" } },
            { username: { contains: input.search, mode: "insensitive" } },
            { email: { contains: input.search, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, email: true, username: true },
        take: 25,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    ),
  preview: adminOnlyProcedure
    .input(historyPairInput)
    .query(({ ctx, input }) => previewHistoryLink(ctx.db, input)),
  link: adminOnlyProcedure
    .input(historyLinkInput)
    .mutation(({ ctx, input }) => {
      limit(ctx.session.user.id);
      return linkTuteeHistory(ctx.db, ctx.session.user.id, input);
    }),
  invite: adminOnlyProcedure
    .input(historyInviteInput)
    .mutation(({ ctx, input }) => {
      limit(ctx.session.user.id);
      return inviteTuteeHistory(ctx.db, ctx.session.user.id, input);
    }),
  inspectClaim: protectedProcedure
    .input(claimInput)
    .query(async ({ ctx, input }) => {
      const fromEnvelope = "invitationId" in input;
      const token = fromEnvelope
        ? await historyInvitationDigest(
            ctx.db,
            input.invitationId,
            ctx.session.user.id,
          )
        : input.token;
      return inspectHistoryClaim(
        ctx.db,
        ctx.session.user.id,
        token,
        fromEnvelope,
      );
    }),
  claim: protectedProcedure
    .input(claimInput)
    .mutation(async ({ ctx, input }) => {
      limit(ctx.session.user.id);
      const fromEnvelope = "invitationId" in input;
      const token = fromEnvelope
        ? await historyInvitationDigest(
            ctx.db,
            input.invitationId,
            ctx.session.user.id,
          )
        : input.token;
      return claimTuteeHistory(
        ctx.db,
        ctx.session.user.id,
        token,
        fromEnvelope,
      );
    }),
  myRecords: protectedProcedure.query(async ({ ctx }) =>
    ctx.db.tutee.findMany({
      where: { id: { in: await ownedStudentIds(ctx.db, ctx.session.user.id) } },
      select: {
        id: true,
        englishName: true,
        gradeLevel: true,
        intakeTermId: true,
        _count: { select: { sessions: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
  ),
  myDetails: protectedProcedure
    .input(detailInput)
    .query(async ({ ctx, input }) => {
      if (
        !(await ownedStudentIds(ctx.db, ctx.session.user.id)).includes(
          input.tuteeId,
        )
      )
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "HISTORY_NOT_FOUND",
        });
      return tuteeHistoryDetails(ctx.db, input.tuteeId, input.page);
    }),
});
