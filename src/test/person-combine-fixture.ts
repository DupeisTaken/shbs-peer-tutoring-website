import { randomUUID } from "node:crypto";
import { previewPersonCombine } from "~/server/person-combine";
import type { DomainDb } from "~/server/transactions";

/** Tests exercise the same explicit reviewed intent as the current UI. Old
 * account-combine fingerprints deliberately cannot authorize this operation. */
export async function reviewedLoginRetirement(
  db: DomainDb,
  pair: { survivorId: string; duplicateId: string },
  confirmPassword: string,
) {
  const selection = {
    sources: [pair.survivorId, pair.duplicateId].map((id) => ({ kind: "USER" as const, id })),
    retainedUserId: pair.survivorId,
    retireDuplicateLogins: true,
  };
  const preview = await previewPersonCombine(db, selection);
  return {
    ...selection,
    fingerprint: preview.fingerprint,
    reason: "Staff reviewed original records and confirmed safe login retirement",
    acknowledged: true as const,
    operationId: randomUUID(),
    confirmPassword,
  };
}
