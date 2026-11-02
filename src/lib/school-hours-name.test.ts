import { expect, it } from "vitest";
import { schoolHoursExportName } from "./school-hours-name";

it("exports explicit legal fields, quoted nickname and alternate script", () => {
  expect(
    schoolHoursExportName({
      firstName: "  Legal ",
      lastName: "Family",
      preferredName: "Nick",
      alternativeNames: "另一种名字",
    }),
  ).toBe('Legal "Nick" Family (另一种名字)');
});
it("preserves an unstructured legacy name rather than guessing legal boundaries", () => {
  expect(
    schoolHoursExportName({
      firstName: "Guessed",
      lastName: "Parts",
      legacyName: "Original Complete Name",
      nameFieldsConfirmed: false,
    }),
  ).toBe("Original Complete Name");
  expect(schoolHoursExportName({ englishName: "Same Name" })).toBe("Same Name");
  expect(
    schoolHoursExportName({
      firstName: " ",
      lastName: "",
      legacyName: " ",
      englishName: "Fallback",
    }),
  ).toBe("Fallback");
});
