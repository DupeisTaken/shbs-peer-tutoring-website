/** School-account instructions retain the stored numeric value. Only display
 * negative zero as zero; neither component nor individual totals are rounded. */
export function formatSchoolHours(value: number, signed = false): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${signed && normalized > 0 ? "+" : ""}${normalized.toString()}`;
}

/** Four-place summaries follow the monthly overview convention, but are never
 * posting instructions. Callers must label them approximate and retain the exact
 * value. A tiny nonzero credit must never appear as zero, even in a summary. */
export function schoolHoursApproximation(
  value: number,
  signed = false,
): string | null {
  const rounded = Number(value.toFixed(4));
  return rounded === value || rounded === 0 || !Number.isFinite(value)
    ? null
    : formatSchoolHours(rounded, signed);
}
