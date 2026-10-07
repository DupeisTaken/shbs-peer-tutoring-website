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
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  policy: vi.fn(),
  retry: vi.fn(),
  mutate: vi.fn(),
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
    tutee: {
      signupOptions: { useQuery: mocks.options },
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
vi.mock("./survey-resend", () => ({ SurveyResend: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
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
    run: (work: (grant?: string) => Promise<unknown>) => work(),
    panel: null,
    pending: false,
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
