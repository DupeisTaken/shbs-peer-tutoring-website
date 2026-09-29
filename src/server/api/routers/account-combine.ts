import { z } from "zod";
import { createTRPCRouter, headProcedure } from "../trpc";
import {
  combineAccounts,
  combineInput,
  previewCombine,
} from "~/server/combine-accounts";

export const accountCombineRouter = createTRPCRouter({
  candidates: headProcedure.query(({ ctx }) =>
    ctx.db.user.findMany({
      where: { mergedIntoId: null },
      select: { id: true, name: true, email: true, username: true, role: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ),
  preview: headProcedure
    .input(combineInput)
    .query(({ ctx, input }) => previewCombine(ctx.db, input)),
  combine: headProcedure
    .input(
      combineInput.extend({
        fingerprint: z.string().length(64),
        confirmPassword: z.string().min(1).max(1024),
      }),
    )
    .mutation(({ ctx, input }) =>
      combineAccounts(ctx.db, ctx.session.user.id, input),
    ),
});
