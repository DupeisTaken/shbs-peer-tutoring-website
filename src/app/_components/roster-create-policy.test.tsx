/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import TutorsPage from "../(admin)/admin/tutors/page";
import TuteesPage from "../(admin)/admin/tutees/page";
const mock = vi.hoisted(() => ({
  mutate: vi.fn(),
  error: undefined as undefined | { message: string },
}));
vi.mock("~/trpc/react", () => {
  const rows = { useQuery: () => ({ data: [] }) };
  const create = {
    useMutation: () => ({
      mutate: mock.mutate,
      error: mock.error,
      isPending: false,
    }),
  };
  return {
    api: {
      useUtils: () => ({
        admin: {
          tutors: { invalidate: vi.fn() },
          tutees: { invalidate: vi.fn() },
        },
      }),
      program: {
        profilePolicy: {
          useQuery: () => ({
            data: {
              requireLatinNames: true,
              offeredGrades: [9, 12],
              currentSchoolYear: "26-27",
            },
          }),
        },
      },
      admin: {
        tutors: rows,
        tutees: rows,
        subjects: rows,
        pairings: rows,
        tuteeStats: { useQuery: () => ({ data: {} }) },
        createTutor: create,
        createTutee: create,
        deleteTutee: { useMutation: () => ({ mutate: vi.fn() }) },
      },
    },
  };
});
beforeEach(() => {
  mock.mutate.mockReset();
  mock.error = undefined;
});
afterEach(cleanup);

it.each([
  [true, false, "PROFILE_LATIN_NAME_REQUIRED", "latinRequired"],
  [false, false, "PROFILE_LATIN_NAME_REQUIRED", "latinRequired"],
  [true, true, "PROFILE_GRADE_NOT_OFFERED", "gradeNotOffered"],
  [false, true, "PROFILE_GRADE_NOT_OFFERED", "gradeNotOffered"],
] as const)(
  "shows a translated creation rejection without discarding the draft (tutor=%s Chinese=%s)",
  (tutor, chinese, message, key) => {
    const messages = chinese ? zh : en;
    const ui = () => (
      <NextIntlClientProvider
        locale={chinese ? "zh" : "en"}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        {tutor ? <TutorsPage /> : <TuteesPage />}
      </NextIntlClientProvider>
    );
    const view = render(ui());
    if (tutor) {
      fireEvent.change(
        screen.getByPlaceholderText(messages.admin.tutors.phFirstName),
        { target: { value: "Draft" } },
      );
      fireEvent.change(
        screen.getByPlaceholderText(messages.admin.tutors.phLastName),
        { target: { value: "Name" } },
      );
    } else
      fireEvent.change(screen.getByLabelText(messages.admin.tutees.fullName), {
        target: { value: "Draft Name" },
      });
    fireEvent.submit(document.querySelector("form")!);
    expect(mock.mutate).toHaveBeenCalledOnce();
    // A rejected mutation leaves its error beside the same form and retains the user's input.
    mock.error = { message };
    view.rerender(ui());
    expect(screen.getByRole("alert").textContent).toBe(
      messages.profilePolicy[key],
    );
    expect(
      screen.getByDisplayValue(tutor ? "Draft" : "Draft Name"),
    ).toBeTruthy();
    expect(screen.queryByText(message)).toBeNull();
  },
);
