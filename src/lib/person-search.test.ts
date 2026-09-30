import { expect, it } from "vitest";
import { matchesPersonSearch } from "./person-search";

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "matches every saved identity regardless of display (preferred=%s, alternate=%s)",
  (preferred, alternate) => {
    const person = {
      firstName: "Mary Ann",
      lastName: "Chen",
      preferredName: "May",
      alternativeNames: "陈晓明",
      legacyName: "Mary-Anne Chen",
      englishName: `${preferred ? "May" : "Mary Ann"} Chen${alternate ? " · 陈晓明" : ""}`,
    };
    for (const query of [
      "Mary Ann",
      "Mary Ann Chen",
      "May",
      "May Chen",
      "Chen",
      "陈晓明",
      "mary-anne",
      "  MARY   ANN CHEN  ",
    ])
      expect(matchesPersonSearch(person, query)).toBe(true);
    expect(matchesPersonSearch(person, "Unknown")).toBe(false);
  },
);
it("preserves Unicode equivalence, unsplit identities and account identifier matching", () => {
  expect(matchesPersonSearch({ firstName: "José" }, "Jose\u0301")).toBe(true);
  expect(matchesPersonSearch({ legacyName: "张小明" }, "小明")).toBe(true);
  expect(
    matchesPersonSearch({}, "STUDENT", ["student42", "learner@example.test"]),
  ).toBe(true);
  expect(
    matchesPersonSearch({}, "@example.test", [null, "learner@example.test"]),
  ).toBe(true);
  expect(matchesPersonSearch({}, "  ")).toBe(true);
});
