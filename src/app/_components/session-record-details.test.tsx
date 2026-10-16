/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { RouterOutputs } from "~/trpc/react";
import en from "../../../messages/en.json";
import { SessionRecordDetails } from "./session-record-details";
afterEach(cleanup);
it("reads full recorded attendance evidence and preserves absent/merged zero hours", () => {
  const session = {
    date: new Date("2026-10-01"),
    tutorStatus: "TUTOR_ABSENT",
    tutorAbsentReason: "Recorded tutor reason\nsecond line",
    startMin: 720,
    endMin: 765,
    durationMin: 45,
    shFactor: 0,
    shCount: 0,
    comments: "Complete original comments\nA second line remains intact.",
    ratingPreparedness: null,
    ratingParticipation: 2,
    ratingUnderstanding: 3,
    ratingBehavior: 4,
    ratingProgress: 5,
    tutees: [
      {
        tuteeId: "tutee",
        tutee: { englishName: "Sam" },
        status: "EXCUSED_ABSENT",
        absenceReason: "Original absence\nwith full explanation",
      },
    ],
  } as RouterOutputs["admin"]["sessions"][number];
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SessionRecordDetails session={session} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(/12:00–12:45/).textContent).toContain("45 minutes");
  expect(screen.getByText(/Complete original comments/).textContent).toBe(
    session.comments,
  );
  expect(screen.getByText(/Original absence/).textContent).toBe(
    session.tutees[0]!.absenceReason,
  );
  expect(screen.getByText(/Recorded tutor reason/).textContent).toBe(
    session.tutorAbsentReason,
  );
  expect(screen.getByText("Not recorded")).toBeTruthy();
  for (const value of ["2 / 5", "3 / 5", "4 / 5", "5 / 5"])
    expect(screen.getByText(value)).toBeTruthy();
  expect(screen.getByText(/0\.0 · Factor: 0/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
