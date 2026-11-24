import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lockAccountProfile } from "./account-profile-lock";
import { lockUsernameNamespace } from "./auth/username-namespace";
import { lockEntity, type TransactionDb } from "./transactions";

export const accountAppealDecisionInput = z.object({
  appealId: z.string().min(1),
  action: z.enum(["APPROVE", "DENY"]),
  expectedAuthorityRevision: z.number().int().nonnegative().optional(),
});

/** Old clients need a new explicit review, never an implicit latest version.
 * Validate raw queue input before it can reach Prisma or durable proposal audit. */
export function parseAccountAppealDecisionReview(value: unknown) {
  const parsed = accountAppealDecisionInput.safeParse(value);
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Please check the account appeal decision.",
      cause: parsed.error,
    });
  if (parsed.data.expectedAuthorityRevision === undefined)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Reload the current account restriction review before deciding this appeal.",
    });
  return {
    ...parsed.data,
    expectedAuthorityRevision: parsed.data.expectedAuthorityRevision,
  };
}

/** Both proposal admission and application retain these fences until commit.
 * Actor eligibility belongs to their existing queue/direct authority checks. */
export async function lockAccountAppealDecisionReview(
  tx: TransactionDb,
  input: ReturnType<typeof parseAccountAppealDecisionReview>,
) {
  await lockUsernameNamespace(tx);
  await lockEntity(tx, "program:leadership");
  const target = await tx.accountAppeal.findUniqueOrThrow({
    where: { id: input.appealId },
    select: { userId: true },
  });
  await lockAccountProfile(tx, target.userId);
  await tx.$queryRaw`SELECT id FROM "AccountAppeal" WHERE id = ${input.appealId} FOR UPDATE`;
  const appeal = await tx.accountAppeal.findUniqueOrThrow({
    where: { id: input.appealId },
    select: { id: true, state: true, userId: true, createdAt: true },
  });
  if (appeal.state !== "PENDING")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This appeal is already decided.",
    });
  const account = await tx.user.findUniqueOrThrow({
    where: { id: appeal.userId },
    select: { suspendedAt: true, refreshAuthorityRevision: true },
  });
  // The existing epoch rejects newer restrictions and role/suspension A→B→A.
  if (account.refreshAuthorityRevision !== input.expectedAuthorityRevision)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The account restriction changed. Reload and review the current restriction before deciding this appeal.",
    });
  if (input.action === "DENY" && !account.suspendedAt)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This account is already active. Reload and approve the pending appeal to close it without changing account access.",
    });
  return { appeal, account };
}
