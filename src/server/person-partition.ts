import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assignParticipantPerson, personGraph, personSource, type PersonSource } from "./person-identity";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";
import { lockUsernameNamespace } from "./auth/username";
import { verifyPasswordConfirmation } from "./auth/password-confirmation";

const sourceKey = (source: PersonSource) => `${source.kind}:${source.id}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const personPartitionSelection = z.object({
  personId: z.string().min(1).max(128),
  sources: z.array(personSource).min(1).max(200).refine(
    (sources) => new Set(sources.map(sourceKey)).size === sources.length,
    "Choose distinct records.",
  ),
});
export const personPartitionInput = personPartitionSelection.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(1000),
  acknowledged: z.literal(true),
  operationId: z.string().uuid(),
  confirmPassword: z.string().min(1).max(1024),
});
type Selection = z.input<typeof personPartitionSelection>;
type Blocker = {
  reason: "CURRENT_OWNER" | "RETAINED_OWNER" | "RETIRED_FAMILY";
  sources: PersonSource[];
};

/** Directory details hide retired login actions, but a partition must let staff
 * select every original source needed to keep a retirement component intact. */
export async function personPartitionSources(db: DomainDb, personId: string) {
  const person = await db.person.findUnique({ where: { id: personId } });
  if (!person) throw new TRPCError({ code: "NOT_FOUND" });
  if (person.mergedIntoId) throw new TRPCError({ code: "CONFLICT", message: "Open the current identity group and review again." });
  const [users, tutors, tutees] = await Promise.all([
    db.user.findMany({ where: { personId }, select: { id: true, name: true, username: true, email: true }, orderBy: { id: "asc" } }),
    db.tutor.findMany({ where: { personId }, select: { id: true, englishName: true }, orderBy: { id: "asc" } }),
    db.tutee.findMany({ where: { personId }, select: { id: true, englishName: true }, orderBy: { id: "asc" } }),
  ]);
  return [
    ...users.map((row) => ({ ref: { kind: "USER" as const, id: row.id }, name: row.name ?? row.username ?? row.email })),
    ...tutors.map((row) => ({ ref: { kind: "TUTOR" as const, id: row.id }, name: row.englishName })),
    ...tutees.map((row) => ({ ref: { kind: "TUTEE" as const, id: row.id }, name: row.englishName })),
  ];
}

async function requireReviewer(db: DomainDb, actorId: string) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor || !["ADMIN", "HEAD"].includes(actor.role) || actor.mergedIntoId || actor.suspendedAt || actor.recoveryVoidedAt)
    throw new TRPCError({ code: "FORBIDDEN" });
  return actor;
}

async function plan(db: DomainDb, raw: Selection) {
  const input = personPartitionSelection.parse(raw);
  const person = await db.person.findUnique({ where: { id: input.personId } });
  if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "This identity group no longer exists." });
  if (person.mergedIntoId) throw new TRPCError({ code: "CONFLICT", message: "Open the current identity group and review again." });
  const [users, tutors, tutees] = await Promise.all([
    db.user.findMany({ where: { personId: person.id }, select: { id: true }, orderBy: { id: "asc" } }),
    db.tutor.findMany({ where: { personId: person.id }, select: { id: true }, orderBy: { id: "asc" } }),
    db.tutee.findMany({ where: { personId: person.id }, select: { id: true }, orderBy: { id: "asc" } }),
  ]);
  const sources: PersonSource[] = [
    ...users.map((row) => ({ kind: "USER" as const, id: row.id })),
    ...tutors.map((row) => ({ kind: "TUTOR" as const, id: row.id })),
    ...tutees.map((row) => ({ kind: "TUTEE" as const, id: row.id })),
  ];
  const present = new Set(sources.map(sourceKey));
  if (input.sources.some((source) => !present.has(sourceKey(source))))
    throw new TRPCError({ code: "CONFLICT", message: "Selected records changed group. Reload and review again." });
  if (input.sources.length >= sources.length)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Keep at least one record in each resulting group." });
  const graph = await personGraph(db, sources);
  // A graph crossing established directory groups needs explicit correction;
  // partitioning must not silently pull unrelated owners into either result.
  if ([...graph.users, ...graph.tutors, ...graph.tutees].some((row) => row.personId !== person.id))
    throw new TRPCError({ code: "CONFLICT", message: "Ownership crosses another identity group. Review its exact ownership first." });
  const selected = new Set(input.sources.map(sourceKey));
  const blockers: Blocker[] = [];
  const edge = (reason: Blocker["reason"], a: PersonSource, b: PersonSource) => {
    if (selected.has(sourceKey(a)) !== selected.has(sourceKey(b))) blockers.push({ reason, sources: [a, b] });
  };
  for (const user of graph.users) {
    const ref: PersonSource = { kind: "USER", id: user.id };
    if (user.tutorId) edge("CURRENT_OWNER", ref, { kind: "TUTOR", id: user.tutorId });
    if (user.studentId) edge("CURRENT_OWNER", ref, { kind: "TUTEE", id: user.studentId });
    const history = graph.historyOwnership.find((row) => row.sourceUserId === user.id);
    if (user.mergedIntoId && history?.state === "ASSIGNED" && history.readerUserId)
      edge("RETIRED_FAMILY", ref, { kind: "USER", id: history.readerUserId });
  }
  for (const tutor of graph.tutors)
    if (tutor.retainedOwner) edge("RETAINED_OWNER", { kind: "TUTOR", id: tutor.id }, { kind: "USER", id: tutor.retainedOwner.userId });
  for (const ownership of graph.ownership)
    edge("RETAINED_OWNER", { kind: "TUTEE", id: ownership.tuteeId }, { kind: "USER", id: ownership.userId });
  const rows = [
    ...graph.users.map((row) => ({ ref: { kind: "USER" as const, id: row.id }, name: row.name ?? row.username ?? row.email })),
    ...graph.tutors.map((row) => ({ ref: { kind: "TUTOR" as const, id: row.id }, name: row.englishName })),
    ...graph.tutees.map((row) => ({ ref: { kind: "TUTEE" as const, id: row.id }, name: row.englishName })),
  ];
  return {
    graph, person, selected,
    preview: {
      personId: person.id,
      fingerprint: hash({ action: "partition", person, graph, sources: [...selected].sort() }),
      moving: rows.filter((row) => selected.has(sourceKey(row.ref))),
      remaining: rows.filter((row) => !selected.has(sourceKey(row.ref))),
      blockers,
      canSplit: blockers.length === 0,
    },
  };
}

export async function previewPersonPartition(db: DomainDb, input: Selection) {
  return (await plan(db, input)).preview;
}

function receiptResult(receipt: { id: string; personId: string; newPersonId: string; sources: unknown }) {
  return {
    ok: true as const, receiptId: receipt.id, personId: receipt.personId,
    newPersonId: receipt.newPersonId, sources: z.array(personSource).parse(receipt.sources),
  };
}

/** Recovery authenticates the original reviewer but never repeats the write. */
export async function personPartitionReceipt(db: DomainDb, actorId: string, operationId: string) {
  await requireReviewer(db, actorId);
  const receipt = await db.personPartitionReceipt.findUnique({ where: { id: operationId } });
  return receipt?.actorId === actorId ? receiptResult(receipt) : null;
}

export async function partitionPersonRecords(db: DomainDb, actorId: string, raw: z.input<typeof personPartitionInput>) {
  const input = personPartitionInput.parse(raw);
  const { confirmPassword: _password, ...intent } = input;
  void _password;
  const inputHash = hash({ ...intent, sources: [...intent.sources].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))) });
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, "program:leadership");
    const saved = await tx.personPartitionReceipt.findUnique({ where: { id: input.operationId } });
    if (saved) {
      await requireReviewer(tx, actorId);
      if (saved.actorId !== actorId || saved.inputHash !== inputHash)
        throw new TRPCError({ code: "CONFLICT", message: "This operation reference belongs to another reviewed intent." });
      return receiptResult(saved);
    }
    const initial = await plan(tx, input);
    for (const id of [...new Set([actorId, ...initial.graph.users.map((row) => row.id)])].sort())
      await lockEntity(tx, `account-profile:${id}`);
    // Same fence/order as combination. Existing source/owner triggers invalidate
    // exact invitations and A->B->A reviews without rewriting source evidence.
    await tx.$executeRaw`LOCK TABLE "User", "Tutor", "Tutee", "Person", "AcademicProfile", "AccountEmail", "SchoolDeparture", "StudentProfileOwnership", "TutorProfileOwnership" IN SHARE ROW EXCLUSIVE MODE`;
    const actor = await requireReviewer(tx, actorId);
    if (!verifyPasswordConfirmation(actorId, input.confirmPassword, actor.passwordHash))
      throw new TRPCError({ code: "FORBIDDEN", message: "Password is incorrect." });
    const { graph, person, selected, preview } = await plan(tx, input);
    if (preview.fingerprint !== input.fingerprint)
      throw new TRPCError({ code: "CONFLICT", message: "Records changed. Reload and review the separation again." });
    if (!preview.canSplit)
      throw new TRPCError({ code: "CONFLICT", message: "Keep each login with its current records, retained history and retired login family." });
    // Both results require their own fresh operational review. A directory
    // correction cannot certify participation or erase an earlier pending review.
    const created = await tx.person.create({ data: { resolutionState: "REVIEW_REQUIRED" } });
    const movingUsers = graph.users.filter((row) => selected.has(sourceKey({ kind: "USER", id: row.id })));
    const movedPrimary = person.primaryUserId && movingUsers.some((row) => row.id === person.primaryUserId);
    await tx.person.update({ where: { id: person.id }, data: {
      ...(movedPrimary ? { primaryUserId: null } : {}), resolutionState: "REVIEW_REQUIRED", revision: { increment: 1 },
    } });
    const assigned = await tx.user.updateMany({ where: { id: { in: movingUsers.map((row) => row.id) }, personId: person.id }, data: { personId: created.id } });
    if (assigned.count !== movingUsers.length) throw new TRPCError({ code: "CONFLICT", message: "Identity source assignment changed." });
    for (const kind of ["TUTOR", "TUTEE"] as const)
      await assignParticipantPerson(tx, kind, input.sources.filter((row) => row.kind === kind).map((row) => row.id), created.id);
    if (movedPrimary) await tx.person.update({ where: { id: created.id }, data: { primaryUserId: person.primaryUserId } });
    const receipt = await tx.personPartitionReceipt.create({ data: {
      id: input.operationId, actorId, inputHash, personId: person.id, newPersonId: created.id,
      sources: preview.moving.map((row) => row.ref),
      subjects: [
        { entity: "Person", recordId: person.id }, { entity: "Person", recordId: created.id },
        ...preview.moving.map((row) => ({ entity: row.ref.kind === "USER" ? "User" : row.ref.kind === "TUTOR" ? "Tutor" : "Tutee", recordId: row.ref.id })),
      ],
    } });
    await tx.auditLog.create({ data: {
      userId: actorId, userName: actor.name ?? actor.username, entity: "Person", entityId: person.id,
      operation: "personCombine.partition", action: "Separated identity records",
      details: { newPersonId: created.id, sources: preview.moving.map((row) => row.ref), remaining: preview.remaining.map((row) => row.ref), reason: input.reason, fingerprint: input.fingerprint, receiptId: receipt.id },
    } });
    return receiptResult(receipt);
  });
}
