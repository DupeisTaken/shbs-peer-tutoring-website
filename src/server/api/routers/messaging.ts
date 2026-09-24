import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  adminOnlyProcedure,
} from "~/server/api/trpc";
import { inTransaction, lockEntity } from "~/server/transactions";
import { notifyUsers } from "~/server/notifications/create";
import { rateLimit } from "~/server/rate-limit";
import {
  defaultMessageGroups,
  MESSAGE_GROUPS,
  MESSAGE_ROLES,
  MAX_MESSAGE_RECIPIENTS,
} from "~/lib/messaging";
import {
  effectiveMessagePermission,
  eligibleMessageRecipients,
} from "~/server/messaging-permissions";

import { MESSAGING_ADMIN_OPERATIONS } from "~/lib/approval-policy";

/** Explicitly classified supervisor writes execute immediately; future unknown writes fail closed. */
const supervisorProcedure = adminOnlyProcedure.use(({ path, type, next }) => {
  if (type === "mutation" && !MESSAGING_ADMIN_OPERATIONS.has(path))
    throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});
const pageInput = z
  .object({ page: z.number().int().min(0).max(10000).default(0) })
  .default({ page: 0 });
const searchInput = z
  .object({
    search: z.string().trim().max(100).default(""),
    page: z.number().int().min(0).max(10000).default(0),
  })
  .default({ search: "", page: 0 });
const peopleSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
} as const;
const personSearch = (search: string) =>
  search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { username: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};
const reasonInput = z.string().trim().min(5).max(1000);

export const messagingRouter = createTRPCRouter({
  permission: protectedProcedure.query(async ({ ctx }) => {
    const { groups, source, restricted } = await effectiveMessagePermission(
      ctx.db,
      ctx.session.user.id,
    );
    return { groups, source, restricted };
  }),
  recipients: protectedProcedure
    .input(searchInput)
    .query(async ({ ctx, input }) => {
      const allowed = await eligibleMessageRecipients(
        ctx.db,
        ctx.session.user.id,
      );
      const rows = await ctx.db.user.findMany({
        where: { AND: [allowed, personSearch(input.search)] },
        select: peopleSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 51,
        skip: input.page * 50,
      });
      return { people: rows.slice(0, 50), more: rows.length > 50 };
    }),
  inbox: protectedProcedure.input(pageInput).query(async ({ ctx, input }) => {
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
    const ids = [...new Set(rows.flatMap((r) => [r.senderId, r.recipientId]))];
    const [people, eligible] = await Promise.all([
      ctx.db.user.findMany({
        where: { id: { in: ids } },
        select: peopleSelect,
      }),
      eligibleMessageRecipients(ctx.db, ctx.session.user.id),
    ]);
    const replyable = await ctx.db.user.findMany({
      where: { AND: [eligible, { id: { in: ids } }] },
      select: { id: true },
    });
    const canReply = new Set(replyable.map((p) => p.id));
    const names = new Map(people.map((p) => [p.id, p]));
    // Never serialize the batch key or original hidden content into a participant response.
    return rows.map((r) => ({
      id: r.id,
      senderId: r.senderId,
      recipientId: r.recipientId,
      body: r.hiddenAt ? null : r.body,
      hiddenAt: r.hiddenAt,
      supervisable: r.supervisable,
      createdAt: r.createdAt,
      readAt: r.readAt,
      incoming: r.recipientId === ctx.session.user.id,
      sender:
        names.get(r.senderId)?.name ??
        names.get(r.senderId)?.username ??
        "Deleted account",
      senderUsername: names.get(r.senderId)?.username ?? null,
      senderRole: names.get(r.senderId)?.role ?? null,
      recipient:
        names.get(r.recipientId)?.name ??
        names.get(r.recipientId)?.username ??
        "Deleted account",
      canReply: canReply.has(r.senderId),
    }));
  }),
  send: protectedProcedure
    .input(
      z
        .object({
          // The original shape is accepted for retries; fresh sends require the disclosed UI.
          recipientId: z.string().min(1).max(200).optional(),
          recipientIds: z
            .array(z.string().min(1).max(200))
            .min(1)
            .max(MAX_MESSAGE_RECIPIENTS)
            .optional(),
          disclosureVersion: z.literal(1).optional(),
          body: z.string().trim().min(1).max(4000),
          clientKey: z.string().uuid(),
        })
        .refine(
          (v) => Boolean(v.recipientId) !== Boolean(v.recipientIds),
          "Choose recipients.",
        )
        .refine(
          (v) => !v.recipientIds || v.disclosureVersion === 1,
          "Review the supervision notice before sending.",
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const recipients = [
        ...new Set(input.recipientIds ?? [input.recipientId!]),
      ].sort();
      const supervisable = input.disclosureVersion === 1;
      const hash = createHash("sha256")
        .update(JSON.stringify({ recipients, body: input.body, supervisable }))
        .digest("hex");
      if (
        !rateLimit(`dm:${ctx.session.user.id}`, { max: 30, windowMs: 60000 }).ok
      )
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Please wait before sending more messages.",
        });
      return inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, `dm:${ctx.session.user.id}`);
        const old = await tx.messageBatch.findUnique({
          where: {
            senderId_clientKey: {
              senderId: ctx.session.user.id,
              clientKey: input.clientKey,
            },
          },
        });
        if (old) {
          if (old.payloadHash !== hash)
            throw new TRPCError({
              code: "CONFLICT",
              message: "This send was already used for a different message.",
            });
          return { ok: true, count: old.count };
        }
        const legacy = await tx.directMessage.findUnique({
          where: {
            senderId_clientKey: {
              senderId: ctx.session.user.id,
              clientKey: input.clientKey,
            },
          },
        });
        if (legacy) {
          if (
            recipients.length !== 1 ||
            legacy.recipientId !== recipients[0] ||
            legacy.body !== input.body
          )
            throw new TRPCError({ code: "CONFLICT" });
          return { ok: true, count: 1 };
        }
        if (!supervisable)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Refresh Messages and review the supervision notice before sending a new message.",
          });
        // Short shared locks prevent a concurrent role/assignment/policy change from committing
        // between eligibility validation and delivery. No external I/O occurs under these locks.
        await tx.$executeRaw`LOCK TABLE "User", "MessagePermission", "MessageRestriction", "Pairing", "PairingTutee", "Term", "StudentProfileOwnership", "MessageTutorAssignment" IN SHARE MODE`;
        const allowed = await eligibleMessageRecipients(
          tx,
          ctx.session.user.id,
        );
        const people = await tx.user.findMany({
          where: { AND: [allowed, { id: { in: recipients } }] },
          select: peopleSelect,
        });
        if (people.length !== recipients.length)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "One or more contacts are no longer available. Refresh contacts and review your selection. Nothing was sent.",
          });
        const recent = await tx.directMessage.count({
          where: {
            senderId: ctx.session.user.id,
            createdAt: { gte: new Date(Date.now() - 60000) },
          },
        });
        if (recent + recipients.length > 100)
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Please wait before sending more messages.",
          });
        await tx.messageBatch.create({
          data: {
            senderId: ctx.session.user.id,
            clientKey: input.clientKey,
            payloadHash: hash,
            count: recipients.length,
          },
        });
        await tx.directMessage.createMany({
          data: recipients.map((recipientId) => ({
            senderId: ctx.session.user.id,
            recipientId,
            body: input.body,
            clientKey: `${input.clientKey}:${recipientId}`,
            supervisable,
          })),
        });
        // The helper writes independent rows. Canonical links resolve the role when opened,
        // even after a later role change; previews contain no content or other recipients.
        await notifyUsers(
          people.map((p) => p.id),
          { title: "New private message", link: "/messages" },
          tx,
        );
        return { ok: true, count: recipients.length };
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
  settings: supervisorProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.messagePermission.findMany({
      where: { scope: { startsWith: "ROLE:" } },
    });
    return MESSAGE_ROLES.map((role) => ({
      role,
      groups:
        rows.find((r) => r.scope === `ROLE:${role}`)?.groups ??
        defaultMessageGroups(role),
    }));
  }),
  permissionUsers: supervisorProcedure
    .input(searchInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.user.findMany({
        where: personSearch(input.search),
        select: peopleSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 51,
        skip: input.page * 50,
      });
      return { people: rows.slice(0, 50), more: rows.length > 50 };
    }),
  userPermission: supervisorProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const p = await effectiveMessagePermission(ctx.db, input.userId);
      return {
        groups: p.groups,
        source: p.source,
        restricted: p.restricted,
        suspended: Boolean(p.user.suspendedAt),
        role: p.user.role,
      };
    }),
  setPermission: supervisorProcedure
    .input(
      z.object({
        target: z.discriminatedUnion("type", [
          z.object({ type: z.literal("ROLE"), role: z.enum(MESSAGE_ROLES) }),
          z.object({ type: z.literal("USER"), userId: z.string().min(1) }),
        ]),
        groups: z
          .array(z.enum(MESSAGE_GROUPS))
          .max(MESSAGE_GROUPS.length)
          .nullable(),
        reason: reasonInput,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        const scope =
          input.target.type === "ROLE"
            ? `ROLE:${input.target.role}`
            : `USER:${input.target.userId}`;
        await lockEntity(tx, `message-permission:${scope}`);
        if (
          input.target.type === "USER" &&
          !(await tx.user.findUnique({ where: { id: input.target.userId } }))
        )
          throw new TRPCError({ code: "NOT_FOUND" });
        const before = await tx.messagePermission.findUnique({
          where: { scope },
        });
        const groups =
          input.groups === null ? null : [...new Set(input.groups)];
        if (groups === null)
          await tx.messagePermission.deleteMany({ where: { scope } });
        else
          await tx.messagePermission.upsert({
            where: { scope },
            create: { scope, groups },
            update: { groups },
          });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            userName: ctx.session.user.name,
            action: "Changed messaging permissions",
            entity: "MessagePermission",
            entityId: scope,
            operation: "messaging.setPermission",
            details: {
              before: before?.groups ?? null,
              after: groups,
              reason: input.reason,
            },
          },
        });
        return { ok: true };
      }),
    ),
  supervision: supervisorProcedure
    .input(
      z.object({
        search: z.string().trim().max(100).default(""),
        page: z.number().int().min(0).max(10000).default(0),
        visibility: z.enum(["ALL", "VISIBLE", "HIDDEN"]).default("ALL"),
        participantId: z.string().optional(),
        conversation: z
          .object({ first: z.string().max(200), second: z.string().max(200) })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const people = input.search
        ? await ctx.db.user.findMany({
            where: personSearch(input.search),
            select: { id: true },
          })
        : [];
      const rows = await ctx.db.directMessage.findMany({
        where: {
          supervisable: true,
          ...(input.visibility === "ALL"
            ? {}
            : {
                hiddenAt: input.visibility === "HIDDEN" ? { not: null } : null,
              }),
          AND: [
            ...(input.search
              ? [
                  {
                    OR: [
                      {
                        body: {
                          contains: input.search,
                          mode: "insensitive" as const,
                        },
                      },
                      { senderId: { in: people.map((p) => p.id) } },
                      { recipientId: { in: people.map((p) => p.id) } },
                    ],
                  },
                ]
              : []),
            ...(input.participantId
              ? [
                  {
                    OR: [
                      { senderId: input.participantId },
                      { recipientId: input.participantId },
                    ],
                  },
                ]
              : []),
            ...(input.conversation
              ? [
                  {
                    OR: [
                      {
                        senderId: input.conversation.first,
                        recipientId: input.conversation.second,
                      },
                      {
                        senderId: input.conversation.second,
                        recipientId: input.conversation.first,
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
        select: {
          id: true,
          senderId: true,
          recipientId: true,
          createdAt: true,
          hiddenAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 31,
        skip: input.page * 30,
      });
      const names = await ctx.db.user.findMany({
        where: {
          id: {
            in: [...new Set(rows.flatMap((r) => [r.senderId, r.recipientId]))],
          },
        },
        select: peopleSelect,
      });
      return {
        more: rows.length > 30,
        rows: rows
          .slice(0, 30)
          .map((r) => ({
            ...r,
            sender: names.find((n) => n.id === r.senderId),
            recipient: names.find((n) => n.id === r.recipientId),
          })),
      };
    }),
  // Opening content is an explicit audited review. It never updates participant readAt.
  review: supervisorProcedure
    .input(z.object({ id: z.string(), reason: reasonInput }))
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        const message = await tx.directMessage.findFirst({
          where: { id: input.id, supervisable: true },
          select: {
            id: true,
            body: true,
            hiddenAt: true,
            senderId: true,
            recipientId: true,
          },
        });
        if (!message) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.messageModeration.create({
          data: {
            actorId: ctx.session.user.id,
            messageId: message.id,
            action: "REVIEW",
            reason: input.reason,
          },
        });
        const history = await tx.messageModeration.findMany({
          where: { messageId: message.id },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        const actors = await tx.user.findMany({
          where: {
            id: { in: [...new Set(history.map((event) => event.actorId))] },
          },
          select: peopleSelect,
        });
        return {
          ...message,
          history: history.map((event) => ({
            ...event,
            actorName:
              actors.find((actor) => actor.id === event.actorId)?.name ??
              actors.find((actor) => actor.id === event.actorId)?.username ??
              event.actorId,
          })),
        };
      }),
    ),
  moderate: supervisorProcedure
    .input(z.object({ id: z.string(), hide: z.boolean(), reason: reasonInput }))
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, `message-moderation:${input.id}`);
        const message = await tx.directMessage.findFirst({
          where: { id: input.id, supervisable: true },
        });
        if (!message) throw new TRPCError({ code: "NOT_FOUND" });
        if (Boolean(message.hiddenAt) === input.hide) return { ok: true };
        await tx.directMessage.update({
          where: { id: message.id },
          data: { hiddenAt: input.hide ? new Date() : null },
        });
        const action = input.hide ? "HIDE" : "RESTORE";
        await tx.messageModeration.create({
          data: {
            actorId: ctx.session.user.id,
            messageId: message.id,
            action,
            reason: input.reason,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            userName: ctx.session.user.name,
            action,
            entity: "DirectMessage",
            entityId: message.id,
            operation: "messaging.moderate",
            details: { reason: input.reason, hidden: input.hide },
          },
        });
        return { ok: true };
      }),
    ),
  restrict: supervisorProcedure
    .input(
      z.object({
        userId: z.string(),
        restricted: z.boolean(),
        reason: reasonInput,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, `message-restriction:${input.userId}`);
        if (!(await tx.user.findUnique({ where: { id: input.userId } })))
          throw new TRPCError({ code: "NOT_FOUND" });
        const old = await tx.messageRestriction.findUnique({
          where: { userId: input.userId },
        });
        if ((old?.restricted ?? false) === input.restricted)
          return { ok: true };
        await tx.messageRestriction.upsert({
          where: { userId: input.userId },
          create: { userId: input.userId, restricted: input.restricted },
          update: { restricted: input.restricted },
        });
        const action = input.restricted ? "RESTRICT" : "UNRESTRICT";
        await tx.messageModeration.create({
          data: {
            actorId: ctx.session.user.id,
            targetUserId: input.userId,
            action,
            reason: input.reason,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            userName: ctx.session.user.name,
            action,
            entity: "MessageRestriction",
            entityId: input.userId,
            operation: "messaging.restrict",
            details: { reason: input.reason, restricted: input.restricted },
          },
        });
        return { ok: true };
      }),
    ),
});
