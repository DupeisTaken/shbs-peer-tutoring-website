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
import { isNotificationEvent } from "~/lib/notification-events";
import { notificationInAppEvent } from "~/lib/notification-details";
import { notificationOwnershipWhere } from "~/server/history-row-ownership";
import { withHistoryReadMutation } from "~/server/history-access-generation";
import { isNotificationCategory, notificationLockFor } from "~/lib/notification-categories";

/**
 * In-app notifications for the signed-in user (any role). Always scoped to
 * `ctx.session.user.id` — a user only ever sees their own notifications.
 */
export const notificationRouter = createTRPCRouter({
  /** An operator may run this once after a governance rollout; retries add no duplicates. */
  reconcileManagementReviews: adminOnlyProcedure.mutation(({ ctx }) =>
    inTransaction(ctx.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ctx.session.user.id} FOR SHARE`;
      const actor = await tx.user.findUnique({
        where: { id: ctx.session.user.id },
      });
      if (
        !actor ||
        actor.suspendedAt ||
        actor.mergedIntoId ||
        !["ADMIN", "HEAD"].includes(actor.role)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Administrator access required.",
        });
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
      where: { AND: [await notificationOwnershipWhere(ctx.db, ctx.session.user.id)], recoveryWithdrawnAt: null },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return rows.map((row) => ({
      ...row,
      context: isNotificationEvent(row.event)
        ? notificationInAppEvent(row.event, row.context).context
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

  unreadCount: protectedProcedure.input(z.object({ includeMuted: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    const settings = input?.includeMuted ? null : await ctx.db.programSettings.findUnique({ where: { id: "program" }, select: { notificationLocks: true } });
    const muted = input?.includeMuted ? [] : await ctx.db.notificationPreference.findMany({
      where: { userId: ctx.session.user.id, badgeEnabled: false }, select: { category: true },
    });
    const mutedCategories = muted.filter((row) => !isNotificationCategory(row.category) || !notificationLockFor(settings?.notificationLocks, row.category).badgeLocked).map((row) => row.category);
    return ctx.db.notification.count({
      where: { AND: [await notificationOwnershipWhere(ctx.db, ctx.session.user.id)], readAt: null, recoveryWithdrawnAt: null,
        ...(mutedCategories.length ? { category: { notIn: mutedCategories } } : {}),
      },
    });
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => withHistoryReadMutation(ctx.db, { userId: ctx.session.user.id, historyAccessRevision: ctx.session.historyAccessRevision ?? 0 }, async (tx) =>
      tx.notification.updateMany({
        where: { id: input.id, AND: [await notificationOwnershipWhere(tx, ctx.session.user.id)], readAt: null, recoveryWithdrawnAt: null },
        data: { readAt: new Date() },
      }),
    )),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => withHistoryReadMutation(ctx.db, { userId: ctx.session.user.id, historyAccessRevision: ctx.session.historyAccessRevision ?? 0 }, async (tx) =>
    tx.notification.updateMany({
      where: { AND: [await notificationOwnershipWhere(tx, ctx.session.user.id)], readAt: null, recoveryWithdrawnAt: null },
      data: { readAt: new Date() },
    }),
  )),
});
