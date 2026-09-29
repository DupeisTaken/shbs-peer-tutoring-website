import { expect, it } from "vitest";
import { visibleTutors } from "./tutor-visibility";

const tutors = ["ACTIVE", "PENDING", "OPTED_OUT", "ARCHIVED", "GRADUATED"].map((status) => ({ id: status, status }));
it("hides only archived and graduated tutors and preserves the source dataset", () => {
  expect(visibleTutors(tutors, false).map((t) => t.id)).toEqual(["ACTIVE", "PENDING", "OPTED_OUT"]);
  expect(visibleTutors(tutors, true)).toEqual(tutors);
  expect(tutors).toHaveLength(5);
});
it("retains selected or historically referenced past tutors when hiding the rest", () => {
  expect(visibleTutors(tutors, false, ["ARCHIVED"]).map((t) => t.id)).toEqual(["ACTIVE", "PENDING", "OPTED_OUT", "ARCHIVED"]);
  expect(visibleTutors(tutors, false, ["missing"]).map((t) => t.id)).toEqual(["ACTIVE", "PENDING", "OPTED_OUT"]);
});
