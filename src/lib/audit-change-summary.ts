import {
  recordedEvidenceDiff,
  type RecordedEvidenceChange,
} from "./recorded-evidence-diff";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
type Side = { present: boolean; value: unknown };

/** A whole added/removed object still needs recursive redaction before another
 * consumer serializes the summary. Retain exact public values and presence. */
function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue);
  const object = record(value);
  return object
    ? Object.fromEntries(
        Object.entries(object)
          .filter(([key]) => key !== "undoData")
          .map(([key, item]) => [key, publicValue(item)]),
      )
    : value;
}
export type AuditSummaryComparison = {
  entity?: string;
  position?: number;
  beforeId?: string;
  afterId?: string;
  beforeRecord?: unknown;
  afterRecord?: unknown;
  fields: {
    path: string;
    change: RecordedEvidenceChange;
    before: Side;
    after: Side;
  }[];
};

/** Only recorded before/after envelopes are summarized. Arrays keep the existing
 * positional diff semantics; IDs label evidence but never rematch/reorder it.
 * Counts are diff values, not unique records or a replacement for affectedCount. */
export function auditChangeSummary(details: unknown, fallbackEntity?: string) {
  const root = record(details);
  if (!root) return null;
  // An explicit future version may change envelope semantics. Established
  // unversioned snapshots remain supported through the legacy reader contract.
  if (Object.hasOwn(root, "evidenceVersion") && root.evidenceVersion !== 1)
    return null;
  const paired = (value: RecordValue) =>
    Object.hasOwn(value, "before") || Object.hasOwn(value, "after");
  let batches: RecordValue[];
  if (paired(root)) batches = [root];
  else if (Array.isArray(root.changes)) {
    const entries = root.changes.map(record);
    // A partial summary could conceal an unknown entry. Fall back to the full
    // recorded reader unless every entry belongs to an established envelope.
    if (
      (root.evidenceVersion !== 1 && !entries.length) ||
      !entries.every(
        (value) =>
          value &&
          paired(value) &&
          (root.evidenceVersion === 1 ||
            (typeof value.entity === "string" &&
              typeof value.write === "string")),
      )
    )
      return null;
    batches = entries as RecordValue[];
  } else return null;
  const comparisons: AuditSummaryComparison[] = [];
  const capturedRecords: Pick<
    AuditSummaryComparison,
    "entity" | "beforeRecord" | "afterRecord"
  >[] = [];
  const counts = { added: 0, removed: 0, changed: 0 };
  let positional = false;
  const at = (value: unknown, present: boolean, path: string): Side => {
    for (const encoded of path.split("/").slice(1)) {
      const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
      present =
        present &&
        value !== null &&
        typeof value === "object" &&
        Object.hasOwn(value, key);
      value = present ? (value as RecordValue)[key] : undefined;
    }
    return { present, value: publicValue(value) };
  };
  for (const batch of batches) {
    const entity =
      typeof batch.entity === "string"
        ? batch.entity
        : typeof root.entity === "string"
          ? root.entity
          : fallbackEntity;
    const before = batch.before,
      after = batch.after;
    const pairs =
      Array.isArray(before) && Array.isArray(after)
        ? Array.from(
            { length: Math.max(before.length, after.length) },
            (_, index) => ({
              position: index + 1,
              before: before[index] as unknown,
              after: after[index] as unknown,
              beforePresent: index < before.length,
              afterPresent: index < after.length,
            }),
          )
        : [
            {
              before: batch.before,
              after: batch.after,
              beforePresent: Object.hasOwn(batch, "before"),
              afterPresent: Object.hasOwn(batch, "after"),
              position: undefined,
            },
          ];
    positional ||= Array.isArray(before) && Array.isArray(after);
    for (const pair of pairs) {
      const fields = [
        ...recordedEvidenceDiff(
          pair.before,
          pair.after,
          pair.beforePresent,
          pair.afterPresent,
        ),
      ].map(([path, change]) => {
        counts[change]++;
        return {
          path,
          change,
          before: at(pair.before, pair.beforePresent, path),
          after: at(pair.after, pair.afterPresent, path),
        };
      });
      const recorded = {
        entity,
        ...(pair.beforePresent
          ? { beforeRecord: publicValue(pair.before) }
          : {}),
        ...(pair.afterPresent ? { afterRecord: publicValue(pair.after) } : {}),
      };
      capturedRecords.push(recorded);
      if (!fields.length) continue;
      const beforeId = record(pair.before)?.id,
        afterId = record(pair.after)?.id;
      comparisons.push({
        position: pair.position,
        fields,
        ...recorded,
        ...(typeof beforeId === "string" ? { beforeId } : {}),
        ...(typeof afterId === "string" ? { afterId } : {}),
      });
    }
  }
  return { comparisons, counts, positional, capturedRecords };
}
