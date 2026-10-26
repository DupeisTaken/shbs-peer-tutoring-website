import { recordedEvidenceDiff } from "./recorded-evidence-diff";

export type ReviewCollectionRow = {
  id: string;
  state: "added" | "removed" | "changed" | "unchanged";
  before?: unknown;
  requested?: unknown;
};

/** Compare only schema-owned instant fields across JSON capture and SuperJSON
 * restoration. Stored/requested values stay untouched, including invalid text. */
export function reviewCollectionFieldEqual(
  before: unknown,
  requested: unknown,
  key: string,
  dateFields: readonly string[],
  beforePresent = true,
  requestedPresent = true,
) {
  const instant = (value: unknown) => {
    if (
      !dateFields.includes(key) ||
      (typeof value !== "string" && !(value instanceof Date))
    )
      return value;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : value;
  };
  return !recordedEvidenceDiff(
    instant(before),
    instant(requested),
    beforePresent,
    requestedPresent,
  ).size;
}

/** Only the owning operation supplies identity. Unknown/duplicate historical
 * shapes fall back to complete evidence; array positions never invent identity. */
export function reviewCollection(
  before: unknown,
  requested: unknown,
  identity: string,
  dateFields: readonly string[] = [],
) {
  if (!Array.isArray(before) || !Array.isArray(requested)) return null;
  const index = (items: unknown[]) => {
    const rows = new Map<string, unknown>();
    for (const item of items) {
      const id: unknown =
        typeof item === "string"
          ? item
          : item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>)[identity]
            : undefined;
      if (typeof id !== "string" || !id || rows.has(id)) return null;
      rows.set(id, item);
    }
    return rows;
  };
  const left = index(before),
    right = index(requested);
  if (!left || !right) return null;
  const equal = (before: unknown, requested: unknown) => {
    if (
      !before ||
      !requested ||
      typeof before !== "object" ||
      typeof requested !== "object" ||
      Array.isArray(before) ||
      Array.isArray(requested)
    )
      return !recordedEvidenceDiff(before, requested).size;
    const a = before as Record<string, unknown>,
      b = requested as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((key) => key !== "undoData")
      .every((key) =>
        reviewCollectionFieldEqual(
          a[key],
          b[key],
          key,
          dateFields,
          Object.hasOwn(a, key),
          Object.hasOwn(b, key),
        ),
      );
  };
  const rows: ReviewCollectionRow[] = [
    ...new Set([...right.keys(), ...left.keys()]),
  ].map((id) => ({
    id,
    state: !left.has(id)
      ? "added"
      : !right.has(id)
        ? "removed"
        : equal(left.get(id), right.get(id))
          ? "unchanged"
          : "changed",
    ...(left.has(id) ? { before: left.get(id) } : {}),
    ...(right.has(id) ? { requested: right.get(id) } : {}),
  }));
  return {
    identity,
    dateFields,
    rows,
    counts: Object.fromEntries(
      (["added", "removed", "changed", "unchanged"] as const).map((state) => [
        state,
        rows.filter((row) => row.state === state).length,
      ]),
    ) as Record<ReviewCollectionRow["state"], number>,
  };
}
