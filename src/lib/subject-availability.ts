type Subject = {
  id: string;
  name: string;
  active: boolean;
  groupId: string | null;
  group: { name: string } | null;
  level: { name: string; active: boolean } | null;
};
type Qualification = {
  tutorId: string;
  subjectId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
};
type Grant = { tutorId: string; sourceSubjectId: string; subjectId: string };
type Willingness = { tutorId: string; subjectId: string; willing: boolean };

/** Join by stable IDs. An inherited grant and a direct pending source can coexist;
 * display both, and never turn either approval evidence into teaching intent. */
export function tutorSubjectRows(
  tutorId: string,
  subjects: Subject[],
  qualifications: Qualification[],
  grants: Grant[],
  willingness: Willingness[],
) {
  const direct = new Map(
    qualifications
      .filter((row) => row.tutorId === tutorId)
      .map((row) => [row.subjectId, row]),
  );
  const intents = new Map(
    willingness
      .filter((row) => row.tutorId === tutorId)
      .map((row) => [row.subjectId, row.willing]),
  );
  const names = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const sources = new Map<string, string[]>();
  for (const grant of grants) {
    // Also guard pure callers against passing grants from unapproved sources.
    if (
      grant.tutorId !== tutorId ||
      direct.get(grant.sourceSubjectId)?.status !== "APPROVED"
    )
      continue;
    const values = sources.get(grant.subjectId) ?? [];
    values.push(grant.sourceSubjectId);
    sources.set(grant.subjectId, values);
  }
  return subjects
    .map((subject) => ({
      ...subject,
      active: subject.active && subject.level?.active !== false,
      qualification: direct.get(subject.id)?.status ?? null,
      qualified: (sources.get(subject.id)?.length ?? 0) > 0,
      inheritedFrom: (sources.get(subject.id) ?? [])
        .filter((id) => id !== subject.id)
        .map((id) => names.get(id) ?? id),
      willing: intents.get(subject.id) ?? null,
    }))
    .filter(
      (row) =>
        row.active ||
        row.qualification !== null ||
        row.qualified ||
        row.willing !== null,
    );
}
