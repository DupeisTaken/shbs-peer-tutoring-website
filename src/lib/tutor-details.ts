type Subject = {
  id: string;
  name: string;
  active: boolean;
  group: { id: string; name: string; rank: number } | null;
  level: { id: string; name: string; rank: number } | null;
};
type Qualification = { subjectId: string; status: string };
type Grant = { sourceSubjectId: string; subjectId: string };
type Willingness = { subjectId: string; willing: boolean };

/** Display eligibility from saved grants only. Catalogue order changes presentation,
 * never the levels a past approval granted; willingness stays an independent fact. */
export function tutorSubjectGroups(
  subjects: Subject[],
  qualifications: Qualification[],
  grants: Grant[],
  willingness: Willingness[],
) {
  const sources = new Map(qualifications.map((row) => [row.subjectId, row.status]));
  const names = new Map(subjects.map((row) => [row.id, row.name]));
  const intentions = new Map(willingness.map((row) => [row.subjectId, row.willing]));
  const approved = new Map<string, Set<string>>();
  for (const grant of grants) {
    // Defense in depth: rejected/pending sources cannot confer inherited eligibility.
    if (sources.get(grant.sourceSubjectId) !== "APPROVED") continue;
    const ids = approved.get(grant.subjectId) ?? new Set<string>();
    ids.add(grant.sourceSubjectId);
    approved.set(grant.subjectId, ids);
  }
  const ordered = [...subjects].sort((a, b) =>
    (a.group?.rank ?? 0) - (b.group?.rank ?? 0) ||
    (a.group?.id ?? a.id).localeCompare(b.group?.id ?? b.id) ||
    (a.level?.rank ?? 0) - (b.level?.rank ?? 0) ||
    (a.level?.id ?? "").localeCompare(b.level?.id ?? "") ||
    a.id.localeCompare(b.id),
  );
  const rows = ordered.map((subject) => ({
    id: subject.id,
    name: subject.name,
    active: subject.active,
    level: subject.level?.name ?? null,
    qualified: approved.has(subject.id),
    approval: sources.get(subject.id) ?? null,
    inheritedFrom: [...(approved.get(subject.id) ?? [])]
      .filter((id) => id !== subject.id)
      .map((id) => ({ id, name: names.get(id) ?? id })),
    willing: intentions.get(subject.id) ?? null,
    groupId: subject.group?.id ?? subject.id,
    groupName: subject.group?.name ?? subject.name,
  }));
  const groups = new Map<string, { id: string; name: string; subjects: typeof rows }>();
  for (const row of rows) {
    // Archived catalogue entries remain visible when they carry recorded evidence.
    if (!row.active && !row.qualified && !row.approval && row.willing === null) continue;
    const group = groups.get(row.groupId) ?? { id: row.groupId, name: row.groupName, subjects: [] };
    group.subjects.push(row);
    groups.set(row.groupId, group);
  }
  return [...groups.values()];
}
