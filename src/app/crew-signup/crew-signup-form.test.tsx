// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CrewSignupForm } from "./crew-signup-form";

const state = vi.hoisted(() => ({ isSuccess: true }));

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
        useMutation: () => ({ isSuccess: state.isSuccess }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  state.isSuccess = true;
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
  for (const field of ["fullName", "email"])
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
