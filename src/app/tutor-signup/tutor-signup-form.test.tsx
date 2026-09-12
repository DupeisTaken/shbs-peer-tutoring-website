// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TutorSignupForm } from "./tutor-signup-form";
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  policy: vi.fn(),
  submit: vi.fn(),
  retryOptions: vi.fn(),
  retryPolicy: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    application: {
      options: { useQuery: mocks.options },
      policy: { useQuery: mocks.policy },
      submit: { useMutation: mocks.submit },
    },
  },
}));
vi.mock("~/app/_components/policy-agreement", () => ({
  PolicyAgreement: () => <p>Policy agreement</p>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockReturnValue({
    data: [{ id: "math", name: "Math" }],
    refetch: mocks.retryOptions,
  });
  mocks.policy.mockReturnValue({
    data: { title: "Tutor policy", body: "Published rules" },
    refetch: mocks.retryPolicy,
  });
  mocks.submit.mockReturnValue({ isPending: false, isSuccess: false });
});
afterEach(cleanup);
it("shows a loading state instead of an empty subject picker", () => {
  mocks.options.mockReturnValue({ isLoading: true });
  render(<TutorSignupForm />);
  expect(screen.getByRole("status").textContent).toContain("loading");
  expect(screen.queryByRole("combobox")).toBeNull();
});
it("retries both prerequisite reads without submitting an application", () => {
  mocks.options.mockReturnValue({ isError: true, refetch: mocks.retryOptions });
  render(<TutorSignupForm />);
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "survey.retry" }));
  expect(mocks.retryOptions).toHaveBeenCalledOnce();
  expect(mocks.retryPolicy).toHaveBeenCalledOnce();
});
it.each(["subjects", "policy"])(
  "explains missing %s instead of offering a dead form",
  (missing) => {
    if (missing === "subjects") mocks.options.mockReturnValue({ data: [] });
    else mocks.policy.mockReturnValue({ data: null });
    render(<TutorSignupForm />);
    expect(screen.getByRole("status").textContent).toContain("unavailable");
    expect(
      screen.queryByRole("button", { name: "public.tutorSignup.submit" }),
    ).toBeNull();
  },
);
it("renders a ready form but requires explicit input before submission", () => {
  render(<TutorSignupForm />);
  expect(screen.getByRole("combobox")).toBeTruthy();
  expect(
      screen.getByRole("button", {
        name: "public.tutorSignup.submit",
      }).hasAttribute("disabled"),
  ).toBe(true);
});
it("preserves the successful outcome and points accepted applicants to registration", () => {
  mocks.submit.mockReturnValue({ isSuccess: true });
  mocks.options.mockReturnValue({ isError: true });
  render(<TutorSignupForm />);
  expect(
    screen
      .getByRole("link", { name: "public.tutorSignup.haveCode" })
      .getAttribute("href"),
  ).toBe("/register");
  expect(screen.queryByRole("alert")).toBeNull();
});
