import { expect, it } from "vitest";
import { auditChangeSummary } from "./audit-change-summary";
import { recordedEvidenceDiff } from "./recorded-evidence-diff";

it("summarizes canonical batches without confusing values with records", () => {
  const evidence = {
    evidenceVersion: 1,
    changes: [
      {
        entity: "Tutee",
        write: "updateMany",
        affectedCount: 2,
        before: [
          { id: "a", active: false, hours: 0, note: null },
          { id: "b", active: true },
        ],
        after: [
          { id: "a", active: true, hours: 0 },
          { id: "b", active: true },
        ],
      },
    ],
  };
  const original = structuredClone(evidence);
  const summary = auditChangeSummary(evidence)!;
  expect(summary.counts).toEqual({ changed: 1, removed: 1, added: 0 });
  expect(summary.comparisons).toHaveLength(1);
  expect(summary.comparisons[0]?.fields[1]).toMatchObject({
    before: { present: true, value: null },
    after: { present: false },
  });
  expect(evidence).toEqual(original);
});

it("retains positional reorder semantics and excludes private undoData recursively", () => {
  const summary = auditChangeSummary({
    before: [{ id: "a" }, { id: "b" }],
    after: [{ id: "b" }, { id: "a" }],
  })!;
  expect(summary.positional).toBe(true);
  expect(summary.counts.changed).toBe(2);
  expect(summary.comparisons[0]).toMatchObject({
    beforeId: "a",
    afterId: "b",
    position: 1,
  });
  expect(
    auditChangeSummary({
      before: { a: { undoData: "secret" } },
      after: { a: { undoData: "changed" } },
    })?.counts.changed,
  ).toBe(0);
});

it("supports missing sides, escaped paths, legacy roots and unknown fallback", () => {
  const summary = auditChangeSummary({
    before: { "a/b~": false },
    after: { "a/b~": 0, empty: "" },
  })!;
  expect(summary.comparisons[0]?.fields[0]).toMatchObject({
    path: "/a~1b~0",
    before: { value: false },
    after: { value: 0 },
  });
  expect(auditChangeSummary({ after: null })?.counts.added).toBe(1);
  expect(
    auditChangeSummary({
      changes: [{ before: "unknown envelope", after: "x" }],
    }),
  ).toBeNull();
  expect(auditChangeSummary(null)).toBeNull();
});

it("retains all comparisons in large batches", () => {
  const before = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    value: i,
  }));
  expect(
    auditChangeSummary({
      before,
      after: before.map((row) => ({ ...row, value: row.value + 1 })),
    })?.counts.changed,
  ).toBe(100);
});

it("counts the same values as the existing diff across reordered, added and removed positions", () => {
  const before = [
    { id: "a", value: false },
    { id: "b", value: 0 },
    { id: "c", value: null },
  ];
  const after = [
    { id: "b", value: 0 },
    { id: "a", value: false },
  ];
  const summary = auditChangeSummary({ before, after })!;
  const expected = { added: 0, removed: 0, changed: 0 };
  for (const change of recordedEvidenceDiff(before, after).values())
    expected[change]++;
  expect(summary.counts).toEqual(expected);
  expect(
    summary.comparisons.map(({ position, beforeId, afterId }) => ({
      position,
      beforeId,
      afterId,
    })),
  ).toEqual([
    { position: 1, beforeId: "a", afterId: "b" },
    { position: 2, beforeId: "b", afterId: "a" },
    { position: 3, beforeId: "c", afterId: undefined },
  ]);
  expect(summary.comparisons[2]?.fields).toEqual([
    {
      path: "",
      change: "removed",
      before: { present: true, value: before[2] },
      after: { present: false, value: undefined },
    },
  ]);
  expect(
    auditChangeSummary({ before: [], after: [{ id: "new", flag: false }] })
      ?.counts,
  ).toEqual({ added: 1, removed: 0, changed: 0 });
});

it("preserves exact timestamp, type and presence distinctions in summary fields", () => {
  const summary = auditChangeSummary({
    before: {
      id: "same",
      value: "0",
      time: "2026-10-09T01:23:45.678Z",
      gone: false,
    },
    after: {
      id: "same",
      value: 0,
      time: "2026-10-09T01:23:45.679Z",
      added: null,
      empty: "",
    },
  })!;
  expect(summary.counts).toEqual({ changed: 2, added: 2, removed: 1 });
  expect(summary.comparisons[0]?.fields).toContainEqual({
    path: "/value",
    change: "changed",
    before: { present: true, value: "0" },
    after: { present: true, value: 0 },
  });
  expect(summary.comparisons[0]?.fields).toContainEqual({
    path: "/gone",
    change: "removed",
    before: { present: true, value: false },
    after: { present: false, value: undefined },
  });
  expect(summary.comparisons[0]?.fields).toContainEqual({
    path: "/added",
    change: "added",
    before: { present: false, value: undefined },
    after: { present: true, value: null },
  });
  expect(summary.comparisons[0]?.fields).toContainEqual({
    path: "/time",
    change: "changed",
    before: { present: true, value: "2026-10-09T01:23:45.678Z" },
    after: { present: true, value: "2026-10-09T01:23:45.679Z" },
  });
});

it("redacts undoData inside whole added and removed objects without mutating the evidence", () => {
  const details = {
    before: {
      removed: {
        id: "old",
        undoData: "private-old",
        children: [{ undoData: "private-child", zero: 0 }],
      },
    },
    after: {
      added: {
        id: "new",
        undoData: "private-new",
        nested: { undoData: "private-deep", flag: false },
      },
    },
  };
  const original = structuredClone(details);
  const summary = auditChangeSummary(details)!;
  expect(summary.counts).toEqual({ removed: 1, added: 1, changed: 0 });
  expect(summary.comparisons[0]?.fields[0]?.before.value).toEqual({
    id: "old",
    children: [{ zero: 0 }],
  });
  expect(summary.comparisons[0]?.fields[1]?.after.value).toEqual({
    id: "new",
    nested: { flag: false },
  });
  expect(JSON.stringify(summary)).not.toMatch(/undoData|private-/);
  expect(details).toEqual(original);
});

it("falls back for unknown and partially known batches instead of silently dropping their entries", () => {
  const known = {
    entity: "Tutee",
    write: "update",
    before: { id: "a" },
    after: { id: "b" },
  };
  expect(auditChangeSummary({ changes: [known] })?.counts.changed).toBe(1);
  expect(
    auditChangeSummary({
      changes: [known, { note: "Unknown legacy context" }],
    }),
  ).toBeNull();
  expect(
    auditChangeSummary({ evidenceVersion: 1, changes: [known, null] }),
  ).toBeNull();
  expect(
    auditChangeSummary({ evidenceVersion: 2, changes: [known] }),
  ).toBeNull();
  expect(
    auditChangeSummary({ evidenceVersion: 2, before: "old", after: "new" }),
  ).toBeNull();
  expect(auditChangeSummary({ changes: [] })).toBeNull();
  expect(auditChangeSummary({ evidenceVersion: 1, changes: [] })).toEqual({
    comparisons: [],
    counts: { added: 0, removed: 0, changed: 0 },
    positional: false,
  });
  expect(auditChangeSummary({ before: [], after: [] })?.positional).toBe(true);
});
