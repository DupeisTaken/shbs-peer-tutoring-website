import { expect, it } from "vitest";
import { recordedEvidenceDiff } from "./recorded-evidence-diff";

it("compares immutable recorded types and presence independently of key order", () => {
  const before = {
    stable: [true, 0, ""],
    nullValue: null,
    removed: false,
    type: "0",
  };
  const after = { type: 0, added: null, nullValue: "", stable: [true, 0, ""] };
  const snapshot = structuredClone(before);
  expect([...recordedEvidenceDiff(before, after)]).toEqual([
    ["/nullValue", "changed"],
    ["/removed", "removed"],
    ["/type", "changed"],
    ["/added", "added"],
  ]);
  expect(before).toEqual(snapshot);
  expect(recordedEvidenceDiff({}, { added: undefined }).get("/added")).toBe(
    "added",
  );
  expect(recordedEvidenceDiff(undefined, null, false, true).get("")).toBe(
    "added",
  );
});
it("preserves positional arrays and escaped unusual keys without inventing entity identity", () => {
  expect([
    ...recordedEvidenceDiff({ "a/b~c": ["old", null] }, { "a/b~c": ["new"] }),
  ]).toEqual([
    ["/a~1b~0c/0", "changed"],
    ["/a~1b~0c/1", "removed"],
  ]);
  expect(recordedEvidenceDiff([], {}).get("")).toBe("changed");
  expect(
    recordedEvidenceDiff({ nested: {} }, { nested: [] }).get("/nested"),
  ).toBe("changed");
});
it("ignores executable undo payloads recursively while preserving other recorded fields", () => {
  expect(
    recordedEvidenceDiff(
      { undoData: { password: "old" }, child: { undoData: 1, flag: true } },
      { undoData: "new", child: { undoData: 2, flag: true } },
    ).size,
  ).toBe(0);
  const before = {
    deepest: { one: { two: { three: { four: { value: 1 } } } } },
  };
  expect(
    recordedEvidenceDiff(before, {
      deepest: { one: { two: { three: { four: { value: 2 } } } } },
    }).get("/deepest/one/two/three/four/value"),
  ).toBe("changed");
});
