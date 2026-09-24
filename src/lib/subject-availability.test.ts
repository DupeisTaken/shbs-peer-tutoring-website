import { expect, it } from "vitest";
import { tutorSubjectRows } from "./subject-availability";

const subjects = ["AP Math", "Math", "Biology"].map((name, index) => ({
  id: String(index),
  name,
  active: true,
  groupId: "math",
  group: { name: "Mathematics" },
  level: null,
}));
it("keeps inherited approval, direct pending state and willingness independent", () => {
  const rows = tutorSubjectRows(
    "t",
    subjects,
    [
      { tutorId: "t", subjectId: "0", status: "APPROVED" },
      { tutorId: "t", subjectId: "1", status: "PENDING" },
    ],
    [
      { tutorId: "t", sourceSubjectId: "0", subjectId: "0" },
      { tutorId: "t", sourceSubjectId: "0", subjectId: "1" },
    ],
    [
      { tutorId: "t", subjectId: "0", willing: false },
      { tutorId: "t", subjectId: "2", willing: true },
    ],
  );
  expect(rows[0]).toMatchObject({
    qualified: true,
    willing: false,
    inheritedFrom: [],
  });
  expect(rows[1]).toMatchObject({
    qualified: true,
    qualification: "PENDING",
    willing: null,
    inheritedFrom: ["AP Math"],
  });
  expect(rows[2]).toMatchObject({ qualified: false, willing: true });
});
it("does not infer inheritance or accept another tutor's or rejected source's grant", () => {
  const rows = tutorSubjectRows(
    "t",
    subjects,
    [{ tutorId: "t", subjectId: "0", status: "REJECTED" }],
    [
      { tutorId: "t", sourceSubjectId: "0", subjectId: "1" },
      { tutorId: "other", sourceSubjectId: "0", subjectId: "2" },
    ],
    [],
  );
  expect(rows.every((row) => !row.qualified && row.willing === null)).toBe(
    true,
  );
});
it("keeps recorded approval visible for archived levels but marks the variant unavailable", () => {
  const rows = tutorSubjectRows(
    "t",
    [{ ...subjects[0]!, level: { name: "AP", active: false } }],
    [{ tutorId: "t", subjectId: "0", status: "APPROVED" }],
    [{ tutorId: "t", sourceSubjectId: "0", subjectId: "0" }],
    [{ tutorId: "t", subjectId: "0", willing: true }],
  );
  expect(rows[0]).toMatchObject({
    active: false,
    qualified: true,
    willing: true,
  });
});
