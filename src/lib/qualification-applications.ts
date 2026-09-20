export type QualificationSnapshot = { id: string; name: string }[];

/** Treat persisted JSON as data at the display boundary; never derive old grants from new ranks. */
export function qualificationSnapshot(value: unknown): QualificationSnapshot {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (item && typeof item === "object" && "id" in item && "name" in item &&
      typeof item.id === "string" && typeof item.name === "string")
      return [{ id: item.id, name: item.name }];
    return [];
  });
}
