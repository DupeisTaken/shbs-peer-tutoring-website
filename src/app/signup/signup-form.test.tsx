// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  policy: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    tutee: {
      signupOptions: { useQuery: mocks.options },
      surveyPolicy: { useQuery: mocks.policy },
      submitSurvey: { useMutation: () => ({}) },
    },
  },
}));
vi.mock("~/app/_components/policy-agreement", () => ({
  PolicyAgreement: () => null,
}));
vi.mock("./signin-access", () => ({ SigninAccess: () => null }));
vi.mock("./survey-resend", () => ({ SurveyResend: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockReturnValue({
    data: {
      subjects: [{ id: "math", name: "Math" }],
      slots: [{ id: "slot", dayOfWeek: 1, startMin: 900, endMin: 960 }],
    },
    refetch: mocks.retry,
  });
  mocks.policy.mockReturnValue({
    data: { revision: "r1", title: "Policy", body: "Rules" },
    refetch: mocks.retry,
  });
});
afterEach(cleanup);
it("keeps a loading request from pretending no time slots exist", () => {
  mocks.options.mockReturnValue({ isLoading: true });
  render(<SignupForm />);
  expect(screen.getByRole("status").textContent).toContain("loading");
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("offers retry when prerequisites fail", () => {
  mocks.policy.mockReturnValue({ isError: true, refetch: mocks.retry });
  render(<SignupForm />);
  fireEvent.click(screen.getByRole("button", { name: "survey.retry" }));
  expect(mocks.retry).toHaveBeenCalledTimes(2);
});
it.each(["subjects", "slots", "policy"])(
  "explains missing %s before asking for personal details",
  (missing) => {
    if (missing === "policy") mocks.policy.mockReturnValue({ data: null });
    else
      mocks.options.mockReturnValue({
        data: {
          subjects:
            missing === "subjects" ? [] : [{ id: "math", name: "Math" }],
          slots: missing === "slots" ? [] : [{ id: "slot", dayOfWeek: 1 }],
        },
      });
    render(<SignupForm />);
    expect(screen.getByRole("status").textContent).toContain("unavailable");
    expect(screen.queryByRole("textbox")).toBeNull();
  },
);
it("shows a ready request form with submission disabled until completed", () => {
  render(<SignupForm />);
  expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
  expect(
      screen.getByRole("button", {
        name: "public.signup.submit",
      }).hasAttribute("disabled"),
  ).toBe(true);
});
