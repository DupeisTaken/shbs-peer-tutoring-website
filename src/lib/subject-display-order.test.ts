import { expect, it } from "vitest";
import { sortTutorSubjectRows } from "./subject-display-order";
it("sorts by qualified willingness with explicit unknown and stable catalog ties", () => {
  const rows = [
    { id: "unqualified-willing", qualified: false, willing: true },
    { id: "unknown", qualified: true, willing: null },
    { id: "unwilling", qualified: true, willing: false },
    { id: "willing-a", qualified: true, willing: true },
    { id: "willing-b", qualified: true, willing: true },
    { id: "unqualified-unknown", qualified: false, willing: null },
  ];
  expect(sortTutorSubjectRows(rows).map((row) => row.id)).toEqual([
    "willing-a",
    "willing-b",
    "unwilling",
    "unknown",
    "unqualified-willing",
    "unqualified-unknown",
  ]);
  expect(rows[0]?.id).toBe("unqualified-willing");
  expect(
    sortTutorSubjectRows(rows).find((row) => row.id === "unknown")?.willing,
  ).toBeNull();
});
