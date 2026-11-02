type TitleTranslator = {
  (key: string): string;
  has: (key: string) => boolean;
};

/** Stored operation/action strings are diagnostic evidence, not titles. Known
 * operations use authored translations; unknown events get a truthful category. */
export function eventTitle(
  t: TitleTranslator,
  event: {
    operation?: string | null;
    kind?: string | null;
    entity?: string | null;
  },
): string {
  const key = `approvals.review.operations.${event.operation?.replaceAll(".", "_") ?? ""}`;
  if (event.operation && t.has(key)) return t(key);
  const kind = [
    "DECISION",
    "SUBMISSION",
    "CANCELLATION",
    "REVERSAL",
    "ATTEMPT",
  ].includes(event.kind ?? "")
    ? event.kind
    : "ACTION";
  const title = t(`eventTitles.${kind}`);
  const entityKey = `approvals.review.entities.${event.entity ?? ""}`;
  return event.entity && t.has(entityKey)
    ? `${title} · ${t(entityKey)}`
    : title;
}
