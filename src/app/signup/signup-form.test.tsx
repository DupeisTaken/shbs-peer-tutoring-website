// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signupSettings } from "~/lib/signup-fields";
import { SignupForm } from "./signup-form";
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  policy: vi.fn(),
  retry: vi.fn(),
  mutate: vi.fn(),
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
      submitSurvey: { useMutation: () => ({ mutate: mocks.mutate }) },
    },
  },
}));
vi.mock("~/app/_components/policy-agreement", () => ({
  PolicyAgreement: ({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) => <input type="checkbox" aria-label="Accept policy" checked={checked} onChange={event => onChange(event.target.checked)} />,
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

it("hides configured tutee fields and allows submission without hidden required defaults", () => {
  mocks.options.mockReturnValue({ data: { subjects: [{ id: "math", name: "Math" }], slots: [], fields: signupSettings({ tutee: { preferredContact: "hidden", availability: "hidden", signatureName: "hidden", phone: "hidden", secondSubject: "hidden" } }).tutee } });
  render(<SignupForm />);
  expect(screen.queryByLabelText(/signupFields.labels.preferredContact/)).toBeNull();
  expect(screen.queryByLabelText(/signupFields.labels.signatureName/)).toBeNull();
  fireEvent.change(screen.getByLabelText("public.signup.fields.fullName"), { target: { value: "Student" } });
  fireEvent.change(screen.getByLabelText(/survey.emailLabel/), { target: { value: "student@example.test" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "math" } });
  fireEvent.click(screen.getByLabelText("Accept policy"));
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ preferredContact: "", signatureName: "", slotIds: [], agreed: true, policyRevision: "r1" }));
});
it("marks configured optional fields required and resets consent when the policy changes", () => {
  const data = { subjects: [{ id: "math", name: "Math" }], slots: [], fields: signupSettings({ tutee: { gradeLevel: "required", phone: "required", secondSubject: "required", availability: "optional" } }).tutee };
  mocks.options.mockReturnValue({ data });
  const view = render(<SignupForm />);
  for (const field of ["public.signup.fields.gradeLevel", "public.signup.fields.phone", "signupFields.labels.secondSubject"]) expect(screen.getByLabelText(new RegExp(field)).hasAttribute("required")).toBe(true);
  fireEvent.click(screen.getByLabelText("Accept policy"));
  mocks.policy.mockReturnValue({ data: { revision: "r2", title: "Changed", body: "Changed policy" } });
  view.rerender(<SignupForm />);
  expect((screen.getByLabelText("Accept policy") as HTMLInputElement).checked).toBe(false);
});
