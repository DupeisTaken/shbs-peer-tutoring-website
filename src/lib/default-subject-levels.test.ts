import { describe, expect, it } from "vitest";
import { DEFAULT_SUBJECT_LEVELS } from "../../prisma/default-subject-levels";
import { courseName, inheritedSubjectIds } from "./course-catalogue";

describe("default seeded difficulty pipeline", () => {
  it("offers Standard, Honors, then AP with increasing difficulty and AP-only scores", () => {
    expect(
      DEFAULT_SUBJECT_LEVELS.map(({ name, rank, apScored }) => ({
        name,
        rank,
        apScored,
      })),
    ).toEqual([
      { name: "Standard", rank: 0, apScored: false },
      { name: "Honors", rank: 1, apScored: false },
      { name: "AP", rank: 2, apScored: true },
    ]);
    expect(
      DEFAULT_SUBJECT_LEVELS.map((level) =>
        courseName("Biology", level.prefix),
      ),
    ).toEqual(["Biology", "Honors Biology", "AP Biology"]);
  });

  // Exercise actual qualification resolution using seed definitions, so a reversed
  // seed rank cannot silently make Standard approval grant Honors or AP.
  it.each([
    ["Standard", ["Standard"]],
    ["Honors", ["Standard", "Honors"]],
    ["AP", ["Standard", "Honors", "AP"]],
  ] as const)(
    "%s approval only includes its own and lower offered levels",
    (name, expected) => {
      const offerings = DEFAULT_SUBJECT_LEVELS.map((level) => ({
        id: level.name,
        groupId: "biology",
        active: true,
        level: { ...level, active: true },
      }));
      const source = offerings.find((offering) => offering.id === name)!;
      expect(inheritedSubjectIds(source, offerings)).toEqual(expected);
    },
  );
});
