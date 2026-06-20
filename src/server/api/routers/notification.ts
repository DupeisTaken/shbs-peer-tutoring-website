import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * In-app notifications for the signed-in user (any role). Always scoped to
 * `ctx.session.user.id` — a user only ever sees their own notifications.
 */
export const notificationRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.notification.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ),

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
