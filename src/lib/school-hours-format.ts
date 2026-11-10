/** School-account instructions retain the stored numeric value. Only display
 * negative zero as zero; neither component nor individual totals are rounded. */
export function formatSchoolHours(value: number, signed = false): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${signed && normalized > 0 ? "+" : ""}${normalized.toString()}`;
}

/** Carry is retained in the snapshot as exact decimal hours. This compact minute
 * label is informational only; it must never be used as a posting instruction.
 * Remove minute-conversion noise near whole minutes without losing tiny carries. */
export function formatSchoolHoursCarryMinutes(value: string): string {
  const minutes = Number(value) * 60;
  if (!Number.isFinite(minutes)) return "—";
  if (minutes === 0) return "0";
  const whole = Math.round(minutes);
  if (whole !== 0 && Math.abs(minutes - whole) <= 1e-10)
    return whole.toString();
  const rounded = Number(minutes.toFixed(4));
  if (rounded === 0) return "≈ 0";
  return rounded === minutes ? rounded.toString() : `≈ ${rounded}`;
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
