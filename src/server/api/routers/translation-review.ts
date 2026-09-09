import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  translatorProcedure,
  adminProcedure,
} from "~/server/api/trpc";
import { inTransaction, lockEntity } from "~/server/transactions";
import { homeRouter } from "./home";
import { localizationRouter } from "./localization";
import type { PrismaClient } from "../../../../generated/prisma";

/** Approval runs the original validated staff mutation and the decision in the same transaction.
 * The called text-only mutations use transaction-compatible delegates, never nested $transaction. */
export const translationReviewRouter = createTRPCRouter({
  list: translatorProcedure
    .input(
      z
        .object({ page: z.number().int().min(0).default(0) })
        .default({ page: 0 }),
    )
    .query(({ ctx, input }) =>
      ctx.db.translationDraft.findMany({
        where: ["HEAD", "ADMIN", "COORDINATOR"].includes(ctx.session.role)
          ? {}
          : { authorId: ctx.session.user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        skip: input.page * 30,
      }),
    ),
  decide: adminProcedure
    .input(
      z.object({
        id: z.string(),
        approve: z.boolean(),
        expectedUpdatedAt: z.coerce.date(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, `translation:${input.id}`);
        const draft = await tx.translationDraft.findUniqueOrThrow({
          where: { id: input.id },
        });
        if (
          draft.state !== "PENDING" ||
          draft.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "This draft changed or was already reviewed.",
          });
        if (input.approve) {
          const context = { ...ctx, db: tx as PrismaClient };
          const home = homeRouter.createCaller(context);
          const localization = localizationRouter.createCaller(context);
          const value = z.object({
            locale: z.string(),
            key: z.string(),
            value: z.string(),
          });
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
      }),
    ),
});
