import { TRPCError } from "@trpc/server";
import { accountHistoryIds, accountRetirementChain } from "./account-history";
import { lockUsernameNamespace } from "./auth/username";
import {
  assignParticipantPerson,
  type PersonSource,
} from "./person-identity";
import type { TransactionDb } from "./transactions";

/** Initialize only missing directory metadata in the source writer's transaction.
 * Existing groups are preserved, even when reconciliation would flag them. Only
 * explicit current/retained ownership can associate an uninitialized participant;
 * contact details, display names and imported Person IDs are never evidence. */
export async function initializePersonSource(
  tx: TransactionDb,
  source: PersonSource,
): Promise<string> {
  await lockUsernameNamespace(tx);
  if (source.kind === "USER") {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: source.id },
      select: { personId: true, tutorId: true, studentId: true },
    });
    if (user.personId) return user.personId;
    const chain = await accountRetirementChain(tx, source.id);
    const survivorId = chain[chain.length - 1]!;
    if (survivorId !== source.id) {
      const personId = await initializePersonSource(tx, { kind: "USER", id: survivorId });
      await tx.user.update({ where: { id: source.id }, data: { personId } });
      await tx.person.update({ where: { id: personId }, data: { revision: { increment: 1 } } });
      return personId;
    }
    const family = await accountHistoryIds(tx, source.id);
    const [retainedTutors, retainedStudents] = await Promise.all([
      tx.tutorProfileOwnership.findMany({ where: { userId: { in: family } }, select: { tutorId: true } }),
      tx.studentProfileOwnership.findMany({ where: { userId: { in: family } }, select: { tuteeId: true } }),
    ]);
    const candidates = [
      ...(user.tutorId ? [{ kind: "TUTOR" as const, id: user.tutorId }] : []),
      ...(user.studentId ? [{ kind: "TUTEE" as const, id: user.studentId }] : []),
      ...retainedTutors.map((row) => ({ kind: "TUTOR" as const, id: row.tutorId })),
      ...retainedStudents.map((row) => ({ kind: "TUTEE" as const, id: row.tuteeId })),
    ];
    const linkedSources = [...new Map(candidates.map((row) => [`${row.kind}:${row.id}`, row])).values()];
    const existingGroups = new Set<string>();
    const missingSources: typeof linkedSources = [];
    for (const linked of linkedSources) {
      const participant = linked.kind === "TUTOR"
        ? await tx.tutor.findUniqueOrThrow({ where: { id: linked.id }, select: { personId: true, user: { select: { id: true } } } })
        : await tx.tutee.findUniqueOrThrow({ where: { id: linked.id }, select: { personId: true, user: { select: { id: true } } } });
      const retained = linked.kind === "TUTOR"
        ? await tx.tutorProfileOwnership.findUnique({ where: { tutorId: linked.id }, select: { userId: true } })
        : await tx.studentProfileOwnership.findUnique({ where: { tuteeId: linked.id }, select: { userId: true } });
      for (const ownerId of [participant.user?.id, retained?.userId]) {
        if (!ownerId) continue;
        const ownerChain = await accountRetirementChain(tx, ownerId);
        if (ownerChain[ownerChain.length - 1] !== source.id)
          throw conflictingOwners();
      }
      if (participant.personId) existingGroups.add(participant.personId);
      else missingSources.push(linked);
    }
    // Initialization may attach missing metadata to one explicit current group;
    // joining two established groups still requires the reviewed combine writer.
    if (existingGroups.size > 1)
      throw new TRPCError({ code: "CONFLICT", message: "The linked sources have different directory groups. Review Combine Records before initializing this account." });
    const existingId = [...existingGroups][0];
    const person = existingId
      ? await tx.person.findUniqueOrThrow({ where: { id: existingId } })
      : await tx.person.create({ data: { primaryUserId: source.id } });
    if (person.mergedIntoId)
      throw new TRPCError({ code: "CONFLICT", message: "The source points to a retired directory group. Review identity reconciliation before initializing this account." });
    const otherLiveAccounts = await tx.user.count({ where: { personId: person.id, mergedIntoId: null, id: { not: source.id } } });
    await tx.user.update({ where: { id: source.id }, data: { personId: person.id } });
    for (const linked of missingSources)
      await assignParticipantPerson(tx, linked.kind, [linked.id], person.id);
    await tx.person.update({ where: { id: person.id }, data: {
      ...(!person.primaryUserId ? { primaryUserId: source.id } : {}),
      ...(otherLiveAccounts ? { resolutionState: "REVIEW_REQUIRED" as const } : {}),
      revision: { increment: 1 },
    } });
    return person.id;
  }

  const participant =
    source.kind === "TUTOR"
      ? await tx.tutor.findUniqueOrThrow({
          where: { id: source.id },
          select: { personId: true, user: { select: { id: true } } },
        })
      : await tx.tutee.findUniqueOrThrow({
          where: { id: source.id },
          select: { personId: true, user: { select: { id: true } } },
        });
  if (participant.personId) return participant.personId;
  const retained =
    source.kind === "TUTOR"
      ? await tx.tutorProfileOwnership.findUnique({
          where: { tutorId: source.id },
          select: { userId: true },
        })
      : await tx.studentProfileOwnership.findUnique({
          where: { tuteeId: source.id },
          select: { userId: true },
        });
  const ownerIds = new Set<string>();
  for (const id of [participant.user?.id, retained?.userId]) {
    if (!id) continue;
    const chain = await accountRetirementChain(tx, id);
    ownerIds.add(chain[chain.length - 1]!);
  }
  if (ownerIds.size > 1)
    throw conflictingOwners();
  const ownerId = [...ownerIds][0];
  const personId = ownerId
    ? await initializePersonSource(tx, { kind: "USER", id: ownerId })
    : (await tx.person.create({ data: {} })).id;
  if (ownerId) {
    const person = await tx.person.findUniqueOrThrow({ where: { id: personId }, select: { mergedIntoId: true } });
    if (person.mergedIntoId)
      throw new TRPCError({ code: "CONFLICT", message: "The owner points to a retired directory group. Review identity reconciliation before initializing this source." });
  }
  await assignParticipantPerson(tx, source.kind, [source.id], personId);
  if (ownerId)
    await tx.person.update({
      where: { id: personId },
      data: { revision: { increment: 1 } },
    });
  return personId;
}

function conflictingOwners() {
  return new TRPCError({
    code: "CONFLICT",
    message: "This source has conflicting current and retained owners. Review exact historical ownership before initializing its identity.",
  });
}
