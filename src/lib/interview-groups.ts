/** Group by immutable tutor ID, never display name. Include active tutors without
 * qualifications and inactive tutors with retained qualifications for review/removal. */
export function groupTutorQualifications(
  tutors: { id: string; englishName: string; status: string }[],
  subjects: { id: string; name: string }[],
  qualifications: { tutorId: string; subjectId: string }[],
) {
  const subjectNames = new Map(
    subjects.map((subject) => [subject.id, subject.name]),
  );
  const byTutor = new Map<string, { subjectId: string; name: string }[]>();
  for (const qualification of qualifications) {
    const rows = byTutor.get(qualification.tutorId) ?? [];
    rows.push({
      subjectId: qualification.subjectId,
      name:
        subjectNames.get(qualification.subjectId) ?? qualification.subjectId,
    });
    byTutor.set(qualification.tutorId, rows);
  }
  return tutors
    .filter((tutor) => tutor.status === "ACTIVE" || byTutor.has(tutor.id))
    .map((tutor) => ({ ...tutor, subjects: byTutor.get(tutor.id) ?? [] }));
}

export function filterTutorQualifications<
  T extends { englishName: string; subjects: { name: string }[] },
>(groups: T[], search: string, status: "ALL" | "QUALIFIED" | "NONE") {
  const needle = search.trim().toLocaleLowerCase();
  return groups.filter(
    (group) =>
      (status === "ALL" ||
        (status === "NONE"
          ? group.subjects.length === 0
          : group.subjects.length > 0)) &&
      (!needle ||
        [
          group.englishName,
          ...group.subjects.map((subject) => subject.name),
        ].some((value) => value.toLocaleLowerCase().includes(needle))),
  );
}
