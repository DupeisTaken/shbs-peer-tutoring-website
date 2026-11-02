/** Presentation only. Keep every participant in the private reporting baseline;
 * a zero net can still contain component changes. Revisions retain unchanged
 * people so recipients can see that an earlier amount must not be applied twice. */
export function schoolHoursVisibleRows<
  T extends { unchanged: boolean },
>(report: { revision: number; rows: readonly T[] }): T[] {
  return report.revision > 1
    ? [...report.rows]
    : report.rows.filter((row) => !row.unchanged);
}
