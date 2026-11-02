/** School-account instructions retain the stored numeric value. Only display
 * negative zero as zero; neither component nor individual totals are rounded. */
export function formatSchoolHours(value: number, signed = false): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${signed && normalized > 0 ? "+" : ""}${normalized.toString()}`;
}
