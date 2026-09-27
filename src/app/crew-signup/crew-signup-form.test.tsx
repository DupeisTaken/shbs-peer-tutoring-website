// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CrewSignupForm } from "./crew-signup-form";

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
    crew: { submitApplication: { useMutation: () => ({ isSuccess: true }) } },
  },
}));
afterEach(cleanup);
it("explains that an application retry preserves the original and directs edits to the team", () => {
  render(<CrewSignupForm />);
  expect(screen.getByText("public.crewSignup.doneTitle")).toBeTruthy();
  expect(screen.getByText("public.applicationRetryNotice")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
