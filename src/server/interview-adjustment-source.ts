import { TRPCError } from "@trpc/server";
import type { DomainDb, TransactionDb } from "~/server/transactions";
import { lockUsernameNamespace } from "~/server/auth/username-namespace";
import { isSerializationFailure } from "~/server/auth/username-snapshot";
import { lockApplicationReview } from "~/server/request-review";
import {
  INTERVIEW_HOURS_REASON,
  interviewHoursId,
} from "~/server/interview-hours";

export const INTERVIEW_ADJUSTMENT_SOURCE_CONFLICT_MESSAGE =
  "Recorded interview service cannot be deleted as an independent adjustment. Review the interview's completion and attendance.";
export const INTERVIEW_ADJUSTMENT_AMBIGUITY_MESSAGE =
  "This adjustment has conflicting interview source claims. Review the recorded evidence before changing it.";

export type AdjustmentSourceRow = {
  id: string;
  tutorId: string;
  type: string;
  reason: string | null;
};
export type InterviewAdjustmentSource = {
  kind:
    | "INDEPENDENT"
    | "LIVE_INTERVIEW"
    | "ORPHANED_INTERVIEW"
    | "UNRESOLVED_INTERVIEW"
    | "CONFLICTING_INTERVIEW";
  applicationId: string | null;
  applicationIds: string[];
  canDelete: boolean;
  correctionApplicationId: string | null;
};
type TypedClaim = {
  adjustmentId: string;
  applicationId: string | null;
  recordedTutorId: string | null;
  canonicalShape: boolean;
};
type LegacyClaim = {
  adjustmentId: string;
  applicationId: string;
  recordedTutorId: string;
};
const independent = (): InterviewAdjustmentSource => ({
  kind: "INDEPENDENT",
  applicationId: null,
  applicationIds: [],
  canDelete: true,
  correctionApplicationId: null,
});

/** Remove a known owner's exact suffix, never split IDs on underscores. This is
 * only a candidate; a prefix or mutable row shape alone cannot prove ownership. */
function candidateApplication(row: AdjustmentSourceRow) {
  const prefix = "interview_";
  const suffix = `_${row.tutorId}`;
  if (!row.tutorId || !row.id.startsWith(prefix) || !row.id.endsWith(suffix))
    return null;
  const id = row.id.slice(prefix.length, -suffix.length);
  return id && interviewHoursId(id, row.tutorId) === row.id ? id : null;
}

/** Bounded bulk inspection for the all-history adjustment list. Only positive
 * source fields leave SQL; no private audit JSON or per-credit query fan-out.
 * Classification has no locks/writes and never repairs an incomplete ledger. */
export async function inspectInterviewAdjustmentSources(
  db: DomainDb,
  adjustments: readonly AdjustmentSourceRow[],
): Promise<Map<string, InterviewAdjustmentSource>> {
  const result = new Map(adjustments.map((row) => [row.id, independent()]));
  // A canonical recorded source always has this structural prefix. Ordinary
  // generated adjustment IDs need no provenance query at all.
  const candidates = [
    ...new Map(
      adjustments
        .filter((row) => row.id.startsWith("interview_"))
        .map((row) => [row.id, row]),
    ).values(),
  ];
  for (let start = 0; start < candidates.length; start += 100) {
    const rows = candidates.slice(start, start + 100);
    const ids = rows.map((row) => row.id);
    const typed = await db.$queryRaw<TypedClaim[]>`
      WITH claims AS (
        SELECT c.value->>'id' AS "adjustmentId", a."entityId" AS "applicationId",
          c.value->>'tutorId' AS "recordedTutorId",
          COALESCE(bool_or(c.value->>'type' = 'EXTRA'
            AND c.value->>'reason' = ${INTERVIEW_HOURS_REASON}), false) AS "canonicalShape"
        FROM "AuditLog" a
        CROSS JOIN LATERAL jsonb_array_elements(CASE
          WHEN a.operation = 'interviewService.record' THEN CASE
            WHEN jsonb_typeof(a.details#>'{effects,credits}') = 'array'
            THEN a.details#>'{effects,credits}' ELSE '[]'::jsonb END
          ELSE CASE WHEN jsonb_typeof(a.details#>'{effects,retainedService,credits}') = 'array'
            THEN a.details#>'{effects,retainedService,credits}' ELSE '[]'::jsonb END
          END) c(value)
        WHERE a.entity = 'TutorApplication' AND (
          (a.operation = 'interviewService.record'
            AND a.details#>'{effects,interviewServiceVersion}' = '1'::jsonb)
          OR (a.operation = 'admin.assignInterviewers'
            AND a.details#>'{effects,panelRepairVersion}' = '1'::jsonb))
          AND c.value->>'id' = ANY(${ids}::text[])
        GROUP BY c.value->>'id', a."entityId", c.value->>'tutorId'
      ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY "adjustmentId"
          ORDER BY "applicationId" NULLS FIRST, "recordedTutorId" NULLS FIRST) AS claim_rank
        FROM claims
      ) SELECT "adjustmentId", "applicationId", "recordedTutorId", "canonicalShape"
        FROM ranked WHERE claim_rank <= 3
    `;
    // Legacy assignment evidence survives sibling credit damage and establishes
    // the recorded owner independently of a corrupted current adjustment owner.
    const legacy = await db.$queryRaw<LegacyClaim[]>`
      WITH claims AS (
        SELECT DISTINCT ('interview_' || a.id || '_' || p."tutorId") AS "adjustmentId",
          a.id AS "applicationId", p."tutorId" AS "recordedTutorId"
        FROM "TutorApplication" a
        JOIN "InterviewAssignment" p ON p."applicationId" = a.id
        WHERE a."interviewCompletedAt" IS NOT NULL AND p.attended
          AND ('interview_' || a.id || '_' || p."tutorId") = ANY(${ids}::text[])
      ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY "adjustmentId"
          ORDER BY "applicationId", "recordedTutorId") AS claim_rank FROM claims
      ) SELECT "adjustmentId", "applicationId", "recordedTutorId"
        FROM ranked WHERE claim_rank <= 3
    `;
    const applicationIds = [
      ...new Set(
        [
          ...rows.map(candidateApplication),
          ...typed.map((claim) => claim.applicationId),
          ...legacy.map((claim) => claim.applicationId),
        ].filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    const applications = applicationIds.length
      ? await db.tutorApplication.findMany({
          where: { id: { in: applicationIds } },
          select: {
            id: true,
            interviewCompletedAt: true,
            invalidatedAt: true,
            status: true,
          },
        })
      : [];
    const appById = new Map(applications.map((app) => [app.id, app]));
    for (const row of rows) {
      const rowTyped = typed.filter((claim) => claim.adjustmentId === row.id);
      const rowLegacy = legacy.filter((claim) => claim.adjustmentId === row.id);
      const identities = new Set<string>();
      const proven = new Map<string, string>();
      let unresolved = false;
      for (const claim of rowTyped) {
        const appId = claim.applicationId;
        const owner = claim.recordedTutorId;
        identities.add(JSON.stringify([appId, owner]));
        if (
          appId &&
          owner &&
          interviewHoursId(appId, owner) === row.id &&
          claim.canonicalShape
        )
          proven.set(appId, owner);
        else unresolved = true;
      }
      for (const claim of rowLegacy) {
        identities.add(
          JSON.stringify([claim.applicationId, claim.recordedTutorId]),
        );
        if (
          interviewHoursId(claim.applicationId, claim.recordedTutorId) ===
          row.id
        )
          proven.set(claim.applicationId, claim.recordedTutorId);
        else unresolved = true;
      }
      const candidate = candidateApplication(row);
      const canonicalTuple =
        !!candidate &&
        row.type === "EXTRA" &&
        row.reason === INTERVIEW_HOURS_REASON;
      // A mutable canonical-looking tuple is not participation evidence. Only a
      // typed receipt or completed legacy attendance mapping proves ownership.
      if (canonicalTuple && proven.size === 0) unresolved = true;
      const owners = [
        ...new Set(
          [
            ...rowTyped.map((claim) => claim.applicationId),
            ...rowLegacy.map((claim) => claim.applicationId),
            ...(candidate && (canonicalTuple || proven.size)
              ? [candidate]
              : []),
          ].filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
        ),
      ].sort();
      if (identities.size > 1) {
        result.set(row.id, {
          kind: "CONFLICTING_INTERVIEW",
          applicationId: null,
          applicationIds: owners,
          canDelete: false,
          correctionApplicationId: null,
        });
      } else if (proven.size) {
        const appId = [...proven.keys()][0]!;
        const app = appById.get(appId);
        const live = !!app?.interviewCompletedAt;
        result.set(row.id, {
          kind: live
            ? "LIVE_INTERVIEW"
            : app
              ? "UNRESOLVED_INTERVIEW"
              : "ORPHANED_INTERVIEW",
          applicationId: appId,
          applicationIds: owners,
          // Orphan disposition is explicitly pending root's policy choice. Keep
          // its existing authorized cleanup semantics without relabeling manual.
          // A reset initial application is not current completed service. Keep
          // that retired receipt distinct while its cleanup policy is pending.
          canDelete: !live,
          correctionApplicationId:
            app?.interviewCompletedAt &&
            !app.invalidatedAt &&
            app.status !== "RECALLED"
              ? app.id
              : null,
        });
      } else if (unresolved) {
        result.set(row.id, {
          kind: "UNRESOLVED_INTERVIEW",
          applicationId: candidate,
          applicationIds: owners,
          canDelete: true,
          correctionApplicationId: null,
        });
      }
    }
  }
  return result;
}

export async function inspectInterviewAdjustmentSource(
  db: DomainDb,
  row: AdjustmentSourceRow,
) {
  return (await inspectInterviewAdjustmentSources(db, [row])).get(row.id)!;
}

function assertDisposition(source: InterviewAdjustmentSource) {
  if (!source.canDelete)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        source.kind === "CONFLICTING_INTERVIEW"
          ? INTERVIEW_ADJUSTMENT_AMBIGUITY_MESSAGE
          : INTERVIEW_ADJUSTMENT_SOURCE_CONFLICT_MESSAGE,
    });
}

/** Pure prequeue/replay check. Absence is not a final answer: the applying path
 * must take its namespace/source fences before its authoritative missing lookup. */
export async function assertAdjustmentDeletionAllowed(
  db: DomainDb,
  id: string,
) {
  const row = await db.serviceHourAdjustment.findUnique({ where: { id } });
  if (!row) return null;
  const source = await inspectInterviewAdjustmentSource(db, row);
  assertDisposition(source);
  return source;
}

/** Caller owns the transaction. Retain namespace→sorted application→row locks
 * through deletion; inspection/classification elsewhere never takes these locks. */
export async function lockAdjustmentDeletion(
  tx: TransactionDb,
  id: string,
  authorize?: () => Promise<unknown>,
) {
  try {
    await lockUsernameNamespace(tx);
  } catch (cause) {
    if (isSerializationFailure(cause))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Adjustment source changed while this review waited. Reload its recorded evidence.",
        cause,
      });
    throw cause;
  }
  // Transport can freeze its live actor here, after namespace but before any
  // private source read. Queue callers retain their existing requester checks.
  if (authorize) await authorize();
  const prior = await tx.serviceHourAdjustment.findUnique({ where: { id } });
  const initial = prior
    ? await inspectInterviewAdjustmentSource(tx, prior)
    : null;
  const lockedApps = initial?.applicationIds ?? [];
  for (const appId of lockedApps) await lockApplicationReview(tx, appId);
  try {
    await tx.$queryRaw`SELECT id FROM "ServiceHourAdjustment" WHERE id = ${id} FOR UPDATE`;
  } catch (cause) {
    if (isSerializationFailure(cause))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Adjustment source changed while this review waited. Reload its recorded evidence.",
        cause,
      });
    throw cause;
  }
  const row = await tx.serviceHourAdjustment.findUnique({ where: { id } });
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Adjustment not found.",
    });
  const current = await inspectInterviewAdjustmentSource(tx, row);
  if (current.applicationIds.some((appId) => !lockedApps.includes(appId)))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The adjustment source changed. Reload before reviewing deletion.",
    });
  assertDisposition(current);
  return row;
}
