import { z } from "zod";
import type { DomainDb } from "~/server/transactions";
import { participantIdentity } from "./adapters/shared";
import { recoveryHash } from "./capture";

const reference = z.string().min(1).max(200);
const references = z.array(reference).max(1000);
const labels = z.array(z.string().max(5000)).max(1000);
const deliveryEffects = z
  .array(
    z
      .object({
        id: reference,
        eventId: reference,
        deliveryId: reference.nullable(),
        notificationId: reference.nullable(),
        disposition: z.enum([
          "PENDING",
          "LEASED",
          "PRIOR_ATTEMPT_UNKNOWN",
          "IN_FLIGHT_OR_UNKNOWN",
          "SENT",
          "STOPPED",
          "IN_APP_VISIBLE",
          "OBSERVED_NOTICE",
          "UNKNOWN",
        ]),
        cancellation: z.string().max(200).nullable(),
      })
      .strict(),
  )
  .max(1000);
const admissionEffects = z
  .object({
    registrationCodeCount: z.number().int().min(0).max(200),
    tutorId: reference.nullable(),
    accountIds: references,
    pairingIds: references,
    tuteeIds: references,
    verificationClockIds: references.optional(),
    messageLinkIds: references.optional(),
  })
  .strict();
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const ownerDraft = z
  .object({
    outcome: z.literal("AWAITING_OWNER_ACTION"),
    draftId: reference,
    ownerUserId: reference,
    version: z.number().int().positive(),
    destination: z.string().max(1000),
    requiredAction: z.literal(
      "Review and submit a new request with current policy agreement and fresh mailbox verification.",
    ),
  })
  .strict()
  .refine(
    (draft) =>
      draft.destination ===
      `/signup?recoveryDraft=${encodeURIComponent(draft.draftId)}`,
  );
const refreshOutcome = z
  .object({
    outcome: z.literal("AWAITING_OWNER_ACTION"),
    sourceTermId: reference,
    destinationTermId: reference.nullable(),
    drafts: z.array(ownerDraft).min(1).max(1000),
  })
  .strict();

async function resultProjection(
  db: DomainDb,
  checkpoint: {
    adapter: string;
    adapterVersion: number;
    schemaVersion: number;
  } | null,
  evidence: Record<string, unknown>,
  actionId: string,
  actorId?: string,
) {
  if (
    evidence.version !== 1 ||
    checkpoint?.schemaVersion !== 1 ||
    checkpoint.adapterVersion !== 1 ||
    !["STUDENT_WORKFLOW", "PROGRAM_REFRESH"].includes(checkpoint.adapter)
  )
    return null;
  const raw = evidence.result;
  const workflow = ownerDraft.safeParse(raw);
  const refresh = refreshOutcome.safeParse(raw);
  const captured =
    checkpoint.adapter === "STUDENT_WORKFLOW" && workflow.success
      ? [workflow.data]
      : checkpoint.adapter === "PROGRAM_REFRESH" && refresh.success
        ? refresh.data.drafts
        : null;
  if (!captured) return null;
  const rows = await db.recoveryWorkflowDraft.findMany({
    where: { actionId, id: { in: captured.map((draft) => draft.draftId) } },
    select: {
      id: true,
      actionId: true,
      ownerUserId: true,
      version: true,
      state: true,
      sourceTuteeId: true,
      ownerBindingHash: true,
    },
    take: 1000,
  });
  const drafts = [];
  for (const draft of captured) {
    const current = rows.find(
      (row) =>
        row.id === draft.draftId && row.ownerUserId === draft.ownerUserId,
    );
    let destination: string | null = null;
    if (
      actorId === draft.ownerUserId &&
      current?.state === "PENDING_OWNER_REVIEW" &&
      current.version === draft.version
    ) {
      try {
        const identity = await participantIdentity(
          db,
          "TUTEE",
          current.sourceTuteeId,
        );
        const owner = identity.owners.find((user) => user.id === actorId);
        if (
          identity.ownerIds.length === 1 &&
          identity.ownerIds[0] === actorId &&
          owner &&
          !owner.suspendedAt &&
          !owner.mergedIntoId &&
          !owner.recoveryVoidedAt &&
          recoveryHash(identity.binding) === current.ownerBindingHash
        )
          destination = draft.destination;
      } catch {
        /* A stale/unreadable ownership check never produces an owner link. */
      }
    }
    drafts.push({
      draftId: draft.draftId,
      ownerUserId: draft.ownerUserId,
      version: draft.version,
      state:
        current && ["PENDING_OWNER_REVIEW", "CONSUMED"].includes(current.state)
          ? current.state
          : null,
      destination,
    });
  }
  return { outcome: "AWAITING_OWNER_ACTION" as const, drafts };
}

/** Shared website/operator projection. Callers must establish current authority
 * first. This reader never returns raw before-state, credentials, arbitrary JSON
 * adapter results or a client retry key. Unknown receipt formats stay unknown. */
export async function readRecoveryReceipt(
  db: DomainDb,
  id: string,
  actorId?: string,
) {
  const receipt = await db.recoveryReceipt.findUniqueOrThrow({
    where: { id: reference.parse(id) },
    select: {
      id: true,
      actionId: true,
      actorId: true,
      reason: true,
      channel: true,
      createdAt: true,
      fingerprint: true,
      evidence: true,
    },
  });
  const checkpoint = await db.recoveryCheckpoint.findUnique({
    where: { actionId: receipt.actionId },
    select: {
      id: true,
      adapter: true,
      adapterVersion: true,
      schemaVersion: true,
      sourceEntity: true,
      sourceId: true,
    },
  });
  const evidence = object(receipt.evidence);
  const plan = object(evidence.plan);
  const checkpointEffects = labels.safeParse(evidence.effects);
  const checkpointPreserved = labels.safeParse(evidence.preserved);
  const causalEffects = admissionEffects.safeParse(plan.effects);
  const warnings = labels.safeParse(plan.warnings);
  const deliverySnapshot = object(evidence.deliveries);
  const delivery = deliveryEffects.safeParse(deliverySnapshot.effects);
  const supported = evidence.version === 1;
  const result = await resultProjection(
    db,
    checkpoint,
    evidence,
    receipt.actionId,
    actorId,
  );
  return {
    version: 1 as const,
    id: receipt.id,
    actionId: receipt.actionId,
    actorId: receipt.actorId,
    reason: receipt.reason,
    channel: receipt.channel,
    createdAt: receipt.createdAt,
    fingerprint: receipt.fingerprint,
    evidenceVersion: evidence.version === 1 ? 1 : null,
    checkpoint,
    result,
    authorityScope: {
      restorationRoles:
        checkpoint?.adapter === "PROGRAM_REFRESH"
          ? ["HEAD"]
          : ["ADMIN", "HEAD"],
      credentialRestoration: false as const,
    },
    effects: !supported
      ? null
      : checkpoint && checkpointEffects.success
        ? checkpointEffects.data
        : causalEffects.success
          ? causalEffects.data
          : null,
    preserved: !supported
      ? null
      : checkpoint && checkpointPreserved.success
        ? checkpointPreserved.data
        : warnings.success
          ? warnings.data
          : null,
    deliveries:
      supported && deliverySnapshot.version === 1 && delivery.success
        ? { version: 1 as const, effects: delivery.data }
        : null,
  };
}
