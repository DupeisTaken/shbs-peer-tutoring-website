import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  adminOnlyProcedure,
  protectedProcedure,
} from "../trpc";
import {
  previewTutorHistory,
  linkTutorHistory,
  tutorHistoryPair,
  tutorHistoryLink,
} from "~/server/tutor-history";
import { rateLimit } from "~/server/rate-limit";

export const tutorHistoryRouter = createTRPCRouter({
  permissions: protectedProcedure.query(({ ctx }) => ({
    canLink: ["HEAD", "ADMIN"].includes(ctx.session.role),
    isHead: ctx.session.role === "HEAD",
  })),
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
    .input(tutorHistoryPair)
    .query(({ ctx, input }) => previewTutorHistory(ctx.db, input)),
  link: adminOnlyProcedure
    .input(tutorHistoryLink)
    .mutation(({ ctx, input }) => {
      if (
        !rateLimit(`tutor-history-link:${ctx.session.user.id}`, {
          max: 20,
          windowMs: 15 * 60000,
        }).ok
      )
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "HISTORY_RATE_LIMIT",
        });
      return linkTutorHistory(ctx.db, ctx.session.user.id, input);
    }),
});
