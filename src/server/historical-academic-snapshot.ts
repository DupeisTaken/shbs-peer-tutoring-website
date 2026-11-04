/** DB-injected historical evidence reads and preservation. Signed correction
 * proofs and their application authority remain in historical-academics.ts. */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { isHistoricalTutor, legacyAcademicRecordId } from "~/lib/historical-academics";
import { isHistoricalTutee } from "~/lib/tutee-history";
import { Prisma } from "../../generated/prisma";
import { lockEntity, type DomainDb, type TransactionDb } from "./transactions";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const historyInclude = {
  corrections: { orderBy: { revision: "desc" as const }, take: 1 },
};

/** Preserve the original before historical membership or academic mirrors change.
 * Callers acquire any identity/account locks first. Match corrections/import: participant
 * advisory lock, participant row, then evidence. Never acquire an account/namespace lock
 * here, since academic writers already hold the account lock. Read only after the row lock
 * so a concurrent lifecycle change cannot turn an old snapshot into new evidence. */
export async function preserveHistoricalAcademics(
  tx: TransactionDb,
  kind: "TUTEE" | "TUTOR",
  participantId: string,
) {
  await lockEntity(tx, `${kind.toLowerCase()}:${participantId}`);
  const table = Prisma.raw(kind === "TUTEE" ? '"Tutee"' : '"Tutor"');
  // Evidence fields are non-key values. Fence their writers without blocking the
  // KEY SHARE reads needed to insert pairings referencing both Tutor and Tutee.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ${table} WHERE id=${participantId} FOR NO KEY UPDATE`);
  if (kind === "TUTEE") {
    const tutee = await tx.tutee.findUniqueOrThrow({ where: { id: participantId } });
    const activeTerm = await tx.term.findFirst({ where: { active: true }, select: { id: true } });
    if (!isHistoricalTutee(tutee, activeTerm?.id ?? null)) return;
  } else {
    const tutor = await tx.tutor.findUniqueOrThrow({ where: { id: participantId }, select: { status: true } });
    if (!isHistoricalTutor(tutor)) return;
  }
  const recordId = legacyAcademicRecordId(kind, participantId);
  await lockEntity(tx, `historical-academic:${recordId}`);
  const { original, tuteeId, tutorId } = await historicalAcademicSnapshot(tx, recordId);
  await tx.historicalAcademicRecord.upsert({
    where: { id: recordId },
    update: {},
    create: { id: recordId, tuteeId, tutorId, ...original },
  });
}

/** The legacy key is deterministic; corrections, exact archive restores and status
 * reactivation may preserve it. Browsing never creates evidence or confirmation dates. */
export async function historicalAcademicSnapshot(
  db: DomainDb,
  recordId: string,
) {
  const saved = await db.historicalAcademicRecord.findUnique({
    where: { id: recordId },
    include: historyInclude,
  });
  const legacy = /^legacy-(tutee|tutor):(.+)$/.exec(recordId);
  const tuteeId =
    saved?.tuteeId ?? (legacy?.[1] === "tutee" ? legacy[2]! : null);
  const tutorId =
    saved?.tutorId ?? (legacy?.[1] === "tutor" ? legacy[2]! : null);
  if (!tuteeId && !tutorId)
    throw new TRPCError({ code: "NOT_FOUND", message: "HISTORICAL_NOT_FOUND" });
  const [tutee, tutor, retained] = await Promise.all([
    tuteeId
      ? db.tutee.findUnique({
          where: { id: tuteeId },
          include: { user: { select: { id: true } } },
        })
      : null,
    tutorId
      ? db.tutor.findUnique({
          where: { id: tutorId },
          include: { user: { select: { id: true } } },
        })
      : null,
    tuteeId
      ? db.studentProfileOwnership.findUnique({ where: { tuteeId } })
      : tutorId ? db.tutorProfileOwnership.findUnique({ where: { tutorId } }) : null,
  ]);
  const participant = tutee ?? tutor;
  if (!participant)
    throw new TRPCError({ code: "NOT_FOUND", message: "HISTORICAL_NOT_FOUND" });
  const term = tutee?.intakeTermId
    ? await db.term.findUnique({
        where: { id: tutee.intakeTermId },
        select: { id: true, schoolYear: true },
      })
    : null;
  const ownerIds = [
    ...new Set(
      [participant.user?.id, retained?.userId].filter(
        (id): id is string => !!id,
      ),
    ),
  ].sort();
  const owners = await db.user.findMany({
    where: { id: { in: ownerIds } },
    select: {
      id: true,
      name: true,
      profileVersion: true,
      academicProfile: true,
      mergedIntoId: true,
    },
    orderBy: { id: "asc" },
  });
  const original = saved
    ? {
        rawGrade: saved.rawGrade,
        schoolYear: saved.schoolYear,
        academicallyGraduated: saved.academicallyGraduated,
        source: saved.source,
        originalConfirmedAt: saved.originalConfirmedAt,
      }
    : {
        rawGrade: tutee
          ? tutee.gradeLevel
          : tutor!.gradeLevel === null
            ? null
            : String(tutor!.gradeLevel),
        academicallyGraduated: participant.academicallyGraduated,
        schoolYear: tutee ? (term?.schoolYear ?? null) : tutor!.gradeSchoolYear,
        source: tutee ? "LEGACY_TUTEE" : "LEGACY_TUTOR",
        originalConfirmedAt: tutor?.gradeConfirmedAt ?? null,
      };
  const latest = saved?.corrections[0];
  const current = {
    rawGrade: latest ? latest.rawGrade : original.rawGrade,
    schoolYear: latest ? latest.schoolYear : original.schoolYear,
  };
  const revision = latest?.revision ?? 0;
  // Bind ownership and source-row changes as well as the correction revision. This also
  // invalidates a downloaded CSV if someone links, combines, or edits the participant.
  const fingerprint = digest({
    recordId,
    original,
    current,
    revision,
    participant,
    term,
    ownerIds,
    owners,
  });
  return {
    recordId,
    tuteeId,
    tutorId,
    name: participant.englishName,
    kind: tutee ? ("TUTEE" as const) : ("TUTOR" as const),
    original,
    current,
    revision,
    fingerprint,
    ownershipConflict:
      ownerIds.length > 1 || owners.some((owner) => !!owner.mergedIntoId),
    owners: owners.map((owner) => ({
      id: owner.id,
      name: owner.name,
      academic: owner.academicProfile,
    })),
    correction: latest ?? null,
  };
}
