/** Group-oriented displays and historical snapshots retain their catalogue order. */
export const subjectOrderBy = [
  { group: { rank: "asc" } },
  { groupId: "asc" },
  { level: { rank: "asc" } },
  { level: { id: "asc" } },
  { id: "asc" },
] as const;

type ChoiceLevel = { id: string; rank: number; prefix: string };
type CourseChoice = {
  id: string;
  name: string;
  baseName: string;
  level: ChoiceLevel | null;
};
const courseCollator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

/** Picker order is level-first. Unlevelled courses share the configured unprefixed
 * tier without changing their stored level; all ties have a stable ID fallback. */
export function sortCourseChoices<T extends CourseChoice>(
  subjects: readonly T[],
  levels: readonly ChoiceLevel[],
): T[] {
  const orderedLevels = [...levels].sort(
    (a, b) => a.rank - b.rank || a.id.localeCompare(b.id),
  );
  const regular =
    orderedLevels.find((level) => !level.prefix.trim()) ?? orderedLevels[0];
  const tier = (subject: T) => subject.level ?? regular;
  const baseName = (subject: T) => {
    if (subject.baseName.trim()) return subject.baseName.trim();
    // Legacy records may lack baseName. Strip only their own configured prefix.
    const prefix = subject.level?.prefix.trim();
    return prefix &&
      subject.name.toLowerCase().startsWith(`${prefix.toLowerCase()} `)
      ? subject.name.slice(prefix.length).trim()
      : subject.name.trim();
  };
  return [...subjects].sort(
    (a, b) =>
      (tier(a)?.rank ?? 0) - (tier(b)?.rank ?? 0) ||
      (tier(a)?.id ?? "").localeCompare(tier(b)?.id ?? "") ||
      courseCollator.compare(baseName(a), baseName(b)) ||
      a.id.localeCompare(b.id),
  );
}

export function courseName(baseName: string, prefix: string) {
  return [prefix.trim(), baseName.trim()].filter(Boolean).join(" ");
}

type Offering = {
  id: string;
  groupId: string | null;
  active: boolean;
  level: { id: string; rank: number; name: string; active: boolean } | null;
};

/** Resolve only at approval. Consumers must read the persisted result, never recalculate. */
export function inheritedSubjectIds(source: Offering, offerings: Offering[]) {
  if (!source.groupId || !source.level) return [source.id];
  const level = source.level;
  return offerings
    .filter(
      (candidate) =>
        candidate.id === source.id ||
        (candidate.groupId === source.groupId &&
          candidate.active &&
          candidate.level?.active &&
          (candidate.level.rank < level.rank ||
            (candidate.level.rank === level.rank &&
              candidate.level.id <= level.id))),
    )
    .map((candidate) => candidate.id);
}
