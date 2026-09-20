import { z } from "zod";
import superjson from "superjson";
import { adminProcedure, createTRPCRouter } from "../trpc";
import { assignmentOperations } from "~/lib/assignment-qualification";
import { prepareAssignmentOverride } from "~/server/assignment-qualification";
import { parseProposal } from "~/server/approvals";
import { inTransaction } from "~/server/transactions";

export const assignmentRouter = createTRPCRouter({
  // Preparing/cancelling evidence cannot assign anyone and is safe for coordinators directly.
  prepare: adminProcedure.input(z.object({ operation: z.enum(assignmentOperations), payload: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const parsed = await parseProposal(input.operation, input.payload);
      const value: unknown = superjson.deserialize(parsed as unknown as Parameters<typeof superjson.deserialize>[0]);
      return inTransaction(ctx.db, (tx) => prepareAssignmentOverride(tx, ctx.session.user.id, input.operation, value));
    }),
  cancel: adminProcedure.input(z.object({ ticket: z.string() }))
    .mutation(({ ctx, input }) => ctx.db.studentActionConfirmation.deleteMany({ where: {
      id: input.ticket, userId: ctx.session.user.id, action: "ASSIGNMENT_OVERRIDE", usedAt: null,
    } })),
});
