import type { AuditSummaryComparison } from "./audit-change-summary";
import { auditReferenceEntity, reviewEntity } from "./review-vocabulary";

const record = (value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
export function auditCapturedName(value: unknown): string | undefined {
  const row = record(value);
  return [
    row?.englishName,
    row?.name,
    row?.title,
    row?.username,
    [row?.firstName, row?.lastName]
      .filter((item) => typeof item === "string" && item.trim())
      .join(" "),
  ].find((item): item is string => typeof item === "string" && !!item.trim());
}
export type AuditReferenceResolution = {
  state: "recorded" | "missing" | "ambiguous";
  name?: string;
};

/** No identity matching affects the diff. Names decorate IDs only when this very
 * event captures an unambiguous entity+ID+side; conflicts retain the exact ID. */
export function auditCapturedReferences(
  comparisons: readonly Pick<
    AuditSummaryComparison,
    "entity" | "beforeRecord" | "afterRecord"
  >[],
  describe: (
    record: unknown,
    entity: string,
  ) => string | undefined = auditCapturedName,
) {
  const names = new Map<string, string | null>();
  for (const comparison of comparisons)
    for (const side of ["before", "after"] as const) {
      const value = record(comparison[`${side}Record`]);
      const entity = reviewEntity(comparison.entity);
      const name = entity ? describe(value, entity) : undefined;
      if (!value || typeof value.id !== "string" || !entity || !name) continue;
      const key = `${side}\0${entity}\0${value.id}`;
      names.set(key, names.has(key) && names.get(key) !== name ? null : name);
    }
  const resolve = (
    entity: string | undefined,
    field: string,
    id: string,
    side: "before" | "after",
  ): AuditReferenceResolution => {
    const target =
      field === "id"
        ? reviewEntity(entity)
        : auditReferenceEntity(entity, field);
    if (!target) return { state: "missing" };
    const key = `${side}\0${target}\0${id}`;
    if (!names.has(key)) return { state: "missing" };
    const name = names.get(key);
    return name === null ? { state: "ambiguous" } : { state: "recorded", name };
  };
  // Keep the existing label-only callable for headings; detailed readers also
  // receive the reason a name cannot be selected without guessing.
  return Object.assign(
    (...args: Parameters<typeof resolve>) => resolve(...args).name,
    { resolve },
  );
}

/** JSON pointers stay available as exact evidence. Localize only a direct field,
 * never guess the meaning of a nested object or an array's recorded position. */
export function auditDirectField(path: string): string | null {
  return /^\/[^/]+$/.test(path)
    ? path.slice(1).replaceAll("~1", "/").replaceAll("~0", "~")
    : null;
}

export function auditComparisonIdentity(comparison: AuditSummaryComparison) {
  const before = auditCapturedName(comparison.beforeRecord);
  const after = auditCapturedName(comparison.afterRecord);
  return before && after && before !== after
    ? `${before} → ${after}`
    : (after ?? before);
}

/** A record without a title can still be recognized through its captured typed
 * links and schedule. These facts decorate the comparison, never define identity. */
export function auditComparisonFacts(comparison: AuditSummaryComparison) {
  const entity = reviewEntity(comparison.entity);
  const keys =
    entity === "Pairing"
      ? ["tutorId", "subject", "subjectId", "timeSlotId", "roomId"]
      : entity === "PairingTutee"
        ? ["pairingId", "tuteeId"]
        : entity === "SessionTutee"
          ? ["sessionId", "tuteeId"]
          : entity === "Session"
            ? ["tutorId", "date", "startMin", "endMin"]
            : entity === "PatrolObservation"
              ? ["roomId", "observedAt"]
              : [];
  const before = record(comparison.beforeRecord),
    after = record(comparison.afterRecord);
  return keys.flatMap((key) => {
    const left = before?.[key],
      right = after?.[key];
    return left !== undefined || right !== undefined
      ? [{ key, before: left, after: right }]
      : [];
  });
}
