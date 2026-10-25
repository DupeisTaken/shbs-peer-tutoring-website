import { describe, expect, it } from "vitest";
import {
  emptyApplicationFilters,
  matchesApplicationFilters,
  sortApplications,
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

describe("interview completion filtering", () => {
  it.each(["PENDING", "INTERVIEW", "ACCEPTED", "REJECTED", "RECALLED"])(
    "uses recorded completion independently of %s status",
    (status) => {
      for (const date of [undefined, null, "", "invalid", new Date(NaN)]) {
        const record = { ...app, status, interviewCompletedAt: date };
        expect(
          matchesApplicationFilters(record, {
            ...emptyApplicationFilters,
            completion: "COMPLETED",
          }),
        ).toBe(false);
        expect(
          matchesApplicationFilters(record, {
            ...emptyApplicationFilters,
            completion: "NOT_COMPLETED",
          }),
        ).toBe(true);
      }
      const record = {
        ...app,
        status,
        interviewCompletedAt: new Date("2026-10-01T08:00:00Z"),
      };
      expect(
        matchesApplicationFilters(record, {
          ...emptyApplicationFilters,
          completion: "COMPLETED",
        }),
      ).toBe(true);
      expect(
        matchesApplicationFilters(record, {
          ...emptyApplicationFilters,
          completion: "NOT_COMPLETED",
        }),
      ).toBe(false);
      expect(
        matchesApplicationFilters(record, {
          ...emptyApplicationFilters,
          completion: "COMPLETED",
          subjectId: "math-honors",
        }),
      ).toBe(false);
    },
  );
});

describe("application sorting", () => {
  const records = [
    {
      id: "missing",
      name: "Same",
      createdAt: null,
      interviewCompletedAt: undefined,
    },
    {
      id: "new",
      name: "Same",
      createdAt: "2026-01-01T00:00:00Z",
      interviewCompletedAt: new Date("2026-10-01T00:00:00Z"),
    },
    {
      id: "old",
      name: "Same",
      createdAt: new Date("2025-12-31T23:59:59Z"),
      interviewCompletedAt: "2026-09-30T23:59:59Z",
    },
    {
      id: "tie",
      name: "Same",
      createdAt: "2026-01-01T00:00:00Z",
      interviewCompletedAt: "2026-10-01T00:00:00Z",
    },
    {
      id: "invalid",
      name: "Same",
      createdAt: "invalid",
      interviewCompletedAt: new Date(NaN),
    },
  ];
  it.each([
    ["CREATED_ASC", ["old", "new", "tie", "missing", "invalid"]],
    ["CREATED_DESC", ["new", "tie", "old", "missing", "invalid"]],
    ["COMPLETED_ASC", ["old", "new", "tie", "missing", "invalid"]],
    ["COMPLETED_DESC", ["new", "tie", "old", "missing", "invalid"]],
  ] as const)(
    "compares chronological timestamps with stable ties and missing dates last: %s",
    (sort, ids) => {
      expect(
        sortApplications(records, sort, "en").map((record) => record.id),
      ).toEqual(ids);
    },
  );
  it("preserves the incoming queue and original object identities", () => {
    const original = [...records];
    const result = sortApplications(
      Object.freeze(records),
      "CREATED_ASC",
      "en",
    );
    expect(records).toEqual(original);
    expect(result[0]).toBe(records[2]);
    const unsorted = sortApplications(records, "", "en");
    expect(unsorted).toEqual(records);
    expect(unsorted).not.toBe(records);
    expect(sortApplications([...records].reverse(), "", "en")).toEqual(
      [...records].reverse(),
    );
  });
  it.each(["en", "zh-CN"])(
    "uses the active locale and stable equal names: %s",
    (locale) => {
      const names = ["张三", "李四", "Tutor 10", "Tutor 2", "Alex", "alex"].map(
        (name, id) => ({ name, id }),
      );
      const collator = new Intl.Collator(locale, {
        numeric: true,
        sensitivity: "base",
      });
      const expected = [...names].sort((a, b) =>
        collator.compare(a.name, b.name),
      );
      expect(sortApplications(names, "NAME_ASC", locale)).toEqual(expected);
      expect(sortApplications(names, "NAME_DESC", locale)).toEqual(
        [...names].sort((a, b) => collator.compare(b.name, a.name)),
      );
      expect(
        sortApplications(names, "NAME_ASC", locale)
          .filter((record) => record.name.toLowerCase() === "alex")
          .map((record) => record.id),
      ).toEqual([4, 5]);
    },
  );
});
