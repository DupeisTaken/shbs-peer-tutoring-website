import { expect, it } from "vitest";
import { schoolHoursVisibleRows } from "./school-hours-visibility";

it("hides only fully unchanged normal-issue rows without dropping offset-zero component changes or mutating the baseline", () => {
  const rows = [
    { id: "old", unchanged: true, hoursToAdd: 0 },
    { id: "offset", unchanged: false, hoursToAdd: 0 },
    { id: "negative", unchanged: false, hoursToAdd: -0.5 },
  ];
  expect(
    schoolHoursVisibleRows({ revision: 1, rows }).map((row) => row.id),
  ).toEqual(["offset", "negative"]);
  expect(schoolHoursVisibleRows({ revision: 2, rows })).toEqual(rows);
  expect(rows).toHaveLength(3);
});
