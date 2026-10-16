export type RecordedEvidenceChange = "added" | "removed" | "changed";

/** JSON-pointer paths compare recorded values only. Arrays compare positions,
 * never guessed entity IDs. Presence, JSON types and empty values remain distinct;
 * object key order and private executable undoData cannot create displayed changes. */
export function recordedEvidenceDiff(
  before: unknown,
  after: unknown,
  beforePresent = true,
  afterPresent = true,
): ReadonlyMap<string, RecordedEvidenceChange> {
  const changes = new Map<string, RecordedEvidenceChange>();
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const childPath = (path: string, key: string) =>
    `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
  const walk = (
    left: unknown,
    right: unknown,
    leftPresent: boolean,
    rightPresent: boolean,
    path: string,
  ) => {
    if (!leftPresent || !rightPresent) {
      changes.set(path, leftPresent ? "removed" : "added");
      return;
    }
    if (Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let index = 0; index < Math.max(left.length, right.length); index++)
        walk(
          left[index],
          right[index],
          index < left.length,
          index < right.length,
          childPath(path, String(index)),
        );
      return;
    }
    if (object(left) && object(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys)
        if (key !== "undoData")
          walk(
            left[key],
            right[key],
            Object.hasOwn(left, key),
            Object.hasOwn(right, key),
            childPath(path, key),
          );
      return;
    }
    changes.set(path, "changed");
  };
  walk(before, after, beforePresent, afterPresent, "");
  return changes;
}

export function evidenceChildPath(path: string, key: string): string {
  return `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}
