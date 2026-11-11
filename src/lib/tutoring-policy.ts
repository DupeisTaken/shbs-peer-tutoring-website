/** Tutoring policy uses actual program-local dates, never the school timetable weekday. */
export type TutoringPauseRange = {
  date: string;
  endDate: string;
  active?: boolean;
  schedulingEffect?: string;
};

export function isRegularTutoringPaused(
  date: string,
  ranges: readonly TutoringPauseRange[],
) {
  return ranges.some(
    (range) =>
      range.active !== false &&
      range.schedulingEffect === "PAUSE_REGULAR" &&
      range.date <= date &&
      range.endDate >= date,
  );
}

/** Ignore reasons/editor versions; overlapping pauses remain independent sources. */
export function tutoringPauseSemanticRanges(ranges: readonly TutoringPauseRange[]) {
  return ranges
    .filter((range) => range.active !== false && range.schedulingEffect === "PAUSE_REGULAR")
    .map(({ date, endDate }) => [date, endDate] as const)
    .sort(([a, aEnd], [b, bEnd]) => a.localeCompare(b) || aEnd.localeCompare(bEnd));
}

export type TutoringPolicyRevision = TutoringPauseRange & { id: bigint; effectiveAt: Date };

/** Select the latest state of every source before testing its old/new endpoints.
 * Filtering active ranges first would revive a removed or shortened old pause. */
export function isRegularTutoringPausedAt(
  date: string,
  startsAt: Date,
  revisions: readonly TutoringPolicyRevision[],
) {
  const latest = new Map<string, TutoringPolicyRevision>();
  for (const revision of revisions) {
    if (revision.effectiveAt >= startsAt) continue;
    const previous = latest.get(revision.date);
    if (!previous || revision.effectiveAt > previous.effectiveAt ||
      (revision.effectiveAt.getTime() === previous.effectiveAt.getTime() && revision.id > previous.id))
      latest.set(revision.date, revision);
  }
  return isRegularTutoringPaused(date, [...latest.values()]);
}
