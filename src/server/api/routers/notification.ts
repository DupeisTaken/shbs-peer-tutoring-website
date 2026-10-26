import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { inTransaction } from "~/server/transactions";
import { reconcileManagementReviewNotifications } from "~/server/notifications/create";

import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  adminOnlyProcedure,
} from "~/server/api/trpc";
import {
  requestNoticeSource,
  requestNoticeStatus,
  retryRequestNotice,
} from "~/server/email/request-notice";
import {
  declineRequestAppealInput,
  declineRequestAppeal,
} from "~/server/email/request-appeal";
import { notificationDestination } from "~/server/email/urls";
import {
  isNotificationEvent,
  notificationEvent,
} from "~/lib/notification-events";

/**
 * In-app notifications for the signed-in user (any role). Always scoped to
 * `ctx.session.user.id` — a user only ever sees their own notifications.
 */
export const notificationRouter = createTRPCRouter({
  /** An operator may run this once after a governance rollout; retries add no duplicates. */
  reconcileManagementReviews: adminOnlyProcedure.mutation(({ ctx }) =>
    inTransaction(ctx.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ctx.session.user.id} FOR SHARE`;
      const actor = await tx.user.findUnique({ where: { id: ctx.session.user.id } });
      if (!actor || actor.suspendedAt || actor.mergedIntoId || !["ADMIN", "HEAD"].includes(actor.role))
        throw new TRPCError({ code: "FORBIDDEN", message: "Administrator access required." });
      return reconcileManagementReviewNotifications(tx);
    }),
  ),
  requestEmailStatus: adminProcedure
    .input(requestNoticeSource)
    .query(({ ctx, input }) => requestNoticeStatus(ctx.db, input)),
  retryRequestEmail: adminOnlyProcedure
    .input(requestNoticeSource)
    .mutation(({ ctx, input }) =>
      retryRequestNotice(ctx.db, input, ctx.session.user),
    ),
  declineRequestAppeal: adminOnlyProcedure
    .input(declineRequestAppealInput)
    .mutation(({ ctx, input }) =>
      declineRequestAppeal(ctx.db, input, ctx.session.user),
    ),
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.notification.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return rows.map((row) => ({
      ...row,
      context: isNotificationEvent(row.event)
        ? notificationEvent(row.event, row.context).context
        : null,
      link: row.link
        ? notificationDestination(
            row.event === "message_received" || row.link === "/messages"
              ? "messages"
              : "info",
            row.event ?? "program_update",
            row.link,
            ctx.session.role,
          )
        : null,
    }));
  }),

  unreadCount: protectedProcedure.query(({ ctx }) =>
    ctx.db.notification.count({
      where: { userId: ctx.session.user.id, readAt: null },
    }),
  ),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.notification.updateMany({
        where: { id: input.id, userId: ctx.session.user.id, readAt: null },
        data: { readAt: new Date() },
      }),
    ),

  markAllRead: protectedProcedure.mutation(({ ctx }) =>
    ctx.db.notification.updateMany({
      where: { userId: ctx.session.user.id, readAt: null },
      data: { readAt: new Date() },
    }),
  ),
});
