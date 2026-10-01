import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, headProcedure } from "../trpc";
import { departureChange } from "~/lib/school-departure";
import { changeSchoolDeparture } from "~/server/school-departure";
import { queueProposal } from "~/server/approvals";
import { portalAccess } from "~/lib/portal-access";

export const departureRouter = createTRPCRouter({
  state: protectedProcedure
    .input(z.object({ userId: z.string().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const userId = input.userId ?? ctx.session.user.id;
      if (
        userId !== ctx.session.user.id &&
        !["HEAD", "ADMIN", "COORDINATOR"].includes(ctx.session.role)
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          schoolDeparture: true,
          departureEvents: { orderBy: { revision: "desc" }, take: 20 },
        },
      });
      return {
        departure: user.schoolDeparture,
        events: user.departureEvents,
        access: portalAccess(user),
        role: ctx.session.role,
        retained: {
          role: user.role,
          crew: !!user.crewStatus,
          translator: user.canTranslate,
        },
      };
    }),
  request: protectedProcedure
    .input(departureChange.omit({ userId: true }))
    .mutation(async ({ ctx, input }) => {
      // Students can request a factual departure/return, not undo a staff access revocation.
      if (["REVOKE", "RESTORE"].includes(input.action))
        throw new TRPCError({ code: "FORBIDDEN" });
      return queueProposal(ctx.session, "departure.setState", {
        ...input,
        userId: ctx.session.user.id,
      });
    }),
  setState: headProcedure
    .input(departureChange)
    .mutation(({ ctx, input }) =>
      changeSchoolDeparture(ctx.db, input, ctx.session.user.id),
    ),
});
