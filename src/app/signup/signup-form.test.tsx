// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrandingProvider } from "~/app/_components/branding-provider";
import { resolveBranding } from "~/lib/branding-config";
import { signupSettings } from "~/lib/signup-fields";
import { SignupForm } from "./signup-form";
import type { PublicSignupTransition } from "~/lib/public-signup-transition";
import type { RouterOutputs } from "~/trpc/react";

type OptionsMockResult = { data?: Partial<RouterOutputs["tutee"]["signupOptions"]>; [key: string]: unknown };

function transitionFixture(termId = "q1"): PublicSignupTransition {
  return { serverNow: new Date().toISOString(), timeZone: "Asia/Shanghai", current: {
    termId, label: termId === "q1" ? "2026–27 Q1" : "2026–27 Q2", kind: "quarter",
    window: { enabled: true, opensAt: null, closesAt: null, previewUrl: null },
  }, next: null };
}
const mocks = vi.hoisted(() => ({
  locale: "en",
  options: vi.fn(),
  policy: vi.fn(),
  retry: vi.fn(),
  mutate: vi.fn(),
  receipt: vi.fn(),
  captchaRun: vi.fn(),
  captchaPending: false,
}));
vi.mock("next-intl", () => ({
  useLocale: () => mocks.locale,
  useTimeZone: () => "Asia/Shanghai",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", async () => ({
  api: {
    program: {
      ...(
        await import("~/test/name-field-policy-fixtures")
      ).nameFieldPolicyQueries(),
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
    tutee: {
      signupReceipt: { useMutation: () => ({ mutateAsync: mocks.receipt }) },
      signupOptions: { useQuery: (...args: unknown[]) => {
        const result = mocks.options(...args) as OptionsMockResult;
        return { ...result, data: result.data ? { ...result.data, transition: result.data.transition ?? transitionFixture() } : undefined };
      } },
      surveyPolicy: { useQuery: mocks.policy },
      submitSurvey: {
        useMutation: () => ({
          mutateAsync: mocks.mutate,
          mutate: mocks.mutate,
        }),
      },
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
vi.mock("./signin-access", () => ({ SigninAccess: () => null }));
// Countdown/period rendering has dedicated real-provider tests; these cases own form draft/retry behavior.
vi.mock("./signup-transition-notice", async () => ({
  ...await vi.importActual<typeof import("./signup-transition-notice")>("./signup-transition-notice"),
  SignupTransitionNotice: () => null,
}));
vi.mock("./survey-verification", () => ({
  SurveyVerification: ({
    email,
    intentId,
  }: {
    email: string;
    intentId?: string;
  }) => (
    <p data-testid="verification-source">
      {email} / {intentId}
    </p>
  ),
}));
vi.mock("./survey-resend", () => ({ SurveyResend: () => null }));
beforeEach(() => {
  mocks.locale = "en";
  vi.clearAllMocks();
  mocks.retry.mockReset();
  mocks.mutate.mockResolvedValue({
    ok: true,
    emailSent: true,
    intentId: "saved-intent",
  });
  mocks.receipt.mockResolvedValue(null);
  mocks.captchaPending = false;
  mocks.captchaRun.mockImplementation((work: () => Promise<unknown>) => work());
  mocks.options.mockReturnValue({
    isFetchedAfterMount: true,
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
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Minimal configured intake makes retry/receipt behavior independent of unrelated fields. */
function completeMinimalSubmission() {
  mocks.options.mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      subjects: [{ id: "math", name: "Math" }],
      slots: [],
      fields: signupSettings({
        tutee: {
          preferredContact: "hidden",
          availability: "hidden",
          signatureName: "hidden",
          phone: "hidden",
          secondSubject: "hidden",
        },
      }).tutee,
    },
    refetch: mocks.retry,
  });
  const mounted = render(<SignupForm />);
  fireEvent.change(screen.getByLabelText("firstName signupFields.required"), {
    target: { value: "Student" },
  });
  fireEvent.change(screen.getByLabelText(/survey.emailLabel/), {
    target: { value: "student@example.test" },
  });
  fireEvent.change(
    screen.getByRole("combobox", {
      name: "public.signup.fields.firstChoice signupFields.required",
    }),
    { target: { value: "math" } },
  );
  fireEvent.click(screen.getByLabelText("Accept policy"));
  return mounted;
}
/** Isolate subject changes from unrelated configured intake requirements. */
function prepareSubjectChoices(
  secondSubject: "optional" | "required" | "hidden",
) {
  mocks.options.mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      subjects: [
        { id: "math", name: "Math" },
        { id: "physics", name: "Physics" },
        { id: "chemistry", name: "Chemistry" },
      ],
      slots: [],
      fields: signupSettings({
        tutee: {
          preferredContact: "hidden",
          availability: "hidden",
          signatureName: "hidden",
          phone: "hidden",
          secondSubject,
        },
      }).tutee,
    },
    refetch: mocks.retry,
  });
  const mounted = render(<SignupForm />);
  fireEvent.change(screen.getByLabelText("firstName signupFields.required"), {
    target: { value: "Student" },
  });
  fireEvent.change(screen.getByLabelText(/survey.emailLabel/), {
    target: { value: "student@example.test" },
  });
  const first = screen.getByRole("combobox", {
    name: "public.signup.fields.firstChoice signupFields.required",
  });
  const second = screen.queryByRole<HTMLSelectElement>("combobox", {
    name: /signupFields.labels.secondSubject/,
  });
  fireEvent.change(first, { target: { value: "math" } });
  fireEvent.click(screen.getByLabelText("Accept policy"));
  return { mounted, first, second };
}
it("clears an optional second choice when it becomes the first choice before submitting", async () => {
  const { first, second } = prepareSubjectChoices("optional");
  expect(second).not.toBeNull();
  fireEvent.change(second!, { target: { value: "physics" } });
  fireEvent.change(first, { target: { value: "physics" } });
  // The unavailable option disappears visually; the serialized draft must agree
  // with the displayed None choice instead of silently retaining Physics twice.
  expect(second!.value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  expect(mocks.mutate.mock.calls[0]?.[0]).toMatchObject({
    firstChoiceId: "physics",
    secondChoiceId: undefined,
  });
});
it("requires a fresh secondary selection after a required choice collides", async () => {
  const { mounted, first, second } = prepareSubjectChoices("required");
  fireEvent.change(second!, { target: { value: "physics" } });
  fireEvent.change(first, { target: { value: "physics" } });
  expect(second!.value).toBe("");
  expect(second!.checkValidity()).toBe(false);
  expect(
    screen
      .getByRole("button", { name: "public.signup.submit" })
      .hasAttribute("disabled"),
  ).toBe(true);
  // The feature guard must also reject programmatic form submission, rather
  // than relying exclusively on native required-field validation.
  fireEvent.submit(mounted.container.querySelector("form")!);
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.change(second!, { target: { value: "math" } });
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  expect(mocks.mutate.mock.calls[0]?.[0]).toMatchObject({
    firstChoiceId: "physics",
    secondChoiceId: "math",
  });
});
it("retains a distinct secondary choice when the primary changes", async () => {
  const { first, second } = prepareSubjectChoices("optional");
  fireEvent.change(second!, { target: { value: "physics" } });
  fireEvent.change(first, { target: { value: "chemistry" } });
  expect(second!.value).toBe("physics");
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  expect(mocks.mutate.mock.calls[0]?.[0]).toMatchObject({
    firstChoiceId: "chemistry",
    secondChoiceId: "physics",
  });
});
it("keeps hidden secondary choices omitted while changing the primary", async () => {
  const { first, second } = prepareSubjectChoices("hidden");
  expect(second).toBeNull();
  fireEvent.change(first, { target: { value: "physics" } });
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  expect(mocks.mutate.mock.calls[0]?.[0]).toMatchObject({
    firstChoiceId: "physics",
    secondChoiceId: undefined,
  });
});
it("recovers a lost committed response through POST receipt without another submit, preserving the captured answers", async () => {
  mocks.mutate.mockRejectedValueOnce(new Error("Response lost"));
  completeMinimalSubmission();
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "recoverSubmission" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  const posted = mocks.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(screen.getByDisplayValue("Student").matches(":disabled")).toBe(true);
  mocks.receipt.mockResolvedValueOnce({
    ok: true,
    emailSent: true,
    intentId: "recovered-intent",
  });
  fireEvent.click(screen.getByRole("button", { name: "recoverSubmission" }));
  await screen.findByTestId("verification-source");
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(mocks.receipt).toHaveBeenCalledWith({
    clientKey: posted.clientKey,
    answers: expect.objectContaining({
      email: "student@example.test",
      englishName: "Student",
    }) as unknown,
  });
  expect(screen.getByTestId("verification-source").textContent).toContain(
    "recovered-intent",
  );
});
it("retries an unsaved submission using exactly the same intent and snapshot, with one same-tick admission", async () => {
  let reject!: (error: Error) => void;
  mocks.mutate.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  const mounted = completeMinimalSubmission();
  fireEvent.submit(mounted.container.querySelector("form")!);
  fireEvent.submit(mounted.container.querySelector("form")!);
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  const first = mocks.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
  await act(async () => reject(new Error("Offline")));
  mocks.receipt.mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "recoverSubmission" }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
  expect(mocks.mutate.mock.calls[1]?.[0]).toEqual(first);
});
it("a definitive policy rejection can recover an absent receipt and return to the retained draft with a fresh corrected intent", async () => {
  mocks.mutate.mockRejectedValueOnce(
    Object.assign(new Error("Policy changed"), { data: { code: "CONFLICT" } }),
  );
  completeMinimalSubmission();
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "returnToEditing" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  const first = mocks.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
  fireEvent.click(screen.getByRole("button", { name: "returnToEditing" }));
  await waitFor(() =>
    expect(screen.getByDisplayValue("Student").matches(":disabled")).toBe(
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText("firstName signupFields.required"), {
    target: { value: "Corrected" },
  });
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
  expect(mocks.mutate.mock.calls[1]?.[0]).toMatchObject({
    englishName: "Corrected",
  });
  const second = mocks.mutate.mock.calls[1]?.[0] as Record<string, unknown>;
  expect(second.clientKey).not.toBe(first.clientKey);
});
it("a cancelled initial CAPTCHA reopens editing immediately without a receipt read or clearing the form", async () => {
  mocks.captchaRun.mockImplementationOnce(async () => {
    mocks.captchaPending = true;
  });
  const mounted = completeMinimalSubmission();
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  await act(() => Promise.resolve());
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("button", { name: "returnToEditing" })
      .hasAttribute("disabled"),
  ).toBe(true);
  mocks.captchaPending = false;
  mounted.rerender(<SignupForm />);
  await waitFor(() =>
    expect(screen.getByDisplayValue("Student").matches(":disabled")).toBe(
      false,
    ),
  );
  expect(screen.getByDisplayValue("student@example.test")).toBeTruthy();
  expect(mocks.receipt).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "returnToEditing" })).toBeNull();
});
it("cancelling a retry challenge never abandons an earlier ambiguous dispatched intent", async () => {
  mocks.mutate.mockRejectedValueOnce(new Error("Response lost"));
  const mounted = completeMinimalSubmission();
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "recoverSubmission" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  const first: unknown = mocks.mutate.mock.calls[0]?.[0];
  mocks.captchaRun.mockImplementationOnce(async () => {
    mocks.captchaPending = true;
  });
  fireEvent.click(screen.getByRole("button", { name: "recoverSubmission" }));
  await act(() => Promise.resolve());
  mocks.captchaPending = false;
  mounted.rerender(<SignupForm />);
  expect(screen.getByDisplayValue("Student").matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "recoverSubmission" }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
  expect(mocks.mutate.mock.calls[1]?.[0]).toEqual(first);
});
it("keeps a loading request from pretending no time slots exist", () => {
  mocks.options.mockReturnValue({ isLoading: true });
  render(<SignupForm />);
  expect(screen.getByRole("status").textContent).toContain("loading");
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("formats availability weekdays in the active locale while retaining numeric slot selection", () => {
  mocks.locale = "zh";
  render(<SignupForm />);
  expect(screen.getByText("周一")).toBeTruthy();
  const slot = screen.getByRole<HTMLInputElement>("checkbox", {
    name: /15:00–16:00/,
  });
  fireEvent.click(slot);
  expect(slot.checked).toBe(true);
  expect(mocks.mutate).not.toHaveBeenCalled();
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
        isFetchedAfterMount: true,
        data: {
          subjects:
            missing === "subjects" ? [] : [{ id: "math", name: "Math" }],
          slots: missing === "slots" ? [] : [{ id: "slot", dayOfWeek: 1 }],
        },
      });
    render(<SignupForm />);
    expect(screen.getByRole("status").textContent).toContain("setup");
    expect(
      screen
        .getAllByRole("textbox")
        .every((input) => input.matches(":disabled")),
    ).toBe(true);
  },
);
it("shows a ready request form with submission disabled until completed", () => {
  render(<SignupForm />);
  expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
  expect(
    screen
      .getByRole("button", {
        name: "public.signup.submit",
      })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("hides configured tutee fields and allows submission without hidden required defaults", () => {
  mocks.options.mockReturnValue({
    isFetchedAfterMount: true,
    data: {
      subjects: [{ id: "math", name: "Math" }],
      slots: [],
      fields: signupSettings({
        tutee: {
          preferredContact: "hidden",
          availability: "hidden",
          signatureName: "hidden",
          phone: "hidden",
          secondSubject: "hidden",
        },
      }).tutee,
    },
  });
  render(<SignupForm />);
  expect(
    screen.queryByLabelText(/signupFields.labels.preferredContact/),
  ).toBeNull();
  expect(
    screen.queryByLabelText(/signupFields.labels.signatureName/),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("firstName signupFields.required"), {
    target: { value: "Student" },
  });
  fireEvent.change(screen.getByLabelText(/survey.emailLabel/), {
    target: { value: "student@example.test" },
  });
  fireEvent.change(
    screen.getByRole("combobox", {
      name: "public.signup.fields.firstChoice signupFields.required",
    }),
    { target: { value: "math" } },
  );
  fireEvent.click(screen.getByLabelText("Accept policy"));
  fireEvent.click(screen.getByRole("button", { name: "public.signup.submit" }));
  expect(mocks.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      preferredContact: "",
      signatureName: "",
      slotIds: [],
      agreed: true,
      policyRevision: "r1",
    }),
  );
});
it("marks configured optional fields required and resets consent when the policy changes", () => {
  const data = {
    subjects: [{ id: "math", name: "Math" }],
    slots: [],
    fields: signupSettings({
      tutee: {
        gradeLevel: "required",
        phone: "required",
        secondSubject: "required",
        availability: "optional",
      },
    }).tutee,
  };
  mocks.options.mockReturnValue({ data, isFetchedAfterMount: true });
  const view = render(<SignupForm />);
  for (const field of [
    "public.signup.fields.gradeLevel",
    "public.signup.fields.phone",
    "signupFields.labels.secondSubject",
  ])
    expect(
      screen.getByLabelText(new RegExp(field)).hasAttribute("required"),
    ).toBe(true);
  fireEvent.click(screen.getByLabelText("Accept policy"));
  mocks.policy.mockReturnValue({
    data: { revision: "r2", title: "Changed", body: "Changed policy" },
  });
  view.rerender(<SignupForm />);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Accept policy" })
      .checked,
  ).toBe(false);
});

it("uses the server's runtime title in policy consent", () => {
  render(
    <BrandingProvider
      branding={resolveBranding({ APP_TITLE: "Runtime Campus" })}
    >
      <SignupForm />
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
    const { container } = render(<SignupForm />);
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
    expect(screen.getByText("Policy").closest("details")).toBeTruthy();
  },
);

it("labels fixed and configurable requirements consistently", () => {
  render(<SignupForm />);
  for (const name of ["firstName", "survey.emailLabel"])
    expect(
      screen
        .getByLabelText(new RegExp(name + " signupFields.required"))
        .hasAttribute("required"),
    ).toBe(true);
  expect(
    screen
      .getByLabelText("public.signup.fields.phone signupFields.optional")
      .hasAttribute("required"),
  ).toBe(false);
  expect(
    screen
      .getByLabelText(
        /signupFields.labels.preferredContact signupFields.required/,
      )
      .hasAttribute("required"),
  ).toBe(true);
});

vi.mock("~/app/_components/signup-captcha", () => ({
  useSignupCaptcha: () => ({
    run: mocks.captchaRun,
    panel: null,
    pending: mocks.captchaPending,
  }),
  CaptchaError: ({ error }: { error: { message: string } }) => (
    <>{error.message}</>
  ),
}));

it("retains entered identity and groups when cached prerequisites fail", () => {
  const view = render(<SignupForm />);
  const name = screen.getByLabelText<HTMLInputElement>(
    "firstName signupFields.required",
  );
  fireEvent.change(name, { target: { value: "Retained draft" } });
  const cached = mocks.options.mock.results[0]?.value as object;
  mocks.options.mockReturnValue({
    ...cached,
    isError: true,
    error: { message: "Offline" },
  });
  view.rerender(<SignupForm />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>("firstName signupFields.required")
      .value,
  ).toBe("Retained draft");
  expect(
    screen.getByRole("group", { name: "signupSections.identityTitle" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("group", { name: "signupSections.agreementTitle" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "public.signup.submit" })
      .matches(":disabled"),
  ).toBe(true);
  expect(name.matches(":disabled")).toBe(true);
});

it("opens and closes a mounted form on server time while retaining its draft", async () => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "performance", "Date"],
  });
  vi.setSystemTime(new Date("1990-01-01"));
  const cached = mocks.options() as { data: object };
  mocks.options.mockReturnValue({
    ...cached,
    isFetchedAfterMount: true,
    data: {
      ...cached.data,
      recruitment: {
        enabled: true,
        opensAt: "2030-09-01T08:00:01Z",
        closesAt: "2030-09-01T08:00:03Z",
        previewUrl: null,
        serverNow: "2030-09-01T08:00:00Z",
      },
    },
  });
  render(<SignupForm />);
  const name = screen.getByLabelText<HTMLInputElement>(
    "firstName signupFields.required",
  );
  expect(name.matches(":disabled")).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(name.matches(":disabled")).toBe(false);
  fireEvent.change(name, { target: { value: "Retained at closing" } });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByRole("status").textContent).toContain("ended");
  expect(name.matches(":disabled")).toBe(true);
  expect(name.value).toBe("Retained at closing");
});

// Use the actual query observer: a mocked isLoading flag misses a fresh cached
// result that is immediately reused on workspace -> signup navigation.
it.each(["scheduled", "ended"])(
  "rechecks a cached open window before enabling the form when it is now %s",
  async (state) => {
    const cached = (mocks.options() as { data: object }).data;
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
    const recruitment = {
      enabled: true,
      opensAt: null as Date | null,
      closesAt: null as Date | null,
      previewUrl: null,
      serverNow: new Date().toISOString(),
    };
    client.setQueryData(["signup-options"], { ...cached, recruitment });
    let finish!: (value: object) => void;
    const fetchOptions = vi.fn(
      () =>
        new Promise<object>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.options.mockImplementation(function useOptions(
      _input,
      options: object,
    ) {
      return useQuery({
        queryKey: ["signup-options"],
        queryFn: fetchOptions,
        ...options,
      });
    });
    const view = render(
      <QueryClientProvider client={client}>
        <SignupForm />
      </QueryClientProvider>,
    );
    try {
      expect(screen.getByRole("status").textContent).toContain("loading");
      expect(screen.queryByRole("textbox")).toBeNull();
      await waitFor(() => expect(fetchOptions).toHaveBeenCalledOnce());
      await act(async () =>
        finish({
          ...cached,
          recruitment: {
            ...recruitment,
            opensAt:
              state === "scheduled" ? new Date(Date.now() + 60_000) : null,
            closesAt: state === "ended" ? new Date(Date.now() - 60_000) : null,
          },
        }),
      );
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain(state),
      );
      expect(
        screen
          .getAllByRole("textbox")
          .every((input) => input.matches(":disabled")),
      ).toBe(true);
      fireEvent.submit(view.container.querySelector("form")!);
      expect(mocks.mutate).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      client.clear();
    }
  },
);

it("does not unlock cached fields after a failed entry check, then recovers without discarding drafts", async () => {
  const cached = (mocks.options() as { data: object }).data;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  client.setQueryData(["signup-options"], cached);
  const fetchOptions = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(cached);
  mocks.options.mockImplementation(function useOptions(
    _input,
    options: object,
  ) {
    return useQuery({
      queryKey: ["signup-options"],
      queryFn: fetchOptions,
      ...options,
    });
  });
  const view = render(
    <QueryClientProvider client={client}>
      <SignupForm />
    </QueryClientProvider>,
  );
  try {
    await screen.findByRole("alert");
    expect(
      screen
        .getAllByRole("textbox")
        .every((input) => input.matches(":disabled")),
    ).toBe(true);
    fireEvent.submit(view.container.querySelector("form")!);
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "survey.retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    const name = screen.getByLabelText<HTMLInputElement>(
      "firstName signupFields.required",
    );
    expect(name.matches(":disabled")).toBe(false);
    fireEvent.change(name, { target: { value: "Retained draft" } });
    fetchOptions.mockRejectedValueOnce(new Error("Offline again"));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["signup-options"] });
    });
    await screen.findByRole("alert");
    expect(name.value).toBe("Retained draft");
    expect(name.matches(":disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "survey.retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(name.value).toBe("Retained draft");
    expect(name.matches(":disabled")).toBe(false);
  } finally {
    view.unmount();
    client.clear();
  }
});

it("keeps a draft bound to its original term until explicit successful review of the new period", async () => {
  const view = completeMinimalSubmission();
  const name = screen.getByLabelText<HTMLInputElement>("firstName signupFields.required");
  expect(screen.getByLabelText<HTMLInputElement>("Accept policy").checked).toBe(true);
  const current = mocks.options() as OptionsMockResult;
  const latest = { ...current.data, transition: transitionFixture("q2") };
  mocks.options.mockReturnValue({ ...current, data: latest });
  mocks.retry.mockResolvedValue({ data: latest });
  view.rerender(<SignupForm />);
  expect(name.value).toBe("Student");
  expect(name.matches(":disabled")).toBe(true);
  fireEvent.submit(view.container.querySelector("form")!);
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "reviewPeriod" }));
  await waitFor(() => expect(name.matches(":disabled")).toBe(false));
  expect(name.value).toBe("Student");
  expect(screen.getByLabelText<HTMLInputElement>("Accept policy").checked).toBe(false);
  fireEvent.click(screen.getByLabelText("Accept policy"));
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce());
  expect(mocks.mutate.mock.calls[0]?.[0]).toMatchObject({ expectedTermId: "q2" });
});

it("retains the original period and draft when the explicit new-period read fails", async () => {
  const view = completeMinimalSubmission();
  const current = mocks.options() as OptionsMockResult;
  mocks.options.mockReturnValue({ ...current, data: { ...current.data, transition: transitionFixture("q2") } });
  mocks.retry.mockRejectedValue(new Error("Offline"));
  view.rerender(<SignupForm />);
  fireEvent.click(screen.getByRole("button", { name: "reviewPeriod" }));
  await screen.findByText("reviewFailed");
  expect(screen.getByLabelText<HTMLInputElement>("firstName signupFields.required").value).toBe("Student");
  fireEvent.submit(view.container.querySelector("form")!);
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "reviewPeriod" })).toBeTruthy();
});
