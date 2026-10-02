// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CrewSignupForm } from "./crew-signup-form";

const state = vi.hoisted(() => ({
  isSuccess: true,
  isPending: false,
  failed: false,
  mutate: vi.fn(),
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("~/trpc/react", () => ({
  api: {
    program: {
      profilePolicy: {
        useQuery: () => ({
          data: {
            requireLatinNames: false,
            offeredGrades: Array.from({ length: 12 }, (_, i) => i + 1),
            currentSchoolYear: "26-27",
          },
          refetch: async () => ({ data: {} }),
        }),
      },
    },
    crew: {
      submitApplication: {
        useMutation: () => ({
          isSuccess: state.isSuccess,
          isPending: state.isPending,
          error: state.failed ? { message: "SAVE_FAILED" } : null,
          mutate: state.mutate,
        }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  state.isSuccess = true;
  state.isPending = false;
  state.failed = false;
  vi.clearAllMocks();
});
it("explains that an application retry preserves the original and directs edits to the team", () => {
  render(<CrewSignupForm />);
  expect(screen.getByText("public.crewSignup.doneTitle")).toBeTruthy();
  expect(screen.getByText("public.applicationRetryNotice")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("distinguishes required identity from optional application details", () => {
  state.isSuccess = false;
  render(<CrewSignupForm />);
  expect(screen.getByLabelText("firstName signupFields.required")).toBeTruthy();
  for (const field of ["email"])
    expect(
      screen.getByLabelText(
        "public.crewSignup.fields." + field + " signupFields.required",
      ),
    ).toBeTruthy();
  for (const field of ["grade", "contact", "message"])
    expect(
      screen.getByLabelText(
        "public.crewSignup.fields." + field + " signupFields.optional",
      ),
    ).toBeTruthy();
});

it("groups identity/application details, locks pending fields and retains a rejected draft", () => {
  state.isSuccess = false;
  const view = render(<CrewSignupForm />);
  const first = screen.getByLabelText<HTMLInputElement>(
    "firstName signupFields.required",
  );
  const email = screen.getByLabelText(
    "public.crewSignup.fields.email signupFields.required",
  );
  fireEvent.change(first, { target: { value: "Crew draft" } });
  fireEvent.change(email, { target: { value: "crew@example.test" } });
  expect(
    screen.getByRole("group", { name: "signupSections.identityTitle" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("group", { name: "signupSections.applicationTitle" }),
  ).toBeTruthy();
  state.isPending = true;
  view.rerender(<CrewSignupForm />);
  expect(first.matches(":disabled")).toBe(true);
  fireEvent.submit(document.querySelector("form")!);
  expect(state.mutate).not.toHaveBeenCalled();
  state.isPending = false;
  state.failed = true;
  view.rerender(<CrewSignupForm />);
  expect(first.value).toBe("Crew draft");
  expect(first.matches(":disabled")).toBe(false);
  expect(screen.getByRole("alert")).toBeTruthy();
});
