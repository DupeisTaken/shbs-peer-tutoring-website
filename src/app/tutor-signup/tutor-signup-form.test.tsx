// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrandingProvider } from "~/app/_components/branding-provider";
import { resolveBranding } from "~/lib/branding-config";
import { signupSettings } from "~/lib/signup-fields";
import { TutorSignupForm } from "./tutor-signup-form";
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  policy: vi.fn(),
  submit: vi.fn(),
  mutate: vi.fn(),
  retryOptions: vi.fn(),
  retryPolicy: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTimeZone: () => "Asia/Shanghai",
  useTranslations: () => (key: string) => key,
}));
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
    application: {
      options: { useQuery: mocks.options },
      policy: { useQuery: mocks.policy },
      submit: { useMutation: mocks.submit },
    },
  },
}));
vi.mock("~/app/_components/policy-agreement", () => ({
  PolicyAgreement: ({
    appTitle,
    checked,
    onChange,
  }: {
    appTitle: string;
    checked: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label="Accept policy"
      data-app-title={appTitle}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockReturnValue({
    data: { subjects: [{ id: "math", name: "Math" }] },
    refetch: mocks.retryOptions,
  });
  mocks.policy.mockReturnValue({
    data: { title: "Tutor policy", body: "Published rules", revision: "r1" },
    refetch: mocks.retryPolicy,
  });
  mocks.submit.mockReturnValue({
    isPending: false,
    isSuccess: false,
    mutate: mocks.mutate,
  });
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
    if (missing === "subjects")
      mocks.options.mockReturnValue({ data: { subjects: [] } });
    else mocks.policy.mockReturnValue({ data: null });
    render(<TutorSignupForm />);
    expect(screen.getByRole("status").textContent).toContain("setup");
    expect(
      screen
        .getByRole("button", { name: "public.tutorSignup.submit" })
        .matches(":disabled"),
    ).toBe(true);
  },
);
it("renders a ready form but requires explicit input before submission", () => {
  render(<TutorSignupForm />);
  expect(screen.getAllByRole("combobox")).toHaveLength(3);
  expect(
    screen
      .getByRole("button", {
        name: "public.tutorSignup.submit",
      })
      .hasAttribute("disabled"),
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
  expect(screen.getByText("public.applicationRetryNotice")).toBeTruthy();
});

it("keeps a required third subject in its original position when the second is hidden", () => {
  mocks.options.mockReturnValue({
    data: {
      subjects: [
        { id: "math", name: "Math" },
        { id: "science", name: "Science" },
      ],
      fields: signupSettings({
        tutor: {
          secondSubject: "hidden",
          thirdSubject: "required",
          preferredContact: "hidden",
        },
      }).tutor,
    },
  });
  render(<TutorSignupForm />);
  const selectors = screen.getAllByRole("combobox");
  expect(selectors).toHaveLength(2);
  expect(selectors[1]!.hasAttribute("required")).toBe(true);
  expect(
    screen.queryByLabelText(/signupFields.labels.preferredContact/),
  ).toBeNull();
  fireEvent.change(selectors[0]!, { target: { value: "math" } });
  fireEvent.change(selectors[1]!, { target: { value: "science" } });
  fireEvent.change(
    screen.getByLabelText("public.tutorSignup.fields.fullName"),
    { target: { value: "Tutor" } },
  );
  fireEvent.change(screen.getByLabelText("public.tutorSignup.fields.email"), {
    target: { value: "tutor@example.test" },
  });
  fireEvent.click(screen.getByLabelText("Accept policy"));
  fireEvent.click(
    screen.getByRole("button", { name: "public.tutorSignup.submit" }),
  );
  expect(mocks.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      agreed: true,
      policyRevision: "r1",
      subjects: [
        expect.objectContaining({ subjectId: "math" }),
        { subjectId: "" },
        expect.objectContaining({ subjectId: "science" }),
      ],
    }),
  );
});
it("renders explicit required yes/no answers and conditional required details", () => {
  mocks.options.mockReturnValue({
    data: {
      subjects: [{ id: "math", name: "Math" }],
      fields: signupSettings({
        tutor: {
          taken: "required",
          grade: "required",
          secondSubject: "hidden",
          thirdSubject: "hidden",
        },
      }).tutor,
    },
  });
  render(<TutorSignupForm />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "math" } });
  const answer = screen.getByRole("combobox", {
    name: "public.tutorSignup.qual.taken",
  });
  expect(answer.hasAttribute("required")).toBe(true);
  fireEvent.change(answer, { target: { value: "false" } });
  expect(screen.queryByLabelText(/public.tutorSignup.fields.grade/)).toBeNull();
  fireEvent.change(answer, { target: { value: "true" } });
  expect(
    screen
      .getByLabelText(/public.tutorSignup.fields.grade/)
      .hasAttribute("required"),
  ).toBe(true);
});

it("uses the server's runtime title in policy consent", () => {
  render(
    <BrandingProvider
      branding={resolveBranding({ APP_TITLE: "Runtime Campus" })}
    >
      <TutorSignupForm />
    </BrandingProvider>,
  );
  expect(
    screen.getByLabelText("Accept policy").getAttribute("data-app-title"),
  ).toBe("Runtime Campus");
});

it.each(["paused", "scheduled", "ended"])(
  "keeps %s recruitment visible but prevents every response edit and direct form submit",
  (state) => {
    const existing = mocks.options() as { data: Record<string, unknown> };
    mocks.options.mockReturnValue({
      ...existing,
      data: {
        ...existing.data,
        recruitment: {
          enabled: state !== "paused",
          opensAt: state === "scheduled" ? new Date(Date.now() + 60000) : null,
          closesAt: state === "ended" ? new Date(Date.now() - 60000) : null,
          previewUrl: null,
          serverNow: new Date().toISOString(),
        },
      },
    });
    const { container } = render(<TutorSignupForm />);
    expect(screen.getByRole("status").textContent).toContain(state);
    expect(
      container.querySelectorAll("form input, form select, form textarea")
        .length,
    ).toBeGreaterThan(0);
    for (const input of container.querySelectorAll(
      "form input, form select, form textarea",
    ))
      expect(input.matches(":disabled")).toBe(true);
    fireEvent.submit(container.querySelector("form")!);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Tutor policy").closest("details")).toBeTruthy();
  },
);
