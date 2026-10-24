import type { TransactionDb } from "./transactions";

type SourceKind = "USER" | "TUTOR" | "TUTEE";
type Source = { id: string; personId: string | null };
type UserSource = Source & {
  mergedIntoId: string | null;
  tutorId: string | null;
  studentId: string | null;
};
type Person = {
  id: string;
  mergedIntoId: string | null;
  primaryUserId: string | null;
  resolutionState: "GROUPED" | "REVIEW_REQUIRED";
};

/** Deliberately excludes names, contact details, credentials and private evidence.
 * Reconciliation compares explicit relationships, never inferred identity. */
export type PersonReconciliationSnapshot = {
  persons: Person[];
  users: UserSource[];
  tutors: Source[];
  tutees: Source[];
  tutorOwners: { tutorId: string; userId: string }[];
  studentOwners: { tuteeId: string; userId: string }[];
};

export type PersonReconciliationFinding = {
  code:
    | "MISSING_PERSON"
    | "DANGLING_PERSON"
    | "DANGLING_OWNER"
    | "DANGLING_SOURCE"
    | "PERSON_CYCLE"
    | "RETIREMENT_CYCLE"
    | "CONFLICTING_OWNERS"
    | "INVALID_PRIMARY"
    | "MISSING_PRIMARY"
    | "ORPHAN_PERSON"
    | "SOURCE_REDIRECT"
    | "OWNER_PROJECTION_MISMATCH"
    | "HISTORY_READER_PROJECTION_MISMATCH"
    | "RETIREMENT_PROJECTION_MISMATCH"
    | "GROUP_REVIEW_STATE_MISMATCH";
  source: { kind: SourceKind | "PERSON"; id: string };
  relatedIds: string[];
};

/** Read one consistent database snapshot. The CLI additionally makes its entire
 * transaction READ ONLY, so future additions cannot silently turn this into repair. */
export async function readPersonReconciliationSnapshot(
  tx: TransactionDb,
): Promise<PersonReconciliationSnapshot> {
  const [persons, users, tutors, tutees, tutorOwners, studentOwners] =
    await Promise.all([
      tx.person.findMany({
        select: {
          id: true,
          mergedIntoId: true,
          primaryUserId: true,
          resolutionState: true,
        },
      }),
      tx.user.findMany({
        select: {
          id: true,
          personId: true,
          mergedIntoId: true,
          tutorId: true,
          studentId: true,
        },
      }),
      tx.tutor.findMany({ select: { id: true, personId: true } }),
      tx.tutee.findMany({ select: { id: true, personId: true } }),
      tx.tutorProfileOwnership.findMany({
        select: { tutorId: true, userId: true },
      }),
      tx.studentProfileOwnership.findMany({
        select: { tuteeId: true, userId: true },
      }),
    ]);
  return { persons, users, tutors, tutees, tutorOwners, studentOwners };
}

/** Pure, deterministic inventory: finding a mismatch never changes either side.
 * Directory grouping and private ownership remain separate projections, even
 * when the directory intentionally contains more than one live account. */
export function reconcilePersonSources(snapshot: PersonReconciliationSnapshot) {
  const persons = new Map(snapshot.persons.map((row) => [row.id, row]));
  const users = new Map(snapshot.users.map((row) => [row.id, row]));
  const tutors = new Map(snapshot.tutors.map((row) => [row.id, row]));
  const tutees = new Map(snapshot.tutees.map((row) => [row.id, row]));
  const findings: PersonReconciliationFinding[] = [];
  const add = (
    code: PersonReconciliationFinding["code"],
    kind: PersonReconciliationFinding["source"]["kind"],
    id: string,
    relatedIds: string[] = [],
  ) => {
    findings.push({
      code,
      source: { kind, id },
      relatedIds: [...new Set(relatedIds)].sort(),
    });
  };

  // Follow redirects with an explicit visited set. Corrupt cycles or dangling
  // edges are reportable data, rather than a recursion/hang or an automatic fix.
  function terminal(
    kind: "PERSON" | "USER",
    id: string,
  ): string | null {
    const visited = new Set<string>();
    let current = id;
    for (;;) {
      if (visited.has(current)) {
        add(kind === "PERSON" ? "PERSON_CYCLE" : "RETIREMENT_CYCLE", kind, id, [...visited]);
        return null;
      }
      visited.add(current);
      const row = kind === "PERSON" ? persons.get(current) : users.get(current);
      if (!row) {
        add(kind === "PERSON" ? "DANGLING_PERSON" : "DANGLING_OWNER", kind, id, [current]);
        return null;
      }
      if (!row.mergedIntoId) return row.id;
      current = row.mergedIntoId;
    }
  }
  const canonicalPersons = new Map(
    snapshot.persons.map((row) => [row.id, terminal("PERSON", row.id)]),
  );
  const canonicalUsers = new Map(
    snapshot.users.map((row) => [row.id, terminal("USER", row.id)]),
  );
  const ownerMap = new Map<string, Set<string>>();
  const addOwner = (kind: "TUTOR" | "TUTEE", id: string, userId: string) => {
    if (!(kind === "TUTOR" ? tutors : tutees).has(id))
      add("DANGLING_SOURCE", kind, id, [userId]);
    if (!users.has(userId)) add("DANGLING_OWNER", kind, id, [userId]);
    const key = `${kind}:${id}`;
    const owners = ownerMap.get(key) ?? new Set<string>();
    owners.add(userId);
    ownerMap.set(key, owners);
  };
  for (const row of snapshot.users) {
    if (row.tutorId) addOwner("TUTOR", row.tutorId, row.id);
    if (row.studentId) addOwner("TUTEE", row.studentId, row.id);
  }
  for (const row of snapshot.tutorOwners) addOwner("TUTOR", row.tutorId, row.userId);
  for (const row of snapshot.studentOwners) addOwner("TUTEE", row.tuteeId, row.userId);

  const sources = (
    [
      ...snapshot.users.map((row) => ({ ...row, kind: "USER" as const })),
      ...snapshot.tutors.map((row) => ({ ...row, kind: "TUTOR" as const })),
      ...snapshot.tutees.map((row) => ({ ...row, kind: "TUTEE" as const })),
    ]
  ).map((row) => {
    if (!row.personId) add("MISSING_PERSON", row.kind, row.id);
    else if (!persons.has(row.personId))
      add("DANGLING_PERSON", row.kind, row.id, [row.personId]);
    const canonicalPersonId = row.personId
      ? canonicalPersons.get(row.personId) ?? null
      : null;
    if (canonicalPersonId && canonicalPersonId !== row.personId)
      add("SOURCE_REDIRECT", row.kind, row.id, [row.personId!, canonicalPersonId]);
    const ownerUserIds = [...(ownerMap.get(`${row.kind}:${row.id}`) ?? [])].sort();
    const canonicalOwnerIds = [...new Set(ownerUserIds.flatMap((id) => {
      const ownerId = canonicalUsers.get(id);
      return ownerId ? [ownerId] : [];
    }))].sort();
    // Tutor history expands retired actor families. ownedStudentIds instead
    // reads exact current/retained User IDs; normal combination transfers those
    // links. Surface old/imported links that a live Tutee reader cannot reach.
    const historyReaderUserIds = row.kind === "TUTEE"
      ? ownerUserIds.filter((id) => users.has(id) && !users.get(id)!.mergedIntoId)
      : canonicalOwnerIds;
    if (canonicalOwnerIds.some((id) => !historyReaderUserIds.includes(id)))
      add("HISTORY_READER_PROJECTION_MISMATCH", row.kind, row.id, [...ownerUserIds, ...canonicalOwnerIds]);
    if (canonicalOwnerIds.length > 1)
      add("CONFLICTING_OWNERS", row.kind, row.id, canonicalOwnerIds);
    for (const ownerId of canonicalOwnerIds) {
      const owner = users.get(ownerId)!;
      const ownerPersonId = owner.personId
        ? canonicalPersons.get(owner.personId) ?? null
        : null;
      if (canonicalPersonId && ownerPersonId && canonicalPersonId !== ownerPersonId)
        add("OWNER_PROJECTION_MISMATCH", row.kind, row.id, [ownerId, canonicalPersonId, ownerPersonId]);
    }
    if (row.kind === "USER") {
      const terminalId = canonicalUsers.get(row.id);
      const survivor = terminalId ? users.get(terminalId) : null;
      const survivorPersonId = survivor?.personId
        ? canonicalPersons.get(survivor.personId)
        : null;
      if (canonicalPersonId && survivorPersonId && canonicalPersonId !== survivorPersonId)
        add("RETIREMENT_PROJECTION_MISMATCH", row.kind, row.id, [terminalId!, survivorPersonId]);
    }
    return {
      kind: row.kind,
      id: row.id,
      personId: row.personId,
      canonicalPersonId,
      ownerUserIds,
      canonicalOwnerIds,
      historyReaderUserIds,
    };
  }).sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));

  const memberCounts = new Map<string, number>();
  const liveUsersByPerson = new Map<string, UserSource[]>();
  for (const source of sources)
    if (source.personId)
      memberCounts.set(source.personId, (memberCounts.get(source.personId) ?? 0) + 1);
  for (const user of snapshot.users) {
    if (!user.personId || user.mergedIntoId) continue;
    const members = liveUsersByPerson.get(user.personId) ?? [];
    members.push(user);
    liveUsersByPerson.set(user.personId, members);
  }
  for (const person of snapshot.persons) {
    const liveUsers = liveUsersByPerson.get(person.id) ?? [];
    if (person.primaryUserId) {
      const primary = users.get(person.primaryUserId);
      if (person.mergedIntoId || !primary || primary.mergedIntoId || primary.personId !== person.id)
        add("INVALID_PRIMARY", "PERSON", person.id, [person.primaryUserId]);
    } else if (!person.mergedIntoId && liveUsers.length)
      add("MISSING_PRIMARY", "PERSON", person.id, liveUsers.map((user) => user.id));
    if (!person.mergedIntoId && !memberCounts.get(person.id))
      add("ORPHAN_PERSON", "PERSON", person.id);
    if (!person.mergedIntoId && liveUsers.length > 1 && person.resolutionState !== "REVIEW_REQUIRED")
      add("GROUP_REVIEW_STATE_MISMATCH", "PERSON", person.id, liveUsers.map((user) => user.id));
  }

  // Multiple traversal paths can establish the same finding. Stable sorting and
  // deduplication make before/after cutover reports useful without exposing PII.
  const uniqueFindings = [...new Map(findings.map((finding) => [JSON.stringify(finding), finding])).values()]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    schemaVersion: 1,
    counts: {
      persons: snapshot.persons.length,
      users: snapshot.users.length,
      tutors: snapshot.tutors.length,
      tutees: snapshot.tutees.length,
      tutorOwners: snapshot.tutorOwners.length,
      studentOwners: snapshot.studentOwners.length,
      findings: uniqueFindings.length,
    },
    findings: uniqueFindings,
    sources,
  };
}
