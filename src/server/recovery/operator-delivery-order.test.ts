import { expect, it } from "vitest";
import { OperatorError } from "./operator-cli";
import { orderReconciledEmailDeliveries } from "./operator-delivery-order";

function root(id = "z-original"): Record<string, unknown> {
  return {
    id,
    category: "school_hours",
    schoolHoursReportId: "synthetic-saved-report",
    recipient: "synthetic-office@example.test",
    schoolHoursReminderSourceId: null,
    schoolHoursSendKey: "initial",
    schoolHoursScheduledFor: null,
    schoolHoursReminderLinkVersion: null,
    schoolHoursReminderIntentHash: null,
    schoolHoursLinkOpenedAt: "2026-11-11T01:00:00Z",
    status: "SENT",
    context: null,
  };
}
function reminder(
  id = "a-reminder",
  source = "z-original",
): Record<string, unknown> {
  return {
    ...root(id),
    schoolHoursReminderSourceId: source,
    schoolHoursSendKey: `reminder:${id}`,
    schoolHoursScheduledFor: "2026-11-12T01:00:00Z",
    schoolHoursReminderLinkVersion: 1,
    schoolHoursReminderIntentHash: "a".repeat(64),
    status: "PENDING",
  };
}
function expectFault(rows: Record<string, unknown>[], code: string) {
  expect(() => orderReconciledEmailDeliveries(rows)).toThrow(OperatorError);
  expect(() => orderReconciledEmailDeliveries(rows)).toThrow(code);
}

it("orders originals before adversarially sorted reminders without changing fields or input", () => {
  const firstRoot = Object.freeze(root("z-first"));
  const secondRoot = Object.freeze(root("z-second"));
  const firstReminder = Object.freeze(reminder("a-first", "z-first"));
  const secondReminder = Object.freeze(reminder("a-second", "z-second"));
  const rows = Object.freeze([
    firstReminder,
    secondRoot,
    secondReminder,
    firstRoot,
  ]);
  const before = JSON.stringify(rows);
  const ordered = orderReconciledEmailDeliveries(rows);
  expect(ordered).toEqual([
    secondRoot,
    firstRoot,
    firstReminder,
    secondReminder,
  ]);
  expect(ordered).not.toBe(rows);
  expect(ordered[0]).toBe(secondRoot);
  expect(ordered[2]).toBe(firstReminder);
  expect(JSON.stringify(rows)).toBe(before);
  expect(ordered[2]).toMatchObject({
    schoolHoursReminderSourceId: "z-first",
    schoolHoursScheduledFor: "2026-11-12T01:00:00Z",
    schoolHoursReminderLinkVersion: 1,
    schoolHoursReminderIntentHash: "a".repeat(64),
    status: "PENDING",
  });
});

it("inserts a current-only root before updating an existing reminder to reference it", () => {
  const rows = [reminder(), root()];
  // The target's existing reminder referenced an older root. Its current source
  // must be inserted before updating that reminder under the immediate self-FK.
  const targetIds = new Set(["a-reminder", "old-original"]);
  const writes: string[] = [];
  for (const row of orderReconciledEmailDeliveries(rows)) {
    if (typeof row.schoolHoursReminderSourceId === "string")
      expect(targetIds.has(row.schoolHoursReminderSourceId)).toBe(true);
    const id = String(row.id);
    writes.push(`${targetIds.has(id) ? "update" : "insert"}:${id}`);
    targetIds.add(id);
  }
  expect(writes).toEqual(["insert:z-original", "update:a-reminder"]);
});

it("keeps legacy deliveries with absent or null reminder-source fields readable", () => {
  const legacy = { id: "legacy-mail", category: "security", status: "SENT" };
  const explicitNull = {
    ...legacy,
    id: "legacy-null",
    schoolHoursReminderSourceId: null,
  };
  expect(orderReconciledEmailDeliveries([legacy, explicitNull])).toEqual([
    legacy,
    explicitNull,
  ]);
  expect(orderReconciledEmailDeliveries([])).toEqual([]);
});

it("accepts an original with an absent legacy source field as a reminder root", () => {
  const legacy = root();
  delete legacy.schoolHoursReminderSourceId;
  const child = reminder();
  expect(orderReconciledEmailDeliveries([child, legacy])).toEqual([
    legacy,
    child,
  ]);
});

it("requires the complete current source closure even when the target might have that id", () => {
  expectFault([reminder()], "RECONCILIATION_DELIVERY_SOURCE_MISSING");
});

it.each([
  { rows: [reminder("self", "self")] },
  { rows: [reminder("first", "second"), reminder("second", "first")] },
  { rows: [reminder("nested", "a-reminder"), reminder(), root()] },
])("rejects self, cyclic and nested reminder roots %#", ({ rows }) => {
  expectFault(rows, "RECONCILIATION_DELIVERY_SOURCE_NOT_ORIGINAL");
});

const wrongScopes: Record<string, unknown>[][] = [
  [{ ...reminder(), category: "messages" }, root()],
  [reminder(), { ...root(), category: "messages" }],
  [{ ...reminder(), schoolHoursReportId: "another-report" }, root()],
  [{ ...reminder(), schoolHoursReportId: null }, root()],
  [{ ...reminder(), schoolHoursReportId: "" }, root()],
  [{ ...reminder(), recipient: "another-office@example.test" }, root()],
  [{ ...reminder(), recipient: null }, root()],
  [{ ...reminder(), recipient: "" }, root()],
];
it.each(wrongScopes.map((rows) => ({ rows })))(
  "rejects cross-category, report or mailbox source scope %#",
  ({ rows }) => {
    expectFault(rows, "RECONCILIATION_DELIVERY_SOURCE_SCOPE_MISMATCH");
  },
);

it.each(["", 1, false, {}])(
  "rejects malformed source references %j",
  (source) => {
    expectFault(
      [{ ...reminder(), schoolHoursReminderSourceId: source }, root()],
      "INVALID_RECONCILIATION_DELIVERY_SOURCE",
    );
  },
);

it("rejects duplicate or absent row identities rather than choosing an arbitrary root", () => {
  expectFault([root(), root()], "INVALID_RECONCILIATION_DELIVERY_IDENTITY");
  expectFault(
    [{ ...root(), id: null }],
    "INVALID_RECONCILIATION_DELIVERY_IDENTITY",
  );
  expectFault(
    [{ ...root(), id: "" }],
    "INVALID_RECONCILIATION_DELIVERY_IDENTITY",
  );
});

it("handles the full bounded snapshot iteratively and rejects an oversized input", () => {
  const roots = Array.from({ length: 5000 }, (_, index) =>
    root(`root-${index}`),
  );
  const reminders = roots.map((row, index) =>
    reminder(`child-${index}`, String(row.id)),
  );
  const rows = [...reminders, ...roots];
  const ordered = orderReconciledEmailDeliveries(rows);
  expect(ordered).toHaveLength(10000);
  expect(ordered.slice(0, roots.length)).toEqual(roots);
  expect(ordered.slice(roots.length)).toEqual(reminders);
  expectFault(
    [...rows, root("overflow")],
    "RECONCILIATION_DELIVERY_ROWS_EXCEEDED",
  );
});
