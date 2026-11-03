import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { accountHistoryIds, accountHistoryReaderId } from "./account-history";
import { assertHistoryProfileOwner } from "./history-row-ownership";
import { lockUsernameNamespace } from "./auth/username-namespace";
import {
  inTransaction,
  type DomainDb,
  type TransactionDb,
} from "./transactions";

export const personSource = z.object({
  kind: z.enum(["USER", "TUTOR", "TUTEE"]),
  id: z.string().min(1).max(128),
});
export type PersonSource = z.infer<typeof personSource>;

/** Identity metadata must not rewrite roster edit versions or original evidence. */
export async function assignParticipantPerson(
  tx: TransactionDb,
  kind: "TUTOR" | "TUTEE",
  ids: string[],
  personId: string,
) {
  if (!ids.length) return;
  // Bind a flat array: nested Prisma SQL fragments can cross separate Sql class
  // instances in the Next/Turbopack runtime and become JSON instead of SQL.
  const assigned =
    kind === "TUTOR"
      ? await tx.$executeRaw`UPDATE "Tutor" SET "personId"=${personId} WHERE id = ANY(${ids}::text[])`
      : await tx.$executeRaw`UPDATE "Tutee" SET "personId"=${personId} WHERE id = ANY(${ids}::text[])`;
  // A durable receipt must never acknowledge an incomplete source association.
  // Keep this check inside the caller's transaction so every effect rolls back.
  if (assigned !== ids.length) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Identity source assignment changed. Reload and review the records again.",
    });
  }
}

/** A Person is a directory identity, never an authorization principal. Readers of
 * private history must still use current/retained ownership and retired User families. */
export async function personGraph(db: DomainDb, sources: PersonSource[]) {
  const userIds = new Set(
    sources.filter((s) => s.kind === "USER").map((s) => s.id),
  );
  const tutorIds = new Set(
    sources.filter((s) => s.kind === "TUTOR").map((s) => s.id),
  );
  const tuteeIds = new Set(
    sources.filter((s) => s.kind === "TUTEE").map((s) => s.id),
  );
  const personIds = new Set<string>();
  // Expand explicit source links and existing groups to a fixed point. New rows
  // created by legacy provisioning can have null personId until their next write.
  const read = async () => {
    // Directory closure follows explicit effective ownership. Credential ancestry
    // stays immutable, but cannot rejoin a corrected or quarantined source.
    const readers = await Promise.all([...userIds].map((id) => accountHistoryReaderId(db, id)));
    for (const id of readers) if (id) userIds.add(id);
    const families = await Promise.all([...userIds].map((id) => accountHistoryIds(db, id)));
    for (const family of families) for (const id of family) userIds.add(id);
    const ownership = await db.studentProfileOwnership.findMany({
      where: {
        OR: [
          { userId: { in: [...userIds] } },
          { tuteeId: { in: [...tuteeIds] } },
        ],
      },
      orderBy: { tuteeId: "asc" },
    });
    for (const row of ownership) {
      userIds.add(row.userId);
      tuteeIds.add(row.tuteeId);
    }
    const [users, tutors, tutees, persons] = await Promise.all([
      db.user.findMany({
        where: {
          OR: [
            { id: { in: [...userIds] } },
            { personId: { in: [...personIds] } },
          ],
        },
        include: {
          academicProfile: true,
          schoolDeparture: true,
          emails: { orderBy: { email: "asc" } },
        },
        orderBy: { id: "asc" },
      }),
      db.tutor.findMany({
        where: {
          OR: [
            { id: { in: [...tutorIds] } },
            { personId: { in: [...personIds] } },
            { user: { id: { in: [...userIds] } } },
            { retainedOwner: { userId: { in: [...userIds] } } },
          ],
        },
        include: { user: { select: { id: true } }, retainedOwner: true },
        orderBy: { id: "asc" },
      }),
      db.tutee.findMany({
        where: {
          OR: [
            { id: { in: [...tuteeIds] } },
            { personId: { in: [...personIds] } },
            { user: { id: { in: [...userIds] } } },
          ],
        },
        include: { user: { select: { id: true } } },
        orderBy: { id: "asc" },
      }),
      db.person.findMany({
        where: { id: { in: [...personIds] } },
        orderBy: { id: "asc" },
      }),
    ]);
    const historyOwnership = await db.retiredHistoryOwnership.findMany({
      where: { sourceUserId: { in: users.map((row) => row.id) } }, orderBy: { sourceUserId: "asc" },
    });
    return { users, tutors, tutees, persons, ownership, historyOwnership };
  };
  for (;;) {
    const size = userIds.size + tutorIds.size + tuteeIds.size + personIds.size;
    const graph = await read();
    for (const row of graph.users) {
      userIds.add(row.id);
      if (row.personId) personIds.add(row.personId);
      if (row.tutorId) tutorIds.add(row.tutorId);
      if (row.studentId) tuteeIds.add(row.studentId);
    }
    for (const row of graph.tutors) {
      tutorIds.add(row.id);
      if (row.personId) personIds.add(row.personId);
      if (row.user) userIds.add(row.user.id);
      if (row.retainedOwner) userIds.add(row.retainedOwner.userId);
    }
    for (const row of graph.tutees) {
      tuteeIds.add(row.id);
      if (row.personId) personIds.add(row.personId);
      if (row.user) userIds.add(row.user.id);
    }
    for (const row of graph.persons)
      if (row.mergedIntoId) personIds.add(row.mergedIntoId);
    if (size !== userIds.size + tutorIds.size + tuteeIds.size + personIds.size)
      continue;
    for (const source of sources) {
      const exists =
        source.kind === "USER"
          ? graph.users.some((r) => r.id === source.id)
          : source.kind === "TUTOR"
            ? graph.tutors.some((r) => r.id === source.id)
            : graph.tutees.some((r) => r.id === source.id);
      if (!exists)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "A selected identity record no longer exists.",
        });
    }
    return graph;
  }
}

/** Legacy exact-record links may not silently approve a second login identity.
 * Bind their review to explicit group membership and its monotonic revisions. */
export async function historyIdentitySnapshot(
  db: DomainDb,
  source: PersonSource,
  userId: string,
) {
  const graph = await personGraph(db, [source, { kind: "USER", id: userId }]);
  return {
    conflict: graph.users.some((r) => !r.mergedIntoId && r.id !== userId),
    persons: graph.persons.map((r) => ({
      id: r.id,
      revision: r.revision,
      mergedIntoId: r.mergedIntoId,
    })),
    users: graph.users.map((r) => ({
      id: r.id,
      personId: r.personId,
      mergedIntoId: r.mergedIntoId,
      tutorId: r.tutorId,
      studentId: r.studentId,
    })),
    tutors: graph.tutors.map((r) => ({
      id: r.id,
      personId: r.personId,
      userId: r.user?.id ?? null,
      ownerId: r.retainedOwner?.userId ?? null,
    })),
    tutees: graph.tutees.map((r) => ({
      id: r.id,
      personId: r.personId,
      userId: r.user?.id ?? null,
    })),
    ownership: graph.ownership,
    historyOwnership: graph.historyOwnership,
    rowOwnership: await db.historyRowOwnership.findMany({
      where: { entity: source.kind === "TUTOR" ? "Tutor" : source.kind === "TUTEE" ? "Tutee" : "User", recordId: source.id },
    }),
  };
}

/** Canonical redirects only resolve directory groups. They never resurrect or
 * redirect a retired login and never expand a caller's history permissions. */
async function canonicalPersonId(db: DomainDb, id: string) {
  const visited = new Set<string>();
  let current = id;
  for (;;) {
    if (visited.has(current))
      throw new TRPCError({
        code: "CONFLICT",
        message: "Identity grouping needs review.",
      });
    visited.add(current);
    const row = await db.person.findUniqueOrThrow({ where: { id: current } });
    if (!row.mergedIntoId) return row.id;
    current = row.mergedIntoId;
  }
}

/** Moving directory metadata carries no ownership grant. A first claim keeps
 * reviewed accountless siblings together; a second live login requires review. */
async function joinDirectoryGroup(
  tx: TransactionDb,
  personId: string,
  sourceId: string,
) {
  const priorId = await canonicalPersonId(tx, sourceId);
  if (priorId === personId) return;
  const prior = await tx.person.findUniqueOrThrow({
    where: { id: priorId },
    select: { resolutionState: true },
  });
  // Legacy attachment is not an operational resolution review. Carry any
  // outstanding work forward even when the new group has only one login.
  if (prior.resolutionState === "REVIEW_REQUIRED")
    await tx.person.update({
      where: { id: personId },
      data: { resolutionState: "REVIEW_REQUIRED" },
    });
  await tx.person.update({
    where: { id: priorId },
    data: {
      primaryUserId: null,
      mergedIntoId: personId,
      revision: { increment: 1 },
    },
  });
  await tx.user.updateMany({
    where: { personId: priorId },
    data: { personId },
  });
  await tx.$executeRaw`UPDATE "Tutor" SET "personId"=${personId} WHERE "personId"=${priorId}`;
  await tx.$executeRaw`UPDATE "Tutee" SET "personId"=${personId} WHERE "personId"=${priorId}`;
}

async function refreshDirectoryState(tx: TransactionDb, personId: string) {
  const users = await tx.user.findMany({
    where: { personId, mergedIntoId: null },
    select: { id: true },
  });
  await tx.person.update({
    where: { id: personId },
    data: {
      ...(users.length > 1
        ? { resolutionState: "REVIEW_REQUIRED" as const }
        : {}),
      revision: { increment: 1 },
    },
  });
}

/** Provisioning/legacy writers call this inside their identity transaction. A
 * newly created login receives a directory identity without any participation grant. */
export async function syncAccountPerson(
  db: DomainDb,
  userId: string,
): Promise<string> {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mergedIntoId) {
      const reader = await accountHistoryReaderId(tx, user.id);
      const parentId = reader
        ? await syncAccountPerson(tx, reader)
        : user.personId ?? (await tx.person.create({ data: { resolutionState: "REVIEW_REQUIRED" } })).id;
      await tx.user.update({
        where: { id: userId },
        data: { personId: parentId },
      });
      return parentId;
    }
    if (user.tutorId) await assertHistoryProfileOwner(tx, "TUTOR", user.tutorId, user.id);
    if (user.studentId) await assertHistoryProfileOwner(tx, "TUTEE", user.studentId, user.id);
    const [tutor, student] = await Promise.all([
      user.tutorId
        ? tx.tutor.findUnique({
            where: { id: user.tutorId },
            select: { personId: true },
          })
        : null,
      user.studentId
        ? tx.tutee.findUnique({
            where: { id: user.studentId },
            select: { personId: true },
          })
        : null,
    ]);
    const existing = user.personId ?? tutor?.personId ?? student?.personId;
    const person = existing
      ? await tx.person.findUniqueOrThrow({
          where: { id: await canonicalPersonId(tx, existing) },
        })
      : await tx.person.create({ data: { primaryUserId: userId } });
    await tx.user.update({
      where: { id: userId },
      data: { personId: person.id },
    });
    if (!person.primaryUserId)
      await tx.person.update({
        where: { id: person.id },
        data: { primaryUserId: userId, revision: { increment: 1 } },
      });
    // These pointers already grant ownership. Synchronizing grouping does not
    // copy names, academics, lifecycle state or credentials to the original rows.
    if (tutor?.personId)
      await joinDirectoryGroup(tx, person.id, tutor.personId);
    if (student?.personId)
      await joinDirectoryGroup(tx, person.id, student.personId);
    if (user.tutorId)
      await assignParticipantPerson(tx, "TUTOR", [user.tutorId], person.id);
    if (user.studentId)
      await assignParticipantPerson(tx, "TUTEE", [user.studentId], person.id);
    await refreshDirectoryState(tx, person.id);
    return person.id;
  });
}

/** A reviewed ownership correction moves this source only. It must never union
 * the former and new owners' unrelated identities, or grant the entire group access. */
export async function syncParticipantPerson(
  db: DomainDb,
  kind: "TUTOR" | "TUTEE",
  id: string,
  userId: string,
  ownershipCorrection = false,
) {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    const personId = await syncAccountPerson(tx, userId);
    await assertHistoryProfileOwner(tx, kind, id, userId);
    const row =
      kind === "TUTOR"
        ? await tx.tutor.findUniqueOrThrow({ where: { id } })
        : await tx.tutee.findUniqueOrThrow({ where: { id } });
    if (row.personId === personId) return personId;
    if (row.personId && !ownershipCorrection)
      await joinDirectoryGroup(tx, personId, row.personId);
    await assignParticipantPerson(tx, kind, [id], personId);
    await refreshDirectoryState(tx, personId);
    if (row.personId)
      await tx.person.update({
        where: { id: row.personId },
        data: { revision: { increment: 1 } },
      });
    return personId;
  });
}

/** Called after an already-authorized legacy login combine; that transaction is
 * the authority to group both families. Source identifiers and audit actors stay. */
export async function syncCombinedPersons(
  tx: TransactionDb,
  survivorId: string,
  duplicateId: string,
) {
  const personId = await syncAccountPerson(tx, survivorId);
  const duplicate = await tx.user.findUniqueOrThrow({
    where: { id: duplicateId },
  });
  const priorId = duplicate.personId;
  if (priorId && priorId !== personId) {
    const prior = await tx.person.findUniqueOrThrow({
      where: { id: priorId },
      select: { resolutionState: true },
    });
    if (prior.resolutionState === "REVIEW_REQUIRED")
      await tx.person.update({
        where: { id: personId },
        data: { resolutionState: "REVIEW_REQUIRED" },
      });
    await tx.person.update({
      where: { id: priorId },
      data: { primaryUserId: null },
    });
    await tx.user.updateMany({
      where: { personId: priorId },
      data: { personId },
    });
    await tx.$executeRaw`UPDATE "Tutor" SET "personId"=${personId} WHERE "personId"=${priorId}`;
    await tx.$executeRaw`UPDATE "Tutee" SET "personId"=${personId} WHERE "personId"=${priorId}`;
    await tx.person.update({
      where: { id: priorId },
      data: { mergedIntoId: personId, revision: { increment: 1 } },
    });
  }
  await tx.user.update({ where: { id: duplicateId }, data: { personId } });
  await tx.person.update({
    where: { id: personId },
    data: { primaryUserId: survivorId, revision: { increment: 1 } },
  });
  const [tutors, tutees] = await Promise.all([
    tx.tutorProfileOwnership.findMany({
      where: { userId: survivorId },
      select: { tutorId: true },
    }),
    tx.studentProfileOwnership.findMany({
      where: { userId: survivorId },
      select: { tuteeId: true },
    }),
  ]);
  await assignParticipantPerson(
    tx,
    "TUTOR",
    tutors.map((r) => r.tutorId),
    personId,
  );
  await assignParticipantPerson(
    tx,
    "TUTEE",
    tutees.map((r) => r.tuteeId),
    personId,
  );
}
