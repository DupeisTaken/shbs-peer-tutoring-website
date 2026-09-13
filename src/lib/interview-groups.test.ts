import { expect, it } from "vitest";
import {
  filterTutorQualifications,
  groupTutorQualifications,
} from "./interview-groups";
const tutors = [
  { id: "one", englishName: "Same Name", status: "ACTIVE" },
  { id: "two", englishName: "Same Name", status: "ACTIVE" },
  { id: "three", englishName: "Earlier Tutor", status: "INACTIVE" },
  { id: "four", englishName: "Unqualified Inactive", status: "INACTIVE" },
];
const subjects = [
  { id: "math", name: "数学" },
  { id: "english", name: "English" },
];
const groups = () =>
  groupTutorQualifications(tutors, subjects, [
    { tutorId: "one", subjectId: "math" },
    { tutorId: "one", subjectId: "english" },
    { tutorId: "three", subjectId: "math" },
  ]);
it("groups subjects by identity, retains zero qualifications and inactive evidence", () => {
  const rows = groups();
  expect(rows.map((row) => [row.id, row.subjects.length])).toEqual([
    ["one", 2],
    ["two", 0],
    ["three", 1],
  ]);
});
it("combines subject/name search and qualification status without losing identity", () => {
  expect(
    filterTutorQualifications(groups(), " english ", "QUALIFIED").map(
      (g) => g.id,
    ),
  ).toEqual(["one"]);
  expect(
    filterTutorQualifications(groups(), "same", "NONE").map((g) => g.id),
  ).toEqual(["two"]);
  expect(filterTutorQualifications(groups(), "数学", "ALL")).toHaveLength(2);
  expect(filterTutorQualifications(groups(), "missing", "ALL")).toEqual([]);
});
