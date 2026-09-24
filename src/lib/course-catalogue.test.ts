import { expect, it } from "vitest";
import {
  courseName,
  inheritedSubjectIds,
  sortCourseChoices,
} from "./course-catalogue";

const levels = [
  { id: "regular", rank: 0, prefix: "" },
  { id: "honors", rank: 1, prefix: "Honors" },
  { id: "ap", rank: 2, prefix: "AP" },
  { id: "ib", rank: 3, prefix: "IB" },
];
const choice = (id: string, baseName: string, tier: number | null) => ({
  id,
  baseName,
  name: courseName(baseName, tier === null ? "" : levels[tier]!.prefix),
  level: tier === null ? null : levels[tier]!,
});

it("sorts level first, uses base names, and mixes unlevelled courses with regular ones without mutation", () => {
  const subjects = [
    choice("ib", "Algebra", 3),
    choice("ap", "Biology", 2),
    choice("honors", "Algebra", 1),
    choice("regular", "Zoology", 0),
    choice("none", "Biology", null),
    choice("first", "Algebra 1", 0),
    { ...choice("legacy", "Chemistry", 2), baseName: "" },
  ];
  const before = structuredClone(subjects);
  expect(sortCourseChoices(subjects, levels).map((s) => s.id)).toEqual([
    "first",
    "none",
    "regular",
    "honors",
    "ap",
    "legacy",
    "ib",
  ]);
  expect(subjects).toEqual(before);
});

it("uses configured ranks rather than names, including restricted pickers and reordered regular levels", () => {
  const reordered = levels.map((l) => ({
    ...l,
    rank: l.id === "regular" ? 4 : l.rank,
  }));
  const subjects = [
    choice("none", "Algebra", null),
    { ...choice("ap", "Zoology", 2), level: reordered[2]! },
  ];
  expect(sortCourseChoices(subjects, reordered).map((s) => s.id)).toEqual([
    "ap",
    "none",
  ]);
  expect(
    sortCourseChoices([choice("none", "AP History", null)], []).map(
      (s) => s.name,
    ),
  ).toEqual(["AP History"]);
});

it("resolves duplicate ranks and names deterministically", () => {
  const a = choice("a", "biology", 0),
    b = choice("b", "Biology", 0);
  expect(sortCourseChoices([b, a], levels).map((s) => s.id)).toEqual([
    "a",
    "b",
  ]);
  expect(sortCourseChoices([], levels)).toEqual([]);
});

it.each([
  ["Intro to Computer Science", "", "Intro to Computer Science"],
  ["Computer Science A", "AP", "AP Computer Science A"],
  ["Calculus", "", "Calculus"],
  ["Calculus", "Honors", "Honors Calculus"],
  ["Calculus AB", "AP", "AP Calculus AB"],
  [" Extended Essay ", " IB ", "IB Extended Essay"],
])("generates %s with the configured prefix", (base, prefix, expected) => {
  expect(courseName(base, prefix)).toBe(expected);
});

const variant = (
  id: string,
  rank: number,
  groupId = "history",
  active = true,
) => ({
  id,
  groupId,
  active,
  level: { id: `level-${rank}`, rank, name: `Level ${rank}`, active: true },
});
it("inherits only lower offered variants in the same group, including gaps", () => {
  const standard = variant("standard", 0);
  const ap = variant("ap", 2);
  expect(
    inheritedSubjectIds(ap, [
      standard,
      ap,
      variant("government", 0, "government"),
      variant("honors", 1, "history", false),
    ]),
  ).toEqual(["standard", "ap"]);
});
it("never treats two legacy ungrouped subjects as the same course", () => {
  const source = { ...variant("legacy", 2), groupId: null };
  expect(
    inheritedSubjectIds(source, [
      source,
      { ...variant("other", 0), groupId: null },
    ]),
  ).toEqual(["legacy"]);
});
