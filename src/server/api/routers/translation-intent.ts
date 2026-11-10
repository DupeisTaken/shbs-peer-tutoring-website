import { translationIntentReference } from "~/lib/translation-intent";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  getTranslationIntent,
  stopTranslationIntent,
} from "~/server/translation-intents";

/** Own metadata recovery grants neither translation editing nor review access. */
export const translationIntentRouter = createTRPCRouter({
  get: protectedProcedure
    .input(translationIntentReference)
    .query(({ ctx, input }) =>
      getTranslationIntent(ctx.db, ctx.session, input),
    ),
  stop: protectedProcedure
    .input(translationIntentReference)
    .mutation(({ ctx, input }) =>
      stopTranslationIntent(ctx.db, ctx.session, input),
    ),
});
