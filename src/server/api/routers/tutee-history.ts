import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createTRPCRouter,
  adminProcedure,
  adminOnlyProcedure,
  protectedProcedure,
} from "../trpc";
import { ownedStudentIds } from "~/server/student-ownership";
import { rateLimit } from "~/server/rate-limit";
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
    .input(tokenInput)
    .query(({ ctx, input }) =>
      inspectHistoryClaim(ctx.db, ctx.session.user.id, input.token),
    ),
  claim: protectedProcedure.input(tokenInput).mutation(({ ctx, input }) => {
    limit(ctx.session.user.id);
    return claimTuteeHistory(ctx.db, ctx.session.user.id, input.token);
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
