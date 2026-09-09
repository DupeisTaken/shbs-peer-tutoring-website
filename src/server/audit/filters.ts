import { z } from "zod";
import type { Prisma } from "../../../generated/prisma";

export const auditFilters = z
  .object({
    cursor: z.string().optional(),
    userId: z.string().optional(),
    kind: z
      .enum(["ACTION", "DECISION", "SUBMISSION", "CANCELLATION"])
      .optional(),
    operation: z.string().max(150).optional(),
    entity: z.string().max(100).optional(),
    search: z.string().trim().max(200).optional(),
    approvalId: z.string().optional(),
    from: z.coerce.date().optional(),
    until: z.coerce.date().optional(),
  })
  .refine((v) => !v.from || !v.until || v.from < v.until, {
    message: "The end date must follow the start date.",
  });

/** Compose every filter with AND, before paging. Dates use a half-open UTC interval. */
export function auditWhere(
  input?: z.infer<typeof auditFilters>,
): Prisma.AuditLogWhereInput {
  return {
    userId: input?.userId === "__system__" ? null : input?.userId,
    kind: input?.kind,
    operation: input?.operation,
    entity: input?.entity,
    approvalId: input?.approvalId,
    ...(input?.search
      ? { action: { contains: input.search, mode: "insensitive" } }
      : {}),
    ...(input?.from || input?.until
      ? { createdAt: { gte: input.from, lt: input.until } }
      : {}),
  };
}
