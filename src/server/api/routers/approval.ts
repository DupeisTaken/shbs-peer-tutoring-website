import { z } from "zod";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
  createTRPCRouter,
  protectedProcedure,
  adminOnlyProcedure,
} from "../trpc";
import { db } from "~/server/db";
import { databaseScope, approvalScope } from "~/server/db-scope";
import { lockEntity } from "~/server/transactions";
import {
  parseProposal,
  fingerprint,
  proposalTargets,
} from "~/server/approvals";
import { humanizeOperation, proposalConfirmation } from "~/lib/approval-policy";

/** Approval is a single atomic transition: revalidation, live change, decision, audit,
 * and notifications either all commit or all roll back. The requester is never impersonated. */
export const approvalRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          state: z
            .enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"])
            .optional(),
          requesterId: z.string().optional(),
          requestId: z.string().optional(),
          page: z.number().int().min(0).default(0),
        })
        .default({ page: 0 }),
    )
    .query(async ({ ctx, input }) => {
      if (!["HEAD", "ADMIN", "COORDINATOR"].includes(ctx.session.role))
        throw new TRPCError({ code: "FORBIDDEN" });
      const canReview =
        ctx.session.role === "HEAD" || ctx.session.role === "ADMIN";
      const where = {
        state: input.state,
        id: input.requestId,
        requesterId: canReview ? input.requesterId : ctx.session.user.id,
      };
      const [rows, total] = await Promise.all([
        ctx.db.approvalRequest.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 25,
          skip: input.page * 25,
        }),
        ctx.db.approvalRequest.count({ where }),
      ]);
      return { rows, total, canReview, viewerId: ctx.session.user.id };
    }),
  decide: adminOnlyProcedure
    .input(
      z.object({
        id: z.string(),
        approve: z.boolean(),
        note: z.string().trim().min(1).max(2000),
        ticket: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.$transaction(
        async (tx) =>
          databaseScope.run(tx, () =>
            approvalScope.run(input.id, async () => {
              await lockEntity(tx, `approval:${input.id}`);
              const currentReviewer = await tx.user.findUnique({
                where: { id: ctx.session.user.id },
                select: { role: true, suspendedAt: true },
              });
              if (
                !currentReviewer ||
                currentReviewer.suspendedAt ||
                !["HEAD", "ADMIN"].includes(currentReviewer.role)
              )
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "Administrator access required.",
                });
              const request = await tx.approvalRequest.findUniqueOrThrow({
                where: { id: input.id },
              });
              if (request.state !== "PENDING")
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "This request has already been decided.",
                });
              if (request.requesterId === ctx.session.user.id)
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message:
                    "A different administrator must review your request.",
                });
              if (input.approve) {
                const requester = await tx.user.findUnique({
                  where: { id: request.requesterId },
                  select: { role: true, suspendedAt: true },
                });
                if (
                  !requester ||
                  requester.suspendedAt ||
                  !["COORDINATOR", "ADMIN", "HEAD"].includes(requester.role)
                )
                  throw new TRPCError({
                    code: "CONFLICT",
                    message:
                      "The requester no longer has active management access. Reject this request.",
                  });
                const value: unknown = superjson.deserialize(
                  request.payload as unknown as Parameters<
                    typeof superjson.deserialize
                  >[0],
                );
                await parseProposal(request.operation, value);
                const targets = await proposalTargets(
                  tx,
                  request.operation,
                  request.payload,
                );
                if (fingerprint(targets) !== request.fingerprint)
                  throw new TRPCError({
                    code: "CONFLICT",
                    message:
                      "The affected records changed. Reject this request and ask for a fresh proposal.",
                  });
                const { createCaller } = await import("../root");
                // The allowlist and original input parser above precede this dynamic dispatch.
                const caller = createCaller({
                  ...ctx,
                  db,
                }) as unknown as Record<
                  string,
                  Record<string, (value: unknown) => Promise<unknown>>
                >;
                const [router, method] = request.operation.split(".");
                // A coordinator's consumed/expired confirmation is evidence of their proposal,
                // not authority for the reviewer. The original handler consumes the fresh ticket.
                const confirmation = proposalConfirmation(
                  request.operation,
                  value,
                );
                if (confirmation && !input.ticket)
                  throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message:
                      "Open the consequence dialog before applying this change.",
                  });
                await caller[router!]![method!]!(
                  confirmation
                    ? { ...(value as object), ticket: input.ticket }
                    : value,
                );
              }
              const reviewer = await tx.user.findUniqueOrThrow({
                where: { id: ctx.session.user.id },
                select: { name: true, username: true },
              });
              const reviewerName =
                reviewer.name ?? reviewer.username ?? ctx.session.user.id;
              const state = input.approve ? "APPROVED" : "REJECTED";
              const result = await tx.approvalRequest.update({
                where: { id: request.id },
                data: {
                  state,
                  reviewerId: ctx.session.user.id,
                  reviewerName,
                  reviewNote: input.note,
                  reviewedAt: new Date(),
                },
              });
              await tx.auditLog.create({
                data: {
                  userId: ctx.session.user.id,
                  userName: reviewerName,
                  action: `${input.approve ? "Approved and applied" : "Rejected"}: ${humanizeOperation(request.operation)}`,
                  entity: "ApprovalRequest",
                  entityId: request.id,
                  approvalId: request.id,
                  operation: request.operation,
                  kind: "DECISION",
                  details: {
                    outcome: state,
                    note: input.note,
                    requesterId: request.requesterId,
                    requesterName: request.requesterName,
                  },
                },
              });
              if (await tx.user.count({ where: { id: request.requesterId } }))
                await tx.notification.create({
                  data: {
                    userId: request.requesterId,
                    title: `Change ${input.approve ? "approved" : "rejected"}`,
                    body: `${reviewerName}: ${input.note}`,
                    link: `/admin/approvals?request=${request.id}`,
                  },
                });
              return result;
            }),
          ),
        { isolationLevel: "Serializable", timeout: 20000 },
      );
      // SMTP happens only after the durable decision commits. A failed send is explicitly retryable.
      let emailSent: boolean | null = null;
      if (input.approve && result.operation === "studentWorkflow.assign") {
        const payload = z
          .object({ id: z.string() })
          .parse(
            superjson.deserialize(
              result.payload as unknown as Parameters<
                typeof superjson.deserialize
              >[0],
            ),
          );
        const survey = await ctx.db.studentSurvey.findUnique({
          where: { id: payload.id },
        });
        if (survey && !survey.confirmedAt) {
          const { resendSurvey } = await import("~/server/student-survey");
          try {
            emailSent = await resendSurvey(ctx.db, survey.email, false);
          } catch {
            emailSent = false;
          }
        }
      }
      return { ...result, emailSent };
    }),
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        await lockEntity(tx, `approval:${input.id}`);
        const request = await tx.approvalRequest.findUniqueOrThrow({
          where: { id: input.id },
        });
        if (request.requesterId !== ctx.session.user.id)
          throw new TRPCError({ code: "FORBIDDEN" });
        if (request.state !== "PENDING")
          throw new TRPCError({
            code: "CONFLICT",
            message: "This request has already been decided.",
          });
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { state: "CANCELLED", reviewedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            userName: request.requesterName,
            action: `Cancelled request: ${humanizeOperation(request.operation)}`,
            entity: "ApprovalRequest",
            entityId: request.id,
            approvalId: request.id,
            operation: request.operation,
            kind: "CANCELLATION",
          },
        });
        return { ok: true };
      }),
    ),
});
