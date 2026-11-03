import { TRPCError } from "@trpc/server";
import type { StudentSurvey } from "../../generated/prisma";
import { executionParticipantId, executionSourceIds, supersededPairingIds } from "./participant-execution";
import { lockEntity, type DomainDb, type TransactionDb } from "./transactions";
import { releaseSessionRequestParticipation } from "./session-planning";
import { requireStudentSchoolParticipation } from "./school-departure";

export type RequestExecutionSource = Pick<StudentSurvey, "id" | "tuteeId" | "intakeTermId">;
export type RequestExecutionAssignment = {
  surveyId: string; pairingId: string; tuteeId: string; sourceTuteeId: string;
};

/** Period/planning admission precedes these locks. Different original requests
 * may share a member after consolidation; only this exact tuple grants ownership. */
export async function lockStudentRequestExecution(tx: TransactionDb, tuteeIds: readonly string[]) {
  for (const id of [...new Set(tuteeIds)].sort())
    await lockEntity(tx, `student-request-execution:${id}`);
}

async function legacyAssignments(db: DomainDb, row: RequestExecutionSource): Promise<RequestExecutionAssignment[]> {
  if (!row.tuteeId) return [];
  const successors = await db.pairingExecutionSuccessor.findMany({ select: { targetPairingId: true } });
  const links = await db.pairingTutee.findMany({
    // Successor membership requires an explicit request map. Its canonical
    // profile's own survey must never silently absorb another source's work.
    where: { tuteeId: row.tuteeId, pairingId: { notIn: [...await supersededPairingIds(db), ...successors.map((successor) => successor.targetPairingId)] }, pairing: { termId: row.intakeTermId, term: { active: true } } },
    select: { pairingId: true, tuteeId: true }, orderBy: { pairingId: "asc" },
  });
  return links.map((link) => ({ surveyId: row.id, ...link, sourceTuteeId: row.tuteeId! }));
}

/** Released mappings are permanent authority tombstones. Once a request has
 * explicit execution history, missing active mappings never revive legacy links. */
export async function studentRequestExecutionAssignments(db: DomainDb, row: RequestExecutionSource): Promise<RequestExecutionAssignment[]> {
  const mappings = await db.studentRequestExecutionAssignment.findMany({ where: { surveyId: row.id }, orderBy: { pairingId: "asc" } });
  if (!mappings.length) return legacyAssignments(db, row);
  if (mappings.some((mapping) => mapping.sourceTuteeId !== row.tuteeId))
    throw new TRPCError({ code: "CONFLICT", message: "The request's original execution source needs review." });
  const active = mappings.filter((mapping) => !mapping.releasedAt);
  if (!active.length) return [];
  const links = await db.pairingTutee.findMany({
    where: { OR: active.map((mapping) => ({ pairingId: mapping.pairingId, tuteeId: mapping.tuteeId })), pairingId: { notIn: await supersededPairingIds(db) }, pairing: { termId: row.intakeTermId, term: { active: true } } },
    select: { pairingId: true, tuteeId: true }, orderBy: { pairingId: "asc" },
  });
  return active.filter((mapping) => links.some((link) => link.pairingId === mapping.pairingId && link.tuteeId === mapping.tuteeId))
    .map(({ surveyId, pairingId, tuteeId, sourceTuteeId }) => ({ surveyId, pairingId, tuteeId, sourceTuteeId }));
}

/** Snapshot every previously implicit exact source tuple before introducing the
 * first explicit map; recording a second subject must not hide the first one. */
async function retainLegacyAssignments(tx: TransactionDb, row: RequestExecutionSource) {
  if (await tx.studentRequestExecutionAssignment.count({ where: { surveyId: row.id } })) return;
  const legacy = await legacyAssignments(tx, row);
  if (legacy.length) await tx.studentRequestExecutionAssignment.createMany({ data: legacy, skipDuplicates: true });
}

export async function recordStudentRequestExecution(
  tx: TransactionDb,
  row: RequestExecutionSource,
  pairingId: string,
  tuteeId: string,
  receiptId: string | null = null,
) {
  if (!row.tuteeId) throw new TRPCError({ code: "CONFLICT", message: "Materialize the original request before assigning execution." });
  await lockStudentRequestExecution(tx, [row.tuteeId, tuteeId]);
  const current = await tx.studentSurvey.findUnique({ where: { id: row.id }, select: { tuteeId: true, intakeTermId: true, state: true } });
  if (current?.state !== "OPEN" || current.tuteeId !== row.tuteeId || current.intakeTermId !== row.intakeTermId)
    throw new TRPCError({ code: "CONFLICT", message: "The original request changed before assignment." });
  const link = await tx.pairingTutee.findFirst({
    where: { pairingId, tuteeId, pairing: { termId: row.intakeTermId, term: { active: true } } }, select: { pairingId: true },
  });
  if (!link || (await supersededPairingIds(tx)).includes(pairingId))
    throw new TRPCError({ code: "CONFLICT", message: "Assign this request to a current exact pairing member." });
  return writeStudentRequestExecution(tx, row as RequestExecutionSource & { tuteeId: string }, pairingId, tuteeId, receiptId);
}

/** Admit only a newly reviewed exact assignment before its physical roster insert.
 * The caller owns period and original request locks and commits both atomically.
 * A released tuple is a tombstone, never reusable authority for a stale retry. */
export async function admitStudentRequestExecution(tx: TransactionDb, row: RequestExecutionSource, pairingId: string, tuteeId: string) {
  if (!row.tuteeId) throw new TRPCError({ code: "CONFLICT", message: "Materialize the original request first." });
  await lockStudentRequestExecution(tx, [row.tuteeId, tuteeId]);
  const current = await tx.studentSurvey.findUnique({ where: { id: row.id } });
  if (current?.tuteeId !== row.tuteeId || current.intakeTermId !== row.intakeTermId || current.state !== "OPEN" || current.invalidatedAt ||
    (!current.confirmedAt && current.verificationDueAt && current.verificationDueAt <= new Date()))
    throw new TRPCError({ code: "CONFLICT", message: "The exact original request is no longer assignable." });
  if (await executionParticipantId(tx, "TUTEE", row.tuteeId) !== tuteeId)
    throw new TRPCError({ code: "CONFLICT", message: "Review the original request's current execution profile." });
  await requireStudentSchoolParticipation(tx, row.tuteeId);
  if (row.tuteeId !== tuteeId) await requireStudentSchoolParticipation(tx, tuteeId);
  const pairing = await tx.pairing.findFirst({ where: { id: pairingId, termId: row.intakeTermId, term: { active: true } }, select: { id: true } });
  if (!pairing || (await supersededPairingIds(tx)).includes(pairingId))
    throw new TRPCError({ code: "CONFLICT", message: "Select a current assignment in the original request's term." });
  const previous = await tx.studentRequestExecutionAssignment.findUnique({ where: { surveyId_pairingId: { surveyId: row.id, pairingId } } });
  if (previous && (previous.releasedAt || previous.sourceTuteeId !== row.tuteeId || previous.tuteeId !== tuteeId))
    throw new TRPCError({ code: "CONFLICT", message: "This exact assignment was released or changed. Review a fresh assignment." });
  return writeStudentRequestExecution(tx, row as RequestExecutionSource & { tuteeId: string }, pairingId, tuteeId, null);
}

async function writeStudentRequestExecution(tx: TransactionDb, row: RequestExecutionSource & { tuteeId: string }, pairingId: string, tuteeId: string, receiptId: string | null) {
  await retainLegacyAssignments(tx, row);
  const previous = await tx.studentRequestExecutionAssignment.findUnique({ where: { surveyId_pairingId: { surveyId: row.id, pairingId } } });
  if (previous && previous.sourceTuteeId !== row.tuteeId)
    throw new TRPCError({ code: "CONFLICT", message: "Execution assignment cannot replace original request provenance." });
  return tx.studentRequestExecutionAssignment.upsert({
    where: { surveyId_pairingId: { surveyId: row.id, pairingId } },
    create: { surveyId: row.id, pairingId, tuteeId, sourceTuteeId: row.tuteeId, receiptId },
    update: { tuteeId, receiptId, releasedAt: null, revision: { increment: 1 } },
  });
}

async function anotherRequestNeedsMember(tx: TransactionDb, row: RequestExecutionSource, member: RequestExecutionAssignment) {
  const otherMaps = await tx.studentRequestExecutionAssignment.findMany({
    where: { surveyId: { not: row.id }, pairingId: member.pairingId, tuteeId: member.tuteeId, releasedAt: null }, select: { surveyId: true, sourceTuteeId: true },
  });
  if (otherMaps.length) {
    const requests = await tx.studentSurvey.findMany({ where: { id: { in: otherMaps.map((mapping) => mapping.surveyId) } }, select: { id: true, tuteeId: true, state: true, intakeTermId: true } });
    if (otherMaps.some((mapping) => !requests.some((request) => request.id === mapping.surveyId && request.tuteeId === mapping.sourceTuteeId)))
      throw new TRPCError({ code: "CONFLICT", message: "Another request's original execution source needs review." });
    if (requests.some((request) => request.state === "OPEN" && request.intakeTermId === row.intakeTermId)) return true;
  }
  // A no-map request may own only its own original source, never any family
  // member inferred from the current execution identity or a matching name.
  const legacy = await tx.studentSurvey.findUnique({ where: { tuteeId: member.tuteeId }, select: { id: true, state: true, intakeTermId: true } });
  return !!legacy && legacy.id !== row.id && legacy.state === "OPEN" && legacy.intakeTermId === row.intakeTermId &&
    !(await tx.studentRequestExecutionAssignment.count({ where: { surveyId: legacy.id } })) &&
    !(await tx.pairingExecutionSuccessor.count({ where: { targetPairingId: member.pairingId } }));
}

/** Release one original request's work, retaining shared membership for every
 * independently admitted request. No completed evidence or source ID is changed. */
export async function releaseStudentRequestExecution(
  tx: TransactionDb,
  row: RequestExecutionSource,
  options: { pairingId?: string; now?: Date; unassignedStatus?: "PENDING" | "INACTIVE" } = {},
) {
  const now = options.now ?? new Date();
  const executionId = row.tuteeId ? await executionParticipantId(tx, "TUTEE", row.tuteeId) : null;
  const prior = await tx.studentRequestExecutionAssignment.findMany({ where: { surveyId: row.id, releasedAt: null }, select: { tuteeId: true } });
  const affectedTuteeIds = [...new Set([...(executionId ? [executionId] : []), ...prior.map((mapping) => mapping.tuteeId)])].sort();
  await lockStudentRequestExecution(tx, affectedTuteeIds);
  await retainLegacyAssignments(tx, row);
  const assignments = (await studentRequestExecutionAssignments(tx, row)).filter((assignment) => !options.pairingId || assignment.pairingId === options.pairingId);
  await tx.studentRequestExecutionAssignment.updateMany({
    where: { surveyId: row.id, releasedAt: null, ...(options.pairingId ? { pairingId: options.pairingId } : {}) },
    data: { releasedAt: now, revision: { increment: 1 } },
  });
  const removedPairingIds: string[] = [];
  const retainedPairingIds: string[] = [];
  for (const member of assignments) {
    if (await anotherRequestNeedsMember(tx, row, member)) { retainedPairingIds.push(member.pairingId); continue; }
    const removed = await tx.pairingTutee.deleteMany({ where: { pairingId: member.pairingId, tuteeId: member.tuteeId } });
    if (removed.count) removedPairingIds.push(member.pairingId);
  }
  if (row.tuteeId && assignments.length)
    await releaseSessionRequestParticipation(tx, { surveyId: row.id, sourceTuteeId: row.tuteeId, assignments }, now);
  const superseded = await supersededPairingIds(tx);
  const activeTerms = await tx.term.findMany({ where: { active: true }, select: { id: true } });
  const statuses: { id: string; status: "PENDING" | "INACTIVE" }[] = [];
  for (const tuteeId of affectedTuteeIds) {
    if (await tx.pairingTutee.count({ where: { tuteeId, pairingId: { notIn: superseded }, pairing: { term: { active: true } } } })) continue;
    const otherOpen = await tx.studentSurvey.count({ where: {
      id: { not: row.id }, state: "OPEN", intakeTermId: { in: activeTerms.map((term) => term.id) },
      tuteeId: { in: await executionSourceIds(tx, "TUTEE", tuteeId) },
    } });
    const ownRequest = await tx.studentSurvey.findUnique({ where: { tuteeId }, select: { state: true, confirmedAt: true, verificationDueAt: true } });
    const ownRequestClosed = ownRequest && (ownRequest.state !== "OPEN" || (!ownRequest.confirmedAt && ownRequest.verificationDueAt && ownRequest.verificationDueAt <= now));
    // An independent unassigned request remains in its original queue. It does
    // not reactivate a canonical profile whose own intake is already terminal.
    const status = ownRequestClosed ? "INACTIVE" : otherOpen ? "PENDING" : options.unassignedStatus ?? "INACTIVE";
    // Superseded sources remain archived evidence; only the current execution
    // profile can move back into the assignment queue.
    if (await executionParticipantId(tx, "TUTEE", tuteeId) !== tuteeId) continue;
    // Releasing work cannot revive a profile already removed by discipline,
    // departure or another owning restriction workflow.
    const changed = await tx.tutee.updateMany({ where: { id: tuteeId, ...(status === "PENDING" ? { status: { not: "INACTIVE" as const } } : {}) }, data: { status } });
    if (changed.count) statuses.push({ id: tuteeId, status });
  }
  return { removedPairingIds, retainedPairingIds, affectedTuteeIds, statuses };
}
