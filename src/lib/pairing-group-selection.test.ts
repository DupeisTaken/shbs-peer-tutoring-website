import { describe, expect, it } from "vitest";
import {
  combineSelectionOptions,
  resolveCombineAddition,
  resolveCombineRemoval,
  type CombineSelectableEntry,
} from "./pairing-group-selection";

function entry(
  id: string,
  pairings: { subject: string; tutees: string[] }[],
  selectable = true,
): CombineSelectableEntry {
  return {
    id,
    selectable,
    pairings: pairings.map((p, index) => ({
      id: `${id}-p${index}`,
      subject: p.subject,
      tutees: p.tutees.map((tuteeId) => ({ tuteeId })),
    })),
  };
}

describe("pairing-group-selection", () => {
  const exampleEntries = [
    entry("x-a", [{ subject: "A", tutees: ["x"] }]),
    entry("x-b", [{ subject: "B", tutees: ["x"] }]),
    entry("y-a", [{ subject: "A", tutees: ["y"] }]),
    entry("y-b", [{ subject: "B", tutees: ["y"] }]),
    entry("z-a", [{ subject: "A", tutees: ["z"] }]),
  ];

  const enabledIds = (
    entries: readonly CombineSelectableEntry[],
    selected: readonly string[],
  ) => {
    const map = combineSelectionOptions(entries, selected);
    return entries
      .filter((item) => map.get(item.id)?.enabled)
      .map((item) => item.id);
  };

  it("enables all compatible entries initially when every entry has a valid partner", () => {
    expect(enabledIds(exampleEntries, [])).toEqual([
      "x-a",
      "x-b",
      "y-a",
      "y-b",
      "z-a",
    ]);
  });

  it("restricts selection to same-subject pairings when z(A) is ticked", () => {
    expect(enabledIds(exampleEntries, ["z-a"])).toEqual(["x-a", "y-a", "z-a"]);
    expect(resolveCombineAddition(exampleEntries, ["z-a"], "x-b")).toBeNull();
    expect(resolveCombineAddition(exampleEntries, ["z-a"], "y-b")).toBeNull();
  });

  it("allows only axis-connected entries x(B), y(A), and z(A) when x(A) is ticked (greying out y(B))", () => {
    expect(enabledIds(exampleEntries, ["x-a"])).toEqual([
      "x-a",
      "x-b",
      "y-a",
      "z-a",
    ]);
    expect(resolveCombineAddition(exampleEntries, ["x-a"], "y-b")).toBeNull();
  });

  it("auto-ticks the companion entry when adding y(A) or y(B) to [x(A), x(B)], and disables z(A)", () => {
    const options = combineSelectionOptions(exampleEntries, ["x-a", "x-b"]);
    expect(options.get("z-a")?.enabled).toBe(false);
    expect(options.get("y-a")).toEqual({
      enabled: true,
      autoSelectedIds: ["y-b"],
    });
    expect(options.get("y-b")).toEqual({
      enabled: true,
      autoSelectedIds: ["y-a"],
    });

    expect(
      resolveCombineAddition(exampleEntries, ["x-a", "x-b"], "y-a"),
    ).toEqual({
      nextSelectedIds: ["x-a", "x-b", "y-a", "y-b"],
      autoSelectedIds: ["y-b"],
    });
    expect(
      resolveCombineAddition(exampleEntries, ["x-a", "x-b"], "y-b"),
    ).toEqual({
      nextSelectedIds: ["x-a", "x-b", "y-b", "y-a"],
      autoSelectedIds: ["y-a"],
    });
  });

  it("auto-ticks the companion subject when adding x(B) to [x(A), y(A)]", () => {
    expect(
      resolveCombineAddition(exampleEntries, ["x-a", "y-a"], "x-b"),
    ).toEqual({
      nextSelectedIds: ["x-a", "y-a", "x-b", "y-b"],
      autoSelectedIds: ["y-b"],
    });
  });

  it("disables adding subject B once z(A) is in [x(A), y(A), z(A)] because z(B) does not exist", () => {
    expect(enabledIds(exampleEntries, ["x-a", "y-a", "z-a"])).toEqual([
      "x-a",
      "y-a",
      "z-a",
    ]);
  });

  it("auto-removes the companion when unticking one half of an auto-completed pair", () => {
    expect(
      resolveCombineRemoval(
        exampleEntries,
        ["x-a", "x-b", "y-a", "y-b"],
        "y-a",
      ),
    ).toEqual({
      nextSelectedIds: ["x-a", "x-b"],
      autoRemovedIds: ["y-b"],
    });

    expect(
      resolveCombineRemoval(
        exampleEntries,
        ["x-a", "x-b", "y-a", "y-b"],
        "y-b",
      ),
    ).toEqual({
      nextSelectedIds: ["x-a", "x-b"],
      autoRemovedIds: ["y-a"],
    });

    // Unticking x(B) preserves anchor x(A) with y(A) and drops y(B).
    expect(
      resolveCombineRemoval(
        exampleEntries,
        ["x-a", "x-b", "y-a", "y-b"],
        "x-b",
      ),
    ).toEqual({
      nextSelectedIds: ["x-a", "y-a"],
      autoRemovedIds: ["y-b"],
    });
  });

  it("greys out incompatible standalone entries from the very start", () => {
    const disjoint = [
      entry("math", [{ subject: "Mathematics", tutees: ["emma", "liam"] }]),
      entry("phys", [{ subject: "Physics", tutees: ["aaron"] }]),
    ];
    expect(enabledIds(disjoint, [])).toEqual([]);

    const mixed = [
      entry("math-1", [{ subject: "Mathematics", tutees: ["emma"] }]),
      entry("math-2", [{ subject: "Mathematics", tutees: ["liam"] }]),
      entry("phys", [{ subject: "Physics", tutees: ["aaron"] }]),
    ];
    expect(enabledIds(mixed, [])).toEqual(["math-1", "math-2"]);
  });

  it("enforces the 6-assignment maximum and excludes unselectable entries", () => {
    const large = [
      entry("big", [
        { subject: "A", tutees: ["s1"] },
        { subject: "A", tutees: ["s2"] },
        { subject: "A", tutees: ["s3"] },
        { subject: "A", tutees: ["s4"] },
        { subject: "A", tutees: ["s5"] },
      ]),
      entry("pair", [
        { subject: "A", tutees: ["s6"] },
        { subject: "A", tutees: ["s7"] },
      ]),
      entry("single", [{ subject: "A", tutees: ["s8"] }]),
      entry("broken", [{ subject: "A", tutees: ["s9"] }], false),
    ];

    // big (5) + single (1) = 6 (valid); pair (2) + single (1) = 3 (valid); broken disabled.
    expect(enabledIds(large, [])).toEqual(["big", "pair", "single"]);
    // Once big (5) is ticked, only single (1) fits within 6; pair (2) would exceed 6.
    expect(enabledIds(large, ["big"])).toEqual(["big", "single"]);
  });
});
