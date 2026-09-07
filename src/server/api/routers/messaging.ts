import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { inTransaction, lockEntity } from "~/server/transactions";
import { notifyUsers } from "~/server/notifications/create";
import { rateLimit } from "~/server/rate-limit";

const staff = (role: string) => ["HEAD", "ADMIN", "COORDINATOR"].includes(role);
/** Private conversations are between management and a participant (or another manager).
 * A student's address book never exposes other students, and only participants can read a DM. */
export const messagingRouter = createTRPCRouter({
  recipients: protectedProcedure
    .input(
      z
        .object({ search: z.string().max(100).default("") })
        .default({ search: "" }),
    )
    .query(({ ctx, input }) =>
      ctx.db.user.findMany({
        where: {
          id: { not: ctx.session.user.id },
          suspendedAt: null,
          ...(staff(ctx.session.role)
            ? {}
            : { role: { in: ["HEAD", "ADMIN", "COORDINATOR"] } }),
          ...(input.search
            ? { name: { contains: input.search, mode: "insensitive" } }
            : {}),
        },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
        take: 50,
      }),
    ),
  inbox: protectedProcedure
    .input(
      z
        .object({ page: z.number().int().min(0).default(0) })
        .default({ page: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.directMessage.findMany({
        where: {
          OR: [
            { senderId: ctx.session.user.id },
            { recipientId: ctx.session.user.id },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 30,
        skip: input.page * 30,
      });
      const ids = [
        ...new Set(rows.flatMap((r) => [r.senderId, r.recipientId])),
      ];
      const people = await ctx.db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      return rows.map((r) => ({
        ...r,
        incoming: r.recipientId === ctx.session.user.id,
        sender:
          people.find((p) => p.id === r.senderId)?.name ?? "Deleted account",
        recipient:
          people.find((p) => p.id === r.recipientId)?.name ?? "Deleted account",
      }));
    }),
  send: protectedProcedure
    .input(
      z.object({
        recipientId: z.string(),
        body: z.string().trim().min(1).max(4000),
        clientKey: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !rateLimit(`dm:${ctx.session.user.id}`, { max: 30, windowMs: 60000 }).ok
      )
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Please wait before sending more messages.",
        });
      return inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, `dm:${ctx.session.user.id}:${input.clientKey}`);
        const old = await tx.directMessage.findUnique({
          where: {
            senderId_clientKey: {
              senderId: ctx.session.user.id,
              clientKey: input.clientKey,
            },
          },
        });
        if (old) {
          if (old.body !== input.body || old.recipientId !== input.recipientId)
            throw new TRPCError({ code: "CONFLICT" });
          return { ok: true };
        }
        const recipient = await tx.user.findUnique({
          where: { id: input.recipientId },
        });
        if (
          !recipient ||
          recipient.suspendedAt ||
          recipient.id === ctx.session.user.id ||
          (!staff(ctx.session.role) && !staff(recipient.role))
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Choose an available management contact.",
          });
        await tx.directMessage.create({
          data: { senderId: ctx.session.user.id, ...input },
        });
        // Keep private message contents out of notification previews.
        await notifyUsers(
          [recipient.id],
          { title: "New private message", link: "/messages" },
          tx,
        );
        return { ok: true };
      });
    }),
  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.directMessage.updateMany({
        where: { id: input.id, recipientId: ctx.session.user.id, readAt: null },
        data: { readAt: new Date() },
      });
      return { ok: true };
    }),
});
