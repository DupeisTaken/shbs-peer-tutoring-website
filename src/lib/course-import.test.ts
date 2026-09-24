import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { courseImportInput, parseCourseImport } from "./course-import";

const group = {
  name: "Science",
  offerings: [{ baseName: "Science", level: "AP" }],
};

it("accepts the downloadable example and Windows BOM", () => {
  const text = readFileSync("public/examples/course-groups.json", "utf8");
  expect(parseCourseImport("\uFEFF" + text).groups[0]!.offerings).toHaveLength(
    2,
  );
});

it.each([
  { groups: [] },
  { groups: [{ ...group, offerings: [] }] },
  { groups: [group, { ...group, name: " science " }] },
  {
    groups: [
      {
        ...group,
        offerings: [...group.offerings, { baseName: "Other", level: "ap" }],
      },
    ],
  },
  { groups: [{ ...group, offerings: [{ baseName: "Science", level: "" }] }] },
  { groups: [{ ...group, offerings: [{ baseName: "Science" }] }] },
  { groups: [{ ...group, unexpected: true }] },
  { groups: [{ ...group, offerings: [{ baseName: " ", level: null }] }] },
  {
    groups: Array.from({ length: 501 }, (_, i) => ({
      ...group,
      name: String(i),
    })),
  },
  {
    groups: Array.from({ length: 6 }, (_, i) => ({
      name: String(i),
      offerings: Array.from({ length: 100 }, (_, j) => ({
        baseName: String(j),
        level: String(j),
      })),
    })),
  },
])("rejects invalid or oversized documents %#", (input) => {
  expect(courseImportInput.safeParse(input).success).toBe(false);
});

it("rejects malformed JSON and accepts an explicit unlevelled offering", () => {
  expect(() => parseCourseImport("{oops")).toThrow();
  expect(
    courseImportInput.parse({
      groups: [
        { name: " Art ", offerings: [{ baseName: " Art ", level: null }] },
      ],
    }).groups[0],
  ).toEqual({ name: "Art", offerings: [{ baseName: "Art", level: null }] });
});
