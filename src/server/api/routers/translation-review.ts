import { translationPublicationScope } from "~/server/db-scope";
import { accountHistoryIds } from "~/server/account-history";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  translationReviewerProcedure,
  adminProcedure,
} from "~/server/api/trpc";
import {
  lockTranslationReviewDecision,
  translationReviewDecisionInput,
} from "~/server/translation-review-preflight";
import {
  captureTranslationReviewAuthority,
  lockTranslationReviewAuthority,
} from "~/server/translation-review-authority";
import {
  visibleTranslationPayload,
  withTranslationWrite,
} from "~/server/translation-destination";
import { homeRouter } from "./home";
import { localizationRouter } from "./localization";
import type { PrismaClient } from "../../../../generated/prisma";

/** Approval runs the original validated staff mutation and the decision in the same transaction.
 * The called text-only mutations use transaction-compatible delegates, never nested $transaction. */
export const translationReviewRouter = createTRPCRouter({
  list: translationReviewerProcedure
    .input(
      z
        .object({
          page: z.number().int().min(0).default(0),
          state: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
        })
        .default({ page: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.translationDraft.findMany({
        where: {
          state: input.state,
          authorId: ["HEAD", "ADMIN", "COORDINATOR"].includes(ctx.session.role)
            ? undefined
            : { in: await accountHistoryIds(ctx.db, ctx.session.user.id) },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 30,
        skip: input.page * 30,
      });
      return rows.map((row) => ({
        ...row,
        ...visibleTranslationPayload(row.payload),
      }));
    }),
  decide: adminProcedure
    .input(translationReviewDecisionInput)
    .mutation(async ({ ctx, input }) => {
      const authority = captureTranslationReviewAuthority(ctx.session);
      return withTranslationWrite(ctx.db, async (tx) => {
        const reviewer = await lockTranslationReviewAuthority(
          tx,
          authority,
          "DECIDE",
          input,
        );
        const draft = await lockTranslationReviewDecision(tx, input);
        if (input.approve) {
          const context = {
            ...ctx,
            db: tx as PrismaClient,
            session: { ...ctx.session, role: reviewer.role },
          };
          const home = homeRouter.createCaller(context);
          const localization = localizationRouter.createCaller(context);
          const value = z.object({
            locale: z.string(),
            key: z.string(),
            value: z.string(),
          });
          await translationPublicationScope.run(
            { reviewerId: ctx.session.user.id, operation: draft.operation },
            async () => {
              switch (draft.operation) {
                case "localization.setString":
                  await localization.setString(value.parse(draft.payload));
                  break;
                case "home.setContent":
                  await home.setContent(value.parse(draft.payload));
                  break;
                case "home.setNewsTranslation":
                  await home.setNewsTranslation(
                    z
                      .object({
                        postId: z.string(),
                        locale: z.string(),
                        title: z.string(),
                        body: z.string(),
                      })
                      .parse(draft.payload),
                  );
                  break;
                case "home.setSectionTranslation":
                  await home.setSectionTranslation(
                    z
                      .object({
                        sectionId: z.string(),
                        locale: z.string(),
                        title: z.string(),
                        body: z.string(),
                      })
                      .parse(draft.payload),
                  );
                  break;
                case "home.setPageTitle":
                  await home.setPageTitle(
                    z
                      .object({
                        id: z.string(),
                        locale: z.string(),
                        value: z.string(),
                      })
                      .parse(draft.payload),
                  );
                  break;
                default:
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Unknown draft type.",
                  });
              }
            },
          );
        }
        await tx.translationDraft.update({
          where: { id: input.id },
          data: {
            state: input.approve ? "APPROVED" : "REJECTED",
            reviewedById: ctx.session.user.id,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            entity: "TranslationDraft",
            entityId: input.id,
            action: input.approve
              ? "Published translation draft"
              : "Rejected translation draft",
            details: draft.payload!,
          },
        });
        return { ok: true };
      });
    }),
});
