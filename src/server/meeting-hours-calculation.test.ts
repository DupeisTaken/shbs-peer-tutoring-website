import { describe, expect, it } from "vitest";
import type { Quarter } from "~/lib/period";
import {
  calculateMeetingDeductions,
  diffMeetingDeductions,
  type MeetingHoursAttendance,
} from "./meeting-hours-calculation";

const tutorId = "synthetic-tutor";
function attendance(
  id: string,
  options: {
    status?: string;
    date?: string;
    schoolYear?: string;
    quarter?: Quarter;
    withoutTerm?: boolean;
  } = {},
): MeetingHoursAttendance {
  return {
    id,
    meetingId: `meeting-${id}`,
    status: options.status ?? "UNEXCUSED_ABSENT",
    meeting: {
      date: new Date(options.date ?? "2026-09-01T06:00:00.000Z"),
      term: options.withoutTerm
        ? null
        : {
            schoolYear: options.schoolYear ?? "26-27",
            quarter: options.quarter ?? "Q1",
          },
    },
  };
}
const calculate = (rows: readonly MeetingHoursAttendance[]) =>
  calculateMeetingDeductions(tutorId, rows);
const emptyDelta = { removed: [], added: [], changed: [] };

describe("calculateMeetingDeductions", () => {
  it("honors the supplied database tie order without re-sorting retained IDs", () => {
    // Equal-date ordering can reflect the deployed database's own collation.
    const rows = ["b", "Z", "a", "A"].map((id) => attendance(id));
    const original = structuredClone(rows);
    expect(calculate(rows)).toEqual([
      {
        id: "mtgabs_meeting-A_synthetic-tutor",
        tutorId,
        type: "PUNISHMENT",
        amount: 0.25,
        month: "2026-09",
        schoolYear: "26-27",
        quarter: "Q1",
        reason: "Unexcused meeting absence beyond the semester allowance of three",
      },
    ]);
    expect(rows).toEqual(original);
  });

  it("shares Q1/Q2 allowance and ignores non-unexcused and termless attendance", () => {
    const rows = [
      attendance("first"),
      attendance("present", { status: "PRESENT" }),
      attendance("second"),
      attendance("excused", { status: "EXCUSED_ABSENT" }),
      attendance("exempt", { status: "EXEMPT" }),
      attendance("termless", { withoutTerm: true }),
      attendance("third"),
      attendance("fourth", { quarter: "Q2" }),
      attendance("fifth", { quarter: "Q2" }),
    ];
    expect(calculate(rows).map(({ id, quarter }) => ({ id, quarter }))).toEqual([
      { id: "mtgabs_meeting-fourth_synthetic-tutor", quarter: "Q2" },
      { id: "mtgabs_meeting-fifth_synthetic-tutor", quarter: "Q2" },
    ]);
  });

  it("starts independent allowances for Q3/Q4 and a different school year", () => {
    const firstSemester = [0, 1, 2, 3].map((i) => attendance(`s1-${i}`));
    const secondSemester = [0, 1, 2, 3].map((i) =>
      attendance(`s2-${i}`, { quarter: i < 3 ? "Q3" : "Q4" }),
    );
    const nextYear = [0, 1, 2, 3].map((i) =>
      attendance(`next-${i}`, { schoolYear: "27-28" }),
    );
    expect(
      calculate([...firstSemester, ...secondSemester, ...nextYear]).map(
        ({ id, schoolYear, quarter }) => ({ id, schoolYear, quarter }),
      ),
    ).toEqual([
      {
        id: "mtgabs_meeting-s1-3_synthetic-tutor",
        schoolYear: "26-27",
        quarter: "Q1",
      },
      {
        id: "mtgabs_meeting-s2-3_synthetic-tutor",
        schoolYear: "26-27",
        quarter: "Q4",
      },
      {
        id: "mtgabs_meeting-next-3_synthetic-tutor",
        schoolYear: "27-28",
        quarter: "Q1",
      },
    ]);
  });

  it("stamps the deduction's month from the UTC meeting instant", () => {
    const rows = ["one", "two", "three"].map((id) => attendance(id));
    rows.push(
      attendance("four", {
        date: "2026-10-01T00:30:00+08:00",
        quarter: "Q2",
      }),
    );
    expect(calculate(rows)).toMatchObject([{ month: "2026-09", quarter: "Q2" }]);
  });
});

describe("diffMeetingDeductions", () => {
  it("produces no effects for same-semester PRESENT additions or unchanged saves", () => {
    const rows = ["one", "two", "three", "four", "five"].map((id) =>
      attendance(id),
    );
    const before = calculate(rows);
    const after = calculate([
      ...rows,
      attendance("present", { status: "PRESENT" }),
    ]);
    expect(diffMeetingDeductions(before, after)).toEqual(emptyDelta);
    expect(diffMeetingDeductions(before, structuredClone(before))).toEqual(
      emptyDelta,
    );
    // No stored adjustment is supplied: absent or noncanonical targets cannot
    // turn a neutral source change into a historical repair.
  });

  it("removes only the fourth deduction when the first of five absences is excused", () => {
    const rows = ["one", "two", "three", "four", "five"].map((id) =>
      attendance(id),
    );
    const before = calculate(rows);
    const after = calculate(
      rows.map((row, index) =>
        index === 0 ? { ...row, status: "EXCUSED_ABSENT" } : row,
      ),
    );
    expect(diffMeetingDeductions(before, after)).toEqual({
      removed: [
        expect.objectContaining({ id: "mtgabs_meeting-four_synthetic-tutor" }),
      ],
      added: [],
      changed: [],
    });
    expect(diffMeetingDeductions(after, before)).toEqual({
      removed: [],
      added: [
        expect.objectContaining({ id: "mtgabs_meeting-four_synthetic-tutor" }),
      ],
      changed: [],
    });
  });

  it("distinguishes deleting an early, fourth or fifth absence without rebuilding survivors", () => {
    const rows = ["one", "two", "three", "four", "five"].map((id) =>
      attendance(id),
    );
    const before = calculate(rows);
    for (const [removedIndex, deductionId] of [
      [0, "mtgabs_meeting-four_synthetic-tutor"],
      [3, "mtgabs_meeting-four_synthetic-tutor"],
      [4, "mtgabs_meeting-five_synthetic-tutor"],
    ] as const) {
      const after = calculate(rows.filter((_, index) => index !== removedIndex));
      expect(diffMeetingDeductions(before, after)).toEqual({
        removed: [expect.objectContaining({ id: deductionId })],
        added: [],
        changed: [],
      });
    }
  });

  it("adds only the newly liable source for an earlier late-recorded absence", () => {
    const rows = ["one", "two", "three", "four"].map((id) => attendance(id));
    const delta = diffMeetingDeductions(
      calculate(rows),
      calculate([
        attendance("late-earlier", { date: "2026-08-31T06:00:00Z" }),
        ...rows,
      ]),
    );
    expect(delta).toEqual({
      removed: [],
      added: [
        expect.objectContaining({ id: "mtgabs_meeting-three_synthetic-tutor" }),
      ],
      changed: [],
    });
  });

  it("identifies a changed month and quarter on the same logical deduction key", () => {
    const rows = ["one", "two", "three", "four"].map((id) => attendance(id));
    const moved = rows.map((row, index) =>
      index === 3
        ? attendance("four", { date: "2026-10-01T06:00:00Z", quarter: "Q2" })
        : row,
    );
    const before: unknown = expect.objectContaining({
      id: "mtgabs_meeting-four_synthetic-tutor",
      month: "2026-09",
      quarter: "Q1",
    });
    const after: unknown = expect.objectContaining({
      id: "mtgabs_meeting-four_synthetic-tutor",
      month: "2026-10",
      quarter: "Q2",
    });
    expect(diffMeetingDeductions(calculate(rows), calculate(moved))).toEqual({
      removed: [],
      added: [],
      changed: [
        {
          before,
          after,
        },
      ],
    });
  });
});
