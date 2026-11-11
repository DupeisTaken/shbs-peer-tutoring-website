import { operatorAssert } from "./operator-cli";

const MAX_DELIVERY_ROWS = 10_000;
type DeliveryRow = Record<string, unknown>;
const isOriginal = (row: DeliveryRow) =>
  row.schoolHoursReminderSourceId === null ||
  row.schoolHoursReminderSourceId === undefined;

/** Recovery copies exact current rows under active foreign-key constraints.
 * A personal reminder may reference only an original receipt in that complete
 * snapshot. Validate the closure before returning any write order; neither
 * lexicographic row order nor existing target rows establish that authority. */
export function orderReconciledEmailDeliveries(
  rows: readonly DeliveryRow[],
): DeliveryRow[] {
  operatorAssert(
    rows.length <= MAX_DELIVERY_ROWS,
    "RECONCILIATION_DELIVERY_ROWS_EXCEEDED",
  );
  const byId = new Map<string, DeliveryRow>();
  const originals: DeliveryRow[] = [];
  const reminders: DeliveryRow[] = [];
  for (const row of rows) {
    operatorAssert(
      typeof row.id === "string" && row.id.length > 0 && !byId.has(row.id),
      "INVALID_RECONCILIATION_DELIVERY_IDENTITY",
    );
    byId.set(row.id, row);
    if (isOriginal(row)) originals.push(row);
    else {
      operatorAssert(
        typeof row.schoolHoursReminderSourceId === "string" &&
          row.schoolHoursReminderSourceId.length > 0,
        "INVALID_RECONCILIATION_DELIVERY_SOURCE",
      );
      reminders.push(row);
    }
  }
  for (const row of reminders) {
    const source = byId.get(row.schoolHoursReminderSourceId as string);
    operatorAssert(source, "RECONCILIATION_DELIVERY_SOURCE_MISSING");
    // This one-level model rejects nested, self and cyclic references in O(n),
    // without recursive graph traversal or relaxing the outbox's self-FK.
    operatorAssert(
      isOriginal(source),
      "RECONCILIATION_DELIVERY_SOURCE_NOT_ORIGINAL",
    );
    operatorAssert(
      row.category === "school_hours" &&
        source.category === "school_hours" &&
        typeof row.schoolHoursReportId === "string" &&
        row.schoolHoursReportId.length > 0 &&
        source.schoolHoursReportId === row.schoolHoursReportId &&
        typeof row.recipient === "string" &&
        row.recipient.length > 0 &&
        source.recipient === row.recipient,
      "RECONCILIATION_DELIVERY_SOURCE_SCOPE_MISMATCH",
    );
  }
  // Preserve every field and relative order within the two groups. Originals
  // precede both inserts and updates of reminders pointing to current-only roots.
  return [...originals, ...reminders];
}
