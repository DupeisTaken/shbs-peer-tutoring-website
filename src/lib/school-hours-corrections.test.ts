import { expect, it } from "vitest";
import { schoolHoursPriorEditions } from "./school-hours-corrections";

it("uses each frozen earlier-edition correction and falls back only to the known predecessor for old snapshots", () => {
  const priorEditions = [
    { revision: 2, monthAmount: 7.5, correctionToCurrent: 0.2 },
    { revision: 1, monthAmount: 7, correctionToCurrent: 0.7 },
  ];
  expect(
    schoolHoursPriorEditions(
      { priorEditions, previousEditionAmount: 7.5, hoursToAdd: 0.2 },
      3,
    ),
  ).toEqual([priorEditions[1], priorEditions[0]]);
  expect(
    schoolHoursPriorEditions(
      { previousEditionAmount: 7.5, hoursToAdd: 0.2 },
      3,
    ),
  ).toEqual([{ revision: 2, monthAmount: 7.5, correctionToCurrent: 0.2 }]);
  expect(
    schoolHoursPriorEditions({ previousEditionAmount: null, hoursToAdd: 7 }, 1),
  ).toEqual([]);
});
