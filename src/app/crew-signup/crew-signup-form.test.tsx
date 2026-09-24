// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CrewSignupForm } from "./crew-signup-form";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("~/trpc/react", () => ({
  api: {
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
