/** One ordering contract for every selection pane; ties are deterministic. */
export const subjectOrderBy = [
  { group: { rank: "asc" } },
  { groupId: "asc" },
  { level: { rank: "asc" } },
  { level: { id: "asc" } },
  { id: "asc" },
] as const;

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
