import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lockEntity, type TransactionDb } from "./transactions";
import {
  assertTranslationCurrent,
  requireTranslationLocale,
} from "./translation-destination";
import { validateInterfaceMessage } from "./i18n/interface-message-validation";

export const translationReviewDecisionInput = z.object({
  id: z.string(),
  approve: z.boolean(),
  expectedUpdatedAt: z.coerce.date(),
});

/** Raw request admission uses the resolver's unchanged schema before any queue write. */
export function parseTranslationReviewDecision(value: unknown) {
  const parsed = translationReviewDecisionInput.safeParse(value);
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Please check the translation draft decision.",
      cause: parsed.error,
    });
  return parsed.data;
}

/** The caller holds translation:destinations until its decision/proposal commits.
 * Keep the same destination -> draft lock order for queue admission and replay. */
export async function lockTranslationReviewDecision(
  tx: TransactionDb,
  input: z.output<typeof translationReviewDecisionInput>,
) {
  await lockEntity(tx, `translation:${input.id}`);
  const draft = await tx.translationDraft.findUniqueOrThrow({
    where: { id: input.id },
  });
  if (
    draft.state !== "PENDING" ||
    draft.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "This draft changed or was already reviewed.",
    });
  if (input.approve) {
    await assertTranslationCurrent(tx, draft.operation, draft.payload);
    if (draft.operation === "localization.setString") {
      const payload = z
        .object({ locale: z.string(), key: z.string(), value: z.string() })
        .safeParse(draft.payload);
      if (!payload.success)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This stored translation is invalid. Reject it and submit a corrected draft.",
          cause: payload.error,
        });
      const locale = await requireTranslationLocale(tx, payload.data.locale);
      validateInterfaceMessage(locale, payload.data.key, payload.data.value);
    }
  }
  // Rejecting unsafe/legacy evidence must stay available without adopting a new
  // version or pretending that its publication payload passed validation.
  return draft;
}
