import { describe, expect, it } from "vitest";
import {
  emptyApplicationFilters,
  matchesApplicationFilters,
} from "./application-filters";

const app = {
  name: "Alex Chen",
  email: "alex@example.test",
  status: "PENDING",
  type: "ADDITIONAL_SUBJECT",
  subjectIntents: [{ subjectId: "math-ap" }, { subjectId: "physics" }],
};
const matches = (filters: Partial<typeof emptyApplicationFilters>) =>
  matchesApplicationFilters(app, { ...emptyApplicationFilters, ...filters });

describe("application filters", () => {
  it("keeps all requests by default, including requests without subjects", () => {
    expect(matches({})).toBe(true);
    expect(
      matchesApplicationFilters(
        { ...app, subjectIntents: [] },
        emptyApplicationFilters,
      ),
    ).toBe(true);
  });
  it.each(["  ALEX  ", "CHEN", "EXAMPLE.TEST", "   "])(
    "normalizes name/email search: %s",
    (search) => {
      expect(matches({ search })).toBe(true);
    },
  );
  it("combines all dimensions and accepts any requested subject by exact ID", () => {
    expect(
      matches({
        search: "Alex",
        status: "PENDING",
        type: "ADDITIONAL_SUBJECT",
        subjectId: "physics",
      }),
    ).toBe(true);
    for (const filters of [
      { status: "ACCEPTED" },
      { type: "INITIAL" },
      { subjectId: "math-honors" },
      { search: "not present" },
    ]) {
      expect(matches(filters)).toBe(false);
    }
  });
});
