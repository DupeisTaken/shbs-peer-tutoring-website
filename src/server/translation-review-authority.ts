import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import superjson from "superjson";
import { z } from "zod";
import { isSerializationFailure } from "./auth/username-snapshot";
import { approvalScope } from "./db-scope";
import { translationReviewDecisionInput } from "./translation-review-preflight";
import { lockEntity, type TransactionDb } from "./transactions";

type TranslationReviewAuthority = Readonly<{
  actorId: string;
  sessionVersion: number | undefined;
  historyAccessRevision: number | undefined;
}>;

/** Capture trusted request generations before the destination/actor waits. Never
 * substitute a generation sampled from the account after those waits. */
export function captureTranslationReviewAuthority(
  session: Session,
): TranslationReviewAuthority {
  return {
    actorId: session.user.id,
    sessionVersion: session.sessionVersion,
    historyAccessRevision: session.historyAccessRevision,
  };
}

async function queuedRequester(
  tx: TransactionDb,
  input: z.output<typeof translationReviewDecisionInput>,
) {
  const approvalId = approvalScope.getStore();
  if (!approvalId) return undefined;
  // The trusted outer approval transaction retains its approval:<id> lock.
  // Requester identity comes from the stored row, never the replay payload.
  const approval = await tx.approvalRequest.findUnique({
    where: { id: approvalId },
  });
  let matchingSource = false;
  if (
    approval?.state === "PENDING" &&
    approval.operation === "translationReview.decide"
  ) {
    try {
      // This decision's only non-JSON value is its Date. Validate the stored
      // envelope and supported annotation before handing it to SuperJSON.
      const serialized = z
        .object({
          json: z
            .object({
              id: z.string(),
              approve: z.boolean(),
              expectedUpdatedAt: z.union([z.string(), z.number()]),
            })
            .strict(),
          meta: z
            .object({
              values: z
                .object({ expectedUpdatedAt: z.tuple([z.literal("Date")]) })
                .strict()
                .optional(),
              v: z.literal(1).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(approval.payload);
      const decision = translationReviewDecisionInput.safeParse(
        superjson.deserialize<unknown>(serialized),
      );
      matchingSource =
        decision.success &&
        decision.data.id === input.id &&
        decision.data.approve === input.approve &&
        decision.data.expectedUpdatedAt.getTime() ===
          input.expectedUpdatedAt.getTime();
    } catch {
      // Malformed historical approval evidence cannot authorize publication.
    }
  }
  if (!approval || !matchingSource)
    throw new TRPCError({
      code: "CONFLICT",
      message: "The translation approval changed. Reload its current evidence.",
    });
  return approval.requesterId;
}

/** Caller already holds destinations. Fence the actor directly, without the
 * namespace-taking profile helper: acquiring namespace after D would invert
 * keyed translation admission. SHARE also blocks non-key role/credential edits.
 * These transaction locks must outlive publication/rejection or proposal capture. */
export async function lockTranslationReviewAuthority(
  tx: TransactionDb,
  request: TranslationReviewAuthority,
  action: "DECIDE" | "PROPOSE",
  input: z.output<typeof translationReviewDecisionInput>,
) {
  const requesterId =
    action === "DECIDE" ? await queuedRequester(tx, input) : undefined;
  const ids = [
    ...new Set([request.actorId, ...(requesterId ? [requesterId] : [])]),
  ].sort();
  // Take every advisory fence before any User row, consistently sorted for a
  // queued decision involving distinct requester and reviewer accounts.
  for (const id of ids) await lockEntity(tx, `account-profile:${id}`);
  try {
    for (const id of ids)
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR SHARE`;
  } catch (cause) {
    // Queued approval retains its Serializable transaction. Refuse an old
    // snapshot rather than retrying a publication callback automatically.
    if (isSerializationFailure(cause))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Review authority changed. Reload before reviewing this translation again.",
        cause,
      });
    throw cause;
  }
  const actor = await tx.user.findUnique({
    where: { id: request.actorId },
    select: {
      id: true,
      name: true,
      role: true,
      sessionVersion: true,
      historyAccessRevision: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
      suspendedAt: true,
    },
  });
  if (
    !actor ||
    actor.mergedIntoId ||
    actor.recoveryVoidedAt ||
    !Number.isSafeInteger(request.sessionVersion) ||
    request.sessionVersion! < 0 ||
    !Number.isSafeInteger(request.historyAccessRevision) ||
    request.historyAccessRevision! < 0 ||
    actor.sessionVersion !== request.sessionVersion ||
    actor.historyAccessRevision !== request.historyAccessRevision
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "Account access changed. Sign in again before reviewing translations.",
    });
  const roles =
    action === "DECIDE" ? ["HEAD", "ADMIN"] : ["HEAD", "ADMIN", "COORDINATOR"];
  if (actor.suspendedAt || !roles.includes(actor.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your current role cannot review this translation decision.",
    });
  if (requesterId) {
    const requester = await tx.user.findUnique({
      where: { id: requesterId },
      select: {
        role: true,
        suspendedAt: true,
        mergedIntoId: true,
        recoveryVoidedAt: true,
      },
    });
    if (
      !requester ||
      requester.suspendedAt ||
      requester.mergedIntoId ||
      requester.recoveryVoidedAt ||
      !["HEAD", "ADMIN", "COORDINATOR"].includes(requester.role)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The requester no longer has active management access. Reject this request.",
      });
  }
  // Translator assignment is independent: management can review without it.
  return actor;
}
