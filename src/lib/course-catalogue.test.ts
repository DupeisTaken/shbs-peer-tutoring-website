import { expect, it } from "vitest";
import { courseName, inheritedSubjectIds } from "./course-catalogue";

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
