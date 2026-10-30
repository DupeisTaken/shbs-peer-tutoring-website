import { TRPCError } from "@trpc/server";
import type { NextRecruitmentPreparation, Prisma, Term } from "../../../generated/prisma";
import {
  nextRecruitmentRefreshEvidenceSchema,
  sameNextRecruitmentTarget,
  type NextRecruitmentPreparationEvidence,
  type NextRecruitmentRefreshEvidence,
  type NextRecruitmentTarget,
  type PrepareNextRecruitmentInput,
} from "~/lib/next-recruitment";
import { nextPeriod, periodLabel } from "~/lib/period";
import { getProgramTimeZone } from "~/server/program/time-zone";
import { isSerializationFailure } from "~/server/auth/username-snapshot";
import { inTransaction, lockEntity, type DomainDb, type TransactionDb } from "~/server/transactions";

/** All period-dependent writers take the period barrier before the source and timezone. */
export async function lockNextRecruitment(tx: TransactionDb) {
  await lockEntity(tx, "program:period");
  // Approval decisions may already own a Serializable snapshot before waiting on the
  // advisory lock. The source-row fence makes a concurrent committed writer abort
  // that stale snapshot, including when no preparation row existed at capture time.
  try {
    await tx.$queryRaw`SELECT "id" FROM "Term" WHERE "active" = true ORDER BY "id" FOR UPDATE`;
  } catch (error) {
    if (isSerializationFailure(error)) conflict("NEXT_RECRUITMENT_CHANGED");
    throw error;
  }
  await lockEntity(tx, "program-timezone");
}

/** Must run under the period barrier; excluded from user evidence for audience independence. */
export async function advanceNextRecruitmentFence(tx: TransactionDb) {
  await tx.term.updateMany({
    where: { active: true },
    data: { nextRecruitmentRevision: { increment: 1 } },
  });
}

/** Admission before waiting is insufficient: freeze and recheck the live actor after the barrier. */
export async function assertNextRecruitmentActor(
  tx: TransactionDb,
  userId: string,
  allowedRoles: readonly string[] = ["HEAD"],
) {
  try {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR SHARE`;
  } catch (error) {
    if (isSerializationFailure(error)) conflict("NEXT_RECRUITMENT_CHANGED");
    throw error;
  }
  const actor = await tx.user.findUnique({ where: { id: userId },
    select: { id: true, name: true, username: true, role: true, suspendedAt: true, mergedIntoId: true, refreshAuthorityRevision: true } });
  if (!actor || actor.suspendedAt || actor.mergedIntoId || !allowedRoles.includes(actor.role))
    throw new TRPCError({ code: "FORBIDDEN", message: "Your current role cannot apply this change." });
  return actor;
}

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

function preparationEvidence(
  row: NextRecruitmentPreparation | undefined,
): NextRecruitmentPreparationEvidence | null {
  if (!row) return null;
  return {
    version: row.version,
    opensAt: row.opensAt,
    timeZone: row.timeZone,
    target: {
      sourceTermId: row.sourceTermId,
      sourceSchoolYear: row.sourceSchoolYear,
      sourceQuarter: row.sourceQuarter,
      destinationSchoolYear: row.destinationSchoolYear,
      destinationQuarter: row.destinationQuarter,
      semesterMode: row.semesterMode,
      modeRevision: row.modeRevision,
    },
  };
}

function destinationEvidence(term: Term | null): NextRecruitmentRefreshEvidence["destination"] {
  return term ? {
    termId: term.id,
    tutor: { enabled: term.tutorSignupEnabled, opensAt: term.tutorSignupOpensAt,
      closesAt: term.tutorSignupClosesAt, previewUrl: term.tutorSignupPreviewUrl },
    tutee: { enabled: term.signupEnabled, opensAt: term.signupOpensAt,
      closesAt: term.signupClosesAt, previewUrl: term.signupPreviewUrl },
  } : null;
}

/** Read only after the barrier, so source, staged mode and both rows form one review. */
async function readLockedNextRecruitment(tx: TransactionDb) {
  const source = await tx.term.findFirst({
    where: { active: true }, orderBy: { createdAt: "desc" },
  });
  if (!source) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Create an active program period first." });
  const mode = await tx.programFeature.findUnique({ where: { key: "QUARTER_SYSTEM" } });
  const semesterMode = !(mode?.pendingEnabled ?? mode?.enabled ?? true);
  const destination = nextPeriod(source, semesterMode);
  const target: NextRecruitmentTarget = {
    sourceTermId: source.id,
    sourceSchoolYear: source.schoolYear,
    sourceQuarter: source.quarter,
    destinationSchoolYear: destination.schoolYear,
    destinationQuarter: destination.quarter,
    semesterMode,
    modeRevision: mode?.revision ?? 0,
  };
  const rows = await tx.nextRecruitmentPreparation.findMany({ where: { sourceTermId: source.id } });
  const preparations = {
    tutor: preparationEvidence(rows.find((row) => row.audience === "tutor")),
    tutee: preparationEvidence(rows.find((row) => row.audience === "tutee")),
  };
  const timeZone = await getProgramTimeZone(tx);
  const existingDestination = await tx.term.findUnique({
    where: { schoolYear_quarter: destination },
  });
  const refreshEvidence: NextRecruitmentRefreshEvidence = {
    target, timeZone, preparations, destination: destinationEvidence(existingDestination),
    stagedFeatures: await tx.programFeature.findMany({
      select: { key: true, enabled: true, pendingEnabled: true, revision: true },
      orderBy: { key: "asc" },
    }),
  };
  const withState = (row: NextRecruitmentPreparationEvidence | null) => row ? {
    ...row, matchesTarget: sameNextRecruitmentTarget(row.target, target),
  } : null;
  return {
    target,
    currentName: periodLabel(source, !(mode?.enabled ?? true)),
    nextName: periodLabel(destination, semesterMode),
    timeZone,
    preparations: { tutor: withState(preparations.tutor), tutee: withState(preparations.tutee) },
    refreshEvidence,
  };
}

/** Admin-only reads use the same lock order as save, mode staging and refresh. */
export async function readNextRecruitment(db: DomainDb) {
  return inTransaction(db, async (tx) => {
    await lockNextRecruitment(tx);
    return readLockedNextRecruitment(tx);
  });
}

function assertOpeningFits(opensAt: Date | null, closesAt: Date | null) {
  // Past openings are valid: activation then opens immediately, subject to other intake gates.
  if (opensAt && closesAt && opensAt >= closesAt)
    throw new TRPCError({ code: "BAD_REQUEST", message: "NEXT_RECRUITMENT_CLOSING_CONFLICT" });
}

/** Proposal capture and direct/application writes share identical locked validation. */
export async function validateNextRecruitmentWrite(tx: TransactionDb, input: PrepareNextRecruitmentInput) {
  await lockNextRecruitment(tx);
  const snapshot = await readLockedNextRecruitment(tx);
  if (!sameNextRecruitmentTarget(input.expectedTarget, snapshot.target))
    conflict("NEXT_RECRUITMENT_TARGET_CHANGED");
  if (input.expectedTimeZone !== snapshot.timeZone)
    conflict("NEXT_RECRUITMENT_TIME_ZONE_CHANGED");
  const preparation = snapshot.refreshEvidence.preparations[input.audience];
  if (input.expectedVersion !== (preparation?.version ?? 0))
    conflict("NEXT_RECRUITMENT_CHANGED");
  const destinationClosesAt = snapshot.refreshEvidence.destination?.[input.audience].closesAt ?? null;
  assertOpeningFits(input.opensAt, destinationClosesAt);
  // Only this audience is captured for saves: a Tutor proposal does not invalidate a Tutee one.
  return { target: snapshot.target, currentName: snapshot.currentName, nextName: snapshot.nextName,
    timeZone: snapshot.timeZone, preparation, destinationClosesAt };
}

export async function saveNextRecruitment(
  db: DomainDb,
  input: PrepareNextRecruitmentInput,
  actor: { id: string; name?: string | null },
) {
  return inTransaction(db, async (tx) => {
    const before = await validateNextRecruitmentWrite(tx, input);
    const currentActor = await assertNextRecruitmentActor(tx, actor.id, ["ADMIN", "HEAD"]);
    const actorName = currentActor.name ?? currentActor.username ?? actor.name ?? null;
    const target = before.target;
    const data = {
      sourceSchoolYear: target.sourceSchoolYear,
      sourceQuarter: target.sourceQuarter,
      destinationSchoolYear: target.destinationSchoolYear,
      destinationQuarter: target.destinationQuarter,
      semesterMode: target.semesterMode,
      modeRevision: target.modeRevision,
      opensAt: input.opensAt,
      timeZone: before.timeZone,
      updatedById: actor.id,
      updatedByName: actorName,
    };
    const row = await tx.nextRecruitmentPreparation.upsert({
      where: { sourceTermId_audience: { sourceTermId: target.sourceTermId, audience: input.audience } },
      create: { sourceTermId: target.sourceTermId, audience: input.audience, createdById: actor.id, ...data },
      update: { ...data, version: { increment: 1 } },
    });
    await advanceNextRecruitmentFence(tx);
    const after = preparationEvidence(row)!;
    await tx.auditLog.create({ data: {
      userId: actor.id, userName: actorName,
      entity: "NextRecruitmentPreparation", entityId: `${target.sourceTermId}:${input.audience}`,
      operation: "program.prepareNextRecruitment",
      action: `Prepared ${input.audience} opening for ${periodLabel({ schoolYear: target.destinationSchoolYear, quarter: target.destinationQuarter }, target.semesterMode)}`,
      details: JSON.parse(JSON.stringify({ audience: input.audience, before, after, currentIntakePreserved: true })) as Prisma.InputJsonValue,
    } });
    return { ...after, matchesTarget: true };
  });
}

/** Refresh must recheck the exact reviewed evidence before archiving or activating anything. */
export async function validateNextRecruitmentRefresh(tx: TransactionDb, evidence: NextRecruitmentRefreshEvidence) {
  await lockNextRecruitment(tx);
  const snapshot = await readLockedNextRecruitment(tx);
  if (!sameNextRecruitmentTarget(evidence.target, snapshot.target))
    conflict("NEXT_RECRUITMENT_TARGET_CHANGED");
  const reviewed = nextRecruitmentRefreshEvidenceSchema.parse(evidence);
  if (JSON.stringify(reviewed) !== JSON.stringify(nextRecruitmentRefreshEvidenceSchema.parse(snapshot.refreshEvidence)))
    conflict("NEXT_RECRUITMENT_CHANGED");
  for (const audience of ["tutor", "tutee"] as const) {
    const row = snapshot.preparations[audience];
    if (row && !row.matchesTarget) conflict("NEXT_RECRUITMENT_STALE_TARGET");
    if (row) assertOpeningFits(row.opensAt, snapshot.refreshEvidence.destination?.[audience].closesAt ?? null);
  }
  return snapshot;
}
