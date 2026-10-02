/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import { TuteeAcademicCell } from "./tutee-academic-cell";
afterEach(cleanup);
function mount(overrides: Record<string, unknown> = {}) {
  const row = {
    historical: true,
    gradeLevel: "9",
    academicallyGraduated: false,
    enrollmentPeriod: { schoolYear: "24-25", quarter: "Q1" },
    owner: { id: "account" },
    academic: {
      status: "REPORTED",
      gradeLevel: 11,
      schoolYear: "26-27",
      needsConfirmation: false,
    },
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TuteeAcademicCell
        row={row as ComponentProps<typeof TuteeAcademicCell>["row"]}
      />
    </NextIntlClientProvider>,
  );
}
it("keeps original grade and cohort separate from current account academics", () => {
  mount();
  expect(screen.getByText("Grade 9")).toBeTruthy();
  expect(screen.getByText("Class of 2028")).toBeTruthy();
  expect(screen.getByText("24-25 · Q1")).toBeTruthy();
  expect(screen.queryByText("Grade 11")).toBeNull();
});
it("shows current confirmed grade and graduating class", () => {
  mount({ historical: false });
  expect(screen.getByText("Grade 11")).toBeTruthy();
  expect(screen.getByText("Class of 2028")).toBeTruthy();
  expect(screen.getByText("26-27")).toBeTruthy();
});
it.each([
  { gradeLevel: null },
  { enrollmentPeriod: null },
  { gradeLevel: "IB year 1" },
  { academicallyGraduated: true },
])(
  "does not guess a class from incomplete historical evidence: %j",
  (override) => {
    mount(override);
    expect(screen.queryByText(/Class of/)).toBeNull();
  },
);
it("uses recorded academics for accountless current participants", () => {
  mount({ historical: false, owner: null });
  expect(screen.getByText("Grade 9")).toBeTruthy();
});
it("shows deliberate historical corrections without replacing unknown values or demanding current confirmation", () => {
  mount({ enrollmentCorrection: { rawGrade: null, schoolYear: null } });
  expect(screen.queryByText("Grade 9")).toBeNull();
  expect(screen.queryByText("24-25 · Q1")).toBeNull();
  expect(screen.queryByText("Review needed")).toBeNull();
  expect(screen.queryByText(/Class of/)).toBeNull();
});
it("requires review instead of presenting stale academics as current", () => {
  mount({
    historical: false,
    academic: {
      status: "REPORTED",
      gradeLevel: 11,
      schoolYear: "25-26",
      needsConfirmation: true,
    },
  });
  expect(screen.getByText("Review needed")).toBeTruthy();
  expect(screen.queryByText(/Class of/)).toBeNull();
  expect(screen.queryByText("Grade 11")).toBeNull();
});

it("does not promote an unconfirmed raw grade in an unknown account profile", () => {
  mount({
    historical: false,
    academic: {
      status: "UNKNOWN",
      rawGrade: "9",
      gradeLevel: null,
      schoolYear: "26-27",
      needsConfirmation: false,
    },
  });
  expect(screen.getByText("Unknown Grade Level")).toBeTruthy();
  expect(screen.getByText("Review needed")).toBeTruthy();
});
