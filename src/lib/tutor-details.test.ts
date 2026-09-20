import { expect, it } from "vitest";
import { tutorSubjectGroups } from "./tutor-details";

const group = { id: "cs", name: "Computer Science", rank: 1 };
const subjects = [
  { id: "intro", name: "Intro to Computer Science", active: true, group, level: { id: "standard", name: "Standard", rank: 0 } },
  { id: "ap", name: "AP Computer Science A", active: true, group, level: { id: "ap", name: "AP", rank: 2 } },
  { id: "history", name: "History", active: true, group: { id: "history", name: "History", rank: 2 }, level: null },
];
const qualifications = [{ subjectId: "ap", status: "APPROVED" }];
const grants = [{ sourceSubjectId: "ap", subjectId: "ap" }, { sourceSubjectId: "ap", subjectId: "intro" }];

it("groups named variants and distinguishes qualification from all three willingness states", () => {
  const result = tutorSubjectGroups(subjects, qualifications, grants, [{ subjectId: "intro", willing: false }, { subjectId: "history", willing: true }]);
  expect(result.map((row) => row.name)).toEqual(["Computer Science", "History"]);
  expect(result[0]?.subjects).toMatchObject([
    { name: "Intro to Computer Science", qualified: true, willing: false, approval: null, inheritedFrom: [{ id: "ap", name: "AP Computer Science A" }] },
    { name: "AP Computer Science A", qualified: true, willing: null, inheritedFrom: [] },
  ]);
  expect(result[1]?.subjects[0]).toMatchObject({ qualified: false, willing: true });
});

it("reordering changes presentation without inferring or removing inherited grants", () => {
  const reordered = subjects.map((subject) => ({ ...subject, level: subject.level ? { ...subject.level, rank: subject.id === "ap" ? -1 : 5 } : null }));
  const result = tutorSubjectGroups(reordered, qualifications, grants, []);
  expect(result[0]?.subjects.map((row) => row.id)).toEqual(["ap", "intro"]);
  expect(result.flatMap((row) => row.subjects).filter((row) => row.qualified).map((row) => row.id).sort()).toEqual(["ap", "intro"]);
  // A migrated direct grant stays direct even if another offered level becomes lower.
  expect(tutorSubjectGroups(subjects, qualifications, grants.slice(0, 1), [])[0]?.subjects[0]?.qualified).toBe(false);
});

it("pending/rejected sources never confer eligibility, even if stale grants exist", () => {
  for (const status of ["PENDING", "REJECTED"]) {
    const result = tutorSubjectGroups(subjects, [{ subjectId: "ap", status }], grants, []);
    expect(result.flatMap((row) => row.subjects).some((row) => row.qualified)).toBe(false);
    expect(result[0]?.subjects[1]?.approval).toBe(status);
  }
});

it("retains pending direct approval alongside a separate inherited approval", () => {
  const result = tutorSubjectGroups(subjects, [...qualifications, { subjectId: "intro", status: "PENDING" }], grants, []);
  expect(result[0]?.subjects[0]).toMatchObject({ qualified: true, approval: "PENDING" });
});

it("keeps archived evidence and groups legacy variants independently", () => {
  const legacy = subjects.map((subject) => ({ ...subject, active: false, group: null }));
  const result = tutorSubjectGroups(legacy, qualifications, grants, []);
  expect(result).toHaveLength(2);
  expect(result.flatMap((row) => row.subjects).every((row) => !row.active && row.qualified)).toBe(true);
  expect(tutorSubjectGroups(legacy, [], [], [{ subjectId: "history", willing: false }])[0]?.subjects[0]).toMatchObject({ willing: false, qualified: false });
});
