/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { signupSettings } from "~/lib/signup-fields";
import type { PublicSignupTransition } from "~/lib/public-signup-transition";
import { TutorSignupForm } from "~/app/tutor-signup/tutor-signup-form";
import { SignupForm } from "./signup-form";

const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  policy: vi.fn(),
  retryOptions: vi.fn(),
  retryPolicy: vi.fn(),
  submit: vi.fn(),
  receipt: vi.fn(),
  captcha: vi.fn(),
}));

vi.mock("~/trpc/react", async () => ({
  api: {
    program: {
      ...(
        await import("~/test/name-field-policy-fixtures")
      ).nameFieldPolicyQueries(),
      profilePolicy: {
        useQuery: () => ({
          data: { offeredGrades: [10, 11, 12], currentSchoolYear: "26-27" },
        }),
      },
    },
    tutee: {
      signupOptions: { useQuery: mocks.options },
      surveyPolicy: { useQuery: mocks.policy },
      submitSurvey: { useMutation: () => ({ mutateAsync: mocks.submit }) },
      signupReceipt: { useMutation: () => ({ mutateAsync: mocks.receipt }) },
    },
    application: {
      options: { useQuery: mocks.options },
      policy: { useQuery: mocks.policy },
      submit: { useMutation: () => ({ mutate: mocks.submit }) },
    },
  },
}));
vi.mock("~/app/_components/signup-captcha", () => ({
  useSignupCaptcha: () => ({ run: mocks.captcha, panel: null, pending: false }),
  CaptchaError: () => null,
}));
// Policy reading has its own coverage; keep consent controlled while exercising
// the real forms, retained prerequisite data and localized recovery notices.
vi.mock("~/app/_components/policy-agreement", () => ({
  PolicyAgreement: ({
    policy,
    checked,
    onChange,
  }: {
    policy?: { title: string } | null;
    checked: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <label>
      {policy?.title}
      <input
        type="checkbox"
        aria-label="Accept policy"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  ),
}));

const transition: PublicSignupTransition = {
  serverNow: "2026-10-30T00:00:00.000Z",
  timeZone: "Asia/Shanghai",
  current: {
    termId: "synthetic-q1",
    label: "Synthetic Q1",
    kind: "quarter",
    window: { enabled: true, opensAt: null, closesAt: null, previewUrl: null },
  },
  next: null,
};
const configuredFields = signupSettings({
  tutee: {
    gradeLevel: "hidden",
    phone: "hidden",
    preferredContact: "hidden",
    secondSubject: "hidden",
    signatureName: "hidden",
  },
  tutor: {
    preferredContact: "hidden",
    secondSubject: "hidden",
    thirdSubject: "hidden",
    taken: "hidden",
    grade: "hidden",
    hasApScore: "hidden",
    apScore: "hidden",
    selfStudied: "hidden",
    selfStudyNote: "hidden",
  },
});

function prerequisites(audience: "tutee" | "tutor") {
  const options = {
    data: {
      subjects: [{ id: "math", name: "Synthetic Mathematics" }],
      slots: [
        {
          id: "slot",
          label: "Synthetic slot",
          dayOfWeek: 1,
          startMin: 900,
          endMin: 960,
        },
      ],
      fields: configuredFields[audience],
      transition,
    },
    isFetchedAfterMount: true,
    refetch: mocks.retryOptions,
  };
  const policy = {
    data: {
      revision: "synthetic-policy",
      title: "Synthetic policy",
      body: "Rules",
    },
    refetch: mocks.retryPolicy,
  };
  mocks.options.mockReturnValue(options);
  mocks.policy.mockReturnValue(policy);
  return { options, policy };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.captcha.mockImplementation((work: () => Promise<unknown>) => work());
});
afterEach(cleanup);

describe.each([
  { locale: "en", messages: en },
  { locale: "zh", messages: zh },
])("public signup prerequisite recovery ($locale)", ({ locale, messages }) => {
  const wrap = (audience: "tutee" | "tutor") => (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      {audience === "tutee" ? <SignupForm /> : <TutorSignupForm />}
    </NextIntlClientProvider>
  );
  function expectNeutralReadFailure() {
    expect(screen.getByRole("alert").textContent).toContain(
      messages.public.signupFormLoadFailed,
    );
    expect(screen.queryByText(messages.survey.loadFailed)).toBeNull();
    expect(screen.getByRole("alert").textContent).not.toMatch(
      /saved submission|已保存的申请/,
    );
  }
  function retryReadsOnly() {
    fireEvent.click(
      screen.getByRole("button", { name: messages.survey.retry }),
    );
    expect(mocks.retryOptions).toHaveBeenCalledOnce();
    expect(mocks.retryPolicy).toHaveBeenCalledOnce();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(mocks.captcha).not.toHaveBeenCalled();
  }

  it.each(["options", "policy"] as const)(
    "describes an initial %s failure without implying a saved application",
    (failedRead) => {
      const reads = prerequisites("tutee");
      mocks[failedRead].mockReturnValue({
        ...reads[failedRead],
        data: undefined,
        isError: true,
      });
      const view = render(wrap("tutee"));
      expectNeutralReadFailure();
      expect(view.container.querySelector("form")).toBeNull();
      retryReadsOnly();
    },
  );

  for (const audience of ["tutee", "tutor"] as const) {
    it.each(["options", "policy"] as const)(
      `retains the ${audience} draft and prerequisites after a cached %s failure`,
      (failedRead) => {
        const reads = prerequisites(audience);
        const view = render(wrap(audience));
        const name = view.container.querySelector<HTMLInputElement>(
          'input[name="firstName"]',
        )!;
        fireEvent.change(name, { target: { value: "Synthetic Participant" } });
        const email = view.container.querySelector<HTMLInputElement>(
          'input[type="email"]',
        )!;
        fireEvent.change(email, {
          target: { value: "synthetic@example.test" },
        });
        fireEvent.change(screen.getByRole("combobox"), {
          target: { value: "math" },
        });
        if (audience === "tutee")
          fireEvent.click(screen.getByLabelText(/Synthetic slot/));
        fireEvent.click(
          screen.getByRole("checkbox", { name: "Accept policy" }),
        );
        const submit = screen.getByRole("button", {
          name:
            audience === "tutee"
              ? messages.public.signup.submit
              : messages.public.tutorSignup.submit,
        });
        expect(submit.matches(":disabled")).toBe(false);

        mocks[failedRead].mockReturnValue({
          ...reads[failedRead],
          isError: true,
        });
        view.rerender(wrap(audience));
        expectNeutralReadFailure();
        expect(name.value).toBe("Synthetic Participant");
        expect(email.value).toBe("synthetic@example.test");
        expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe(
          "math",
        );
        expect(
          screen.getByRole("option", { name: "Synthetic Mathematics" }),
        ).toBeTruthy();
        expect(screen.getByText("Synthetic policy")).toBeTruthy();
        expect(
          screen.getByRole<HTMLInputElement>("checkbox", {
            name: "Accept policy",
          }).checked,
        ).toBe(true);
        expect(submit.matches(":disabled")).toBe(true);
        if (audience === "tutee") {
          expect(name.matches(":disabled")).toBe(true);
          expect(
            screen.getByLabelText<HTMLInputElement>(/Synthetic slot/).checked,
          ).toBe(true);
        }
        fireEvent.submit(view.container.querySelector("form")!);
        retryReadsOnly();

        mocks[failedRead].mockReturnValue(reads[failedRead]);
        view.rerender(wrap(audience));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(name.value).toBe("Synthetic Participant");
        expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe(
          "math",
        );
        expect(submit.matches(":disabled")).toBe(false);
        expect(mocks.submit).not.toHaveBeenCalled();
        expect(mocks.receipt).not.toHaveBeenCalled();
      },
    );
  }
});
