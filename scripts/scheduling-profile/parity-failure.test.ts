import assert from "node:assert/strict";
import test from "node:test";
import { boundedParityDifference } from "./parity";

void test("first nested difference uses deterministic alphabetical keys without changing inputs", () => {
  const actual = Object.freeze({ tables: Object.freeze({ value: "later" }), clockEvidence: Object.freeze([{ relation: -1 }]) });
  const expected = Object.freeze({ clockEvidence: Object.freeze([{ relation: 1 }]), tables: Object.freeze({ value: "earlier" }) });
  const result = boundedParityDifference(actual, expected);
  assert.ok(result);
  assert.equal(result?.path, "/clockEvidence/0/relation");
  assert.equal(result?.kind, "scalar");
  assert.equal(result.actualPreview, "-1");
  assert.equal(result.expectedPreview, "1");
  assert.equal(result.truncated, false);
  assert.equal(actual.clockEvidence[0]?.relation, -1);
  assert.equal(boundedParityDifference({ a: [null, true, 4] }, { a: [null, true, 4] }), null);
});

void test("array order, length and scalar type are separate differences", () => {
  assert.equal(boundedParityDifference(["b", "a"], ["a", "b"])?.path, "/0");
  const length = boundedParityDifference({ rows: [1, 2] }, { rows: [1] });
  assert.ok(length);
  assert.equal(length?.path, "/rows");
  assert.equal(length?.kind, "array-length");
  assert.equal(length.actualPreview, "2");
  assert.equal(length.expectedPreview, "1");
  assert.equal(boundedParityDifference("1", 1)?.kind, "type");
});

void test("missing and extra keys are explicit and JSON-pointer segments are escaped", () => {
  const missing = boundedParityDifference({ z: 1 }, { "a/~b": 2, z: 1 });
  assert.ok(missing);
  assert.equal(missing?.path, "/a~1~0b");
  assert.equal(missing?.kind, "missing-key");
  assert.equal(missing.actualPreview, "[missing]");
  const extra = boundedParityDifference({ "": { "~/": true }, z: 1 }, { "": {}, z: 1 });
  assert.ok(extra);
  assert.equal(extra?.path, "//~0~1");
  assert.equal(extra?.kind, "extra-key");
  assert.equal(extra.expectedPreview, "[missing]");
});

void test("huge scalar payload produces a bounded diagnostic and assertion message", () => {
  const payload = "\n\"\\".repeat(1_000_000);
  const result = boundedParityDifference({ payload }, { payload: "different" });
  assert.ok(result);
  assert.equal(result.path, "/payload");
  assert.ok(result.actualPreview.length <= 160);
  assert.ok(result.expectedPreview.length <= 160);
  assert.throws(() => assert.ok(false, JSON.stringify(result)), (error: unknown) =>
    error instanceof assert.AssertionError && error.message.length < 1024);
});

void test("node budget exhaustion is inconclusive, never equality or a later mismatch", () => {
  const same = Array.from({ length: 25_000 }, () => 0);
  const result = boundedParityDifference(same, same, { maxVisitedNodes: 20_000 });
  assert.equal(result?.kind, "truncated");
  assert.equal(result?.reason, "visited-nodes");
  assert.equal(result?.visitedNodes, 20_000);
  assert.equal(result?.truncated, true);
  const tiny = boundedParityDifference([0, 1], [0, 2], { maxVisitedNodes: 2 });
  assert.equal(tiny?.reason, "visited-nodes");
  assert.equal(tiny?.path, "/1");
  const wide = Object.fromEntries(Array.from({ length: 20_001 }, (_, index) => [`key${index}`, 0]));
  assert.equal(boundedParityDifference(wide, wide, { maxVisitedNodes: 20_000 })?.reason, "visited-nodes");
});

void test("default node ceiling remains bounded for a larger retained graph", () => {
  const same = Array.from({ length: 200_001 }, () => 0);
  const result = boundedParityDifference(same, same);
  assert.equal(result?.kind, "truncated");
  assert.equal(result?.reason, "visited-nodes");
  assert.equal(result?.visitedNodes, 200_000);
  assert.equal(result?.truncated, true);
});

void test("depth, path and cycle limits return explicit bounded truncation", () => {
  const nested = { a: { b: { c: 1 } } };
  const depth = boundedParityDifference(nested, nested, { maxDepth: 1 });
  assert.equal(depth?.reason, "depth");
  assert.equal(depth?.path, "/a/b");
  const hugeKey = "~/".repeat(100_000);
  const path = boundedParityDifference({ [hugeKey]: 1 }, { [hugeKey]: 2 });
  assert.equal(path?.reason, "path-length");
  assert.equal(path?.path, "");
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.equal(boundedParityDifference(cycle, cycle)?.reason, "depth");
  assert.equal(boundedParityDifference(undefined, undefined)?.reason, "non-json-value");
});
