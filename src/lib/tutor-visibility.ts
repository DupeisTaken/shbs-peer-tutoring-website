/** Visibility is independent of assignment eligibility and never removes historical data. */
export function isPastTutor(status: string | null | undefined) {
  return status === "ARCHIVED" || status === "GRADUATED";
}

/** Keep selected values renderable even after the reveal control is switched off. */
export function visibleTutors<T extends { id: string; status: string }>(
  tutors: T[],
  showPast: boolean,
  retainedIds: readonly string[] = [],
): T[] {
  const retained = new Set(retainedIds);
  return tutors.filter((tutor) => showPast || !isPastTutor(tutor.status) || retained.has(tutor.id));
}
