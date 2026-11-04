import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env";
import {
  historicalCorrectionInput,
  type HistoricalCorrectionInput,
} from "~/lib/historical-academics";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { lockUsernameNamespace } from "./auth/username-namespace";
import { lockAccountProfile } from "./account-profile-lock";
import { approvalScope } from "./db-scope";
import { Prisma } from "../../generated/prisma";

import { historicalAcademicSnapshot } from "./historical-academic-snapshot";
export { historicalAcademicSnapshot, preserveHistoricalAcademics } from "./historical-academic-snapshot";
export const historicalListInput = z.object({
  kind: z.enum(["TUTEE", "TUTOR"]).default("TUTEE"),
  search: z.string().trim().max(100).default(""),
  page: z.number().int().min(0).max(10000).default(0),
});

export async function listHistoricalAcademics(
  db: DomainDb,
  input: z.infer<typeof historicalListInput>,
) {
  // Page academic records, not people: one participant can have many reference years.
  // SQL identifiers are a fixed server allowlist; search text is always parameterized.
  const participantTable = Prisma.raw(
    input.kind === "TUTEE" ? '"Tutee"' : '"Tutor"',
  );
  const participantKey = Prisma.raw(
    input.kind === "TUTEE" ? '"tuteeId"' : '"tutorId"',
  );
  const prefix = input.kind === "TUTEE" ? "legacy-tutee:" : "legacy-tutor:";
  const keys = await db.$queryRaw<{ recordId: string }[]>(Prisma.sql`
    SELECT "recordId" FROM (
      SELECT ${prefix} || p.id AS "recordId", p.id AS "participantId", p."englishName" AS name FROM ${participantTable} p
      UNION
      SELECT h.id AS "recordId", p.id AS "participantId", p."englishName" AS name
      FROM "HistoricalAcademicRecord" h JOIN ${participantTable} p ON h.${participantKey}=p.id
    ) records WHERE position(lower(${input.search}) in lower(name)) > 0
      OR "participantId"=${input.search} OR "recordId"=${input.search}
    ORDER BY "recordId" LIMIT 21 OFFSET ${input.page * 20}`);
  const records = [];
  // Bounded serial reads keep historical bulk tools inexpensive on school-hosted instances.
  for (const key of keys.slice(0, 20))
    records.push(await historicalAcademicSnapshot(db, key.recordId));
  return { records, hasNext: keys.length > 20 };
}

export async function previewHistoricalCorrections(
  db: DomainDb,
  input: HistoricalCorrectionInput,
) {
  const parsed = historicalCorrectionInput.parse(input);
  const records = [];
  for (const row of parsed.rows) {
    const record = await historicalAcademicSnapshot(db, row.recordId);
    if (record.fingerprint !== row.expectedFingerprint)
      throw new TRPCError({ code: "CONFLICT", message: "HISTORICAL_STALE" });
    if (record.ownershipConflict)
      throw new TRPCError({
        code: "CONFLICT",
        message: "HISTORICAL_OWNERSHIP_CONFLICT",
      });
    records.push({
      ...record,
      proposed: { rawGrade: row.rawGrade, schoolYear: row.schoolYear },
      evidence: row.evidence,
      reason: row.reason,
    });
  }
  return records;
}

/** A preview signature attests to the exact validated proposal, not permission to write.
 * It remains reviewable in the approval queue; live snapshots and roles are always rechecked.
 * Replaying a successfully applied ticket fails because its revision is now stale. */
export function historicalPreviewTicket(input: HistoricalCorrectionInput) {
  if (!env.AUTH_SECRET)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Historical previews require the configured authentication secret.",
    });
  return createHmac("sha256", env.AUTH_SECRET)
    .update("historical-academics-v1:")
    .update(JSON.stringify(historicalCorrectionInput.parse(input)))
    .digest("hex");
}
export function verifyHistoricalPreview(
  input: HistoricalCorrectionInput,
  ticket: string,
) {
  const expected = Buffer.from(historicalPreviewTicket(input));
  const actual = Buffer.from(ticket);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "HISTORICAL_PREVIEW_REQUIRED",
    });
}

export const historicalApplyInput = historicalCorrectionInput.extend({
  ticket: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Match the identity/link lock order before reading ownership. Row locks also fence
 * regular roster edits, and sorted keys serialize overlapping batches across instances. */
export async function lockHistoricalCorrections(
  tx: TransactionDb,
  input: HistoricalCorrectionInput,
  actorId?: string,
) {
  await lockUsernameNamespace(tx);
  const initial = [];
  for (const row of [...input.rows].sort((a, b) =>
    a.recordId.localeCompare(b.recordId),
  ))
    initial.push(await historicalAcademicSnapshot(tx, row.recordId));
  const ownerIds = [
    ...new Set([
      ...initial.flatMap((row) => row.owners.map((owner) => owner.id)),
      ...(actorId ? [actorId] : []),
    ]),
  ].sort();
  for (const id of ownerIds) await lockAccountProfile(tx, id);
  for (const record of initial) {
    if (record.tuteeId) {
      await lockEntity(tx, `tutee:${record.tuteeId}`);
      await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id=${record.tuteeId} FOR UPDATE`;
    } else {
      await lockEntity(tx, `tutor:${record.tutorId}`);
      await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id=${record.tutorId} FOR UPDATE`;
    }
    await lockEntity(tx, `historical-academic:${record.recordId}`);
  }
}

/** Atomic validation and append-only audit share the caller's approval transaction.
 * Original evidence, enrollment grades, current academic profiles and ownership are untouched. */
export async function applyHistoricalCorrections(
  db: DomainDb,
  actorId: string,
  value: z.infer<typeof historicalApplyInput>,
) {
  const { ticket, ...input } = historicalApplyInput.parse(value);
  verifyHistoricalPreview(input, ticket);
  return inTransaction(db, async (tx) => {
    await lockHistoricalCorrections(tx, input, actorId);
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (
      actor.suspendedAt ||
      actor.mergedIntoId ||
      !["ADMIN", "HEAD"].includes(actor.role)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "HISTORICAL_MANAGER_REQUIRED",
      });
    const records = await previewHistoricalCorrections(tx, input);
    // Validate the entire batch before writing its first row. Transaction rollback also
    // covers late constraints/audit failures, including execution inside an approval.
    for (const record of records) {
      await tx.historicalAcademicRecord.upsert({
        where: { id: record.recordId },
        update: {},
        create: {
          id: record.recordId,
          tuteeId: record.tuteeId,
          tutorId: record.tutorId,
          ...record.original,
        },
      });
      await tx.historicalAcademicCorrection.create({
        data: {
          recordId: record.recordId,
          revision: record.revision + 1,
          ...record.proposed,
          evidence: record.evidence,
          reason: record.reason,
          actorId,
          actorName: actor.name ?? actor.username ?? actorId,
          approvalId: approvalScope.getStore() ?? null,
          method: input.method,
          before: record.current,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        userName: actor.name ?? actor.username ?? actorId,
        entity: "HistoricalAcademicRecord",
        operation: "historicalAcademics.correctBatch",
        action: "Corrected historical academic evidence",
        approvalId: approvalScope.getStore(),
        details: {
          recordIds: records.map((row) => row.recordId),
          method: input.method,
          count: records.length,
        },
      },
    });
    return { count: records.length };
  });
}
