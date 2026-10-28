import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  inspectRecords,
  listRecordTables,
  RecordInspectorError,
} from "~/server/recovery/record-inspector";

/** HTTP callers supply only an exact key; operator authority is never transport input. */
async function inspectorRead<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RecordInspectorError)
      throw new TRPCError({ code: error.code, message: error.message });
    throw error;
  }
}
export const recordInspectorRouter = createTRPCRouter({
  tables: protectedProcedure.query(({ ctx }) =>
    inspectorRead(() =>
      listRecordTables(ctx.db, { userId: ctx.session.user.id }),
    ),
  ),
  records: protectedProcedure
    .input(
      z
        .object({
          table: z.string().min(1).max(100),
          key: z
            .record(
              z.string().max(100),
              z.union([z.string().max(1024), z.number().finite(), z.boolean()]),
            )
            .optional(),
          cursor: z.string().max(8192).optional(),
          limit: z.number().int().min(1).max(50).default(25),
        })
        .strict(),
    )
    .query(({ ctx, input }) =>
      inspectorRead(() =>
        inspectRecords(ctx.db, { userId: ctx.session.user.id }, input),
      ),
    ),
});
