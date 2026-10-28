/** PostgreSQL JSON timestamps omit the zone even though Prisma stores these
 * instants in UTC. Interpret only schema-owned timestamp values here; never
 * rewrite captured evidence, calendar-date strings or arbitrary user text. */
export function reviewInstant(value: Date | string): Date {
  return new Date(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)
      ? `${value}Z`
      : value,
  );
}

export function reviewInstantValue(value: unknown): unknown {
  if (typeof value !== "string" && !(value instanceof Date)) return value;
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T/.test(value))
    return value;
  const date = reviewInstant(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}
