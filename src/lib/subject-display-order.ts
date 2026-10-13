/** Teaching intent is independent of qualifications. Missing intent has its own
 * place and label, rather than becoming an unwilling answer during sorting. */
export function sortTutorSubjectRows<
  T extends { qualified: boolean; willing: boolean | null },
>(rows: readonly T[]): T[] {
  const rank = (row: T) =>
    !row.qualified
      ? 3
      : row.willing === true
        ? 0
        : row.willing === false
          ? 1
          : 2;
  return [...rows].sort((a, b) => rank(a) - rank(b));
}
