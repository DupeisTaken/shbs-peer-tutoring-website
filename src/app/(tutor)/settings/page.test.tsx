/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import SettingsPage from "./page";
// This suite retains profile/password/membership ownership; the independent
// workload editor's real QueryClient regressions live beside that component.
vi.mock("~/app/_components/tutor-workload-preference", () => ({
  TutorWorkloadPreference: () => null,
}));

type Snapshot = {
  firstName: string;
  lastName: string;
  preferredName: string;
  alternativeNames: string;
  legacyName: null;
  englishName: string;
  username: string;
  email: string;
  profileVersion: number;
};
const state = vi.hoisted(() => {
  const initialReads: { feature: boolean | undefined } = { feature: false };
  return {
    profile: undefined as Snapshot | undefined,
    client: null as QueryClient | null,
    read: vi.fn<() => Promise<Snapshot>>(),
    save: vi.fn(),
    reset: vi.fn(),
    password: vi.fn(),
    code: vi.fn(),
    optOut: vi.fn(),
    reentry: vi.fn(),
    recall: vi.fn(),
    pending: false,
    success: false,
    error: null as null | { message: string; data?: { code: string } },
    callbacks: {
      onSuccess: async (): Promise<void> => undefined,
      onSettled: (): void => undefined,
    },
    passwordCallbacks: {
      onSuccess: (): void => undefined,
      onSettled: (): void => undefined,
    },
    codeCallbacks: {
      onSuccess: (_data: { email: string }): void => undefined,
      onSettled: (): void => undefined,
    },
    status: "ACTIVE",
    request: null as
      null | undefined | { id: string; kind: string; eligibleAt: null },
    requestError: null as null | Error,
    ...initialReads,
    secondSubscriber: false,
    passwordPending: false,
  };
});
vi.mock("~/app/_components/academic-profile", () => ({
  AcademicPanel: () => {
    useQuery({
      queryKey: ["tutor-profile"],
      queryFn: state.read,
      initialData: state.profile,
      staleTime: Infinity,
      retry: false,
      enabled: state.secondSubscriber,
    });
    return <input aria-label="Academic draft" />;
  },
}));
vi.mock("~/app/_components/school-departure", () => ({
  SchoolDeparturePanel: () => null,
}));
vi.mock("~/app/_components/account-emails", () => ({
  AccountEmails: () => <section>Email ownership</section>,
  EmailPreferences: () => null,
}));
vi.mock("~/app/_components/two-factor-settings", () => ({
  TwoFactorSettings: () => null,
}));
vi.mock("~/lib/password-session", () => ({
  signInAfterPasswordChange: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["tutor-profile"] }));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => ({
        tutor: {
          myProfile: {
            invalidate: (
              _input: unknown,
              filters: object = {},
              options: object = {},
            ) =>
              state.client!.invalidateQueries(
                { queryKey: ["tutor-profile"], ...filters },
                options,
              ),
            fetch: () =>
              state.client!.fetchQuery({
                queryKey: ["tutor-profile"],
                queryFn: state.read,
                staleTime: 0,
              }),
          },
          me: { invalidate: async () => undefined },
          myStatusRequest: { invalidate: async () => undefined },
        },
      }),
      program: {
        ...(
          await import("~/test/name-field-policy-fixtures")
        ).nameFieldPolicyQueries(),
        features: {
          useQuery: () => ({
            data:
              state.feature === undefined
                ? undefined
                : { EMAIL_2FA: state.feature },
            refetch: vi.fn(),
          }),
        },
      },
      tutor: {
        myProfile: {
          useQuery: (_input: unknown, options: { enabled: boolean }) =>
            useQuery({
              queryKey: ["tutor-profile"],
              queryFn: state.read,
              initialData: state.profile,
              staleTime: Infinity,
              enabled: options.enabled,
              retry: false,
            }),
        },
        me: {
          useQuery: () => ({
            data: { status: state.status },
            refetch: vi.fn(),
          }),
        },
        myStatusRequest: {
          useQuery: () => ({
            data: state.request,
            error: state.requestError,
            refetch: vi.fn(),
          }),
        },
        updateProfile: {
          useMutation: (options: typeof state.callbacks) => {
            state.callbacks = options;
            return {
              mutate: state.save,
              reset: state.reset,
              isPending: state.pending,
              isSuccess: state.success,
              error: state.error,
            };
          },
        },
        requestPasswordChangeCode: {
          useMutation: (options: typeof state.codeCallbacks) => {
            state.codeCallbacks = options;
            return { mutate: state.code, isPending: state.passwordPending };
          },
        },
        changePassword: {
          useMutation: (options: typeof state.passwordCallbacks) => {
            state.passwordCallbacks = options;
            return { mutate: state.password, isPending: state.passwordPending };
          },
        },
        requestOptOut: {
          useMutation: () => ({ mutate: state.optOut, isPending: false }),
        },
        requestReentry: {
          useMutation: () => ({ mutate: state.reentry, isPending: false }),
        },
        recallStatusRequest: {
          useMutation: () => ({ mutate: state.recall, isPending: false }),
        },
      },
    },
  };
});
function ui() {
  return (
    <QueryClientProvider client={state.client!}>
      <NextIntlClientProvider
        locale="en"
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <SettingsPage />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function first() {
  return screen.getByLabelText<HTMLInputElement>("First Name Required");
}
function save() {
  return screen.getByRole("button", { name: messages.tutor.settings.save });
}
beforeEach(() => {
  state.profile = {
    firstName: "Original",
    lastName: "Person",
    preferredName: "",
    alternativeNames: "",
    legacyName: null,
    englishName: "Original Person",
    username: "person",
    email: "person@example.test",
    profileVersion: 3,
  };
  state.client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  state.read.mockReset().mockImplementation(async () => state.profile!);
  for (const mock of [
    state.save,
    state.reset,
    state.password,
    state.code,
    state.optOut,
    state.reentry,
    state.recall,
  ])
    mock.mockReset();
  state.pending = false;
  state.success = false;
  state.error = null;
  state.status = "ACTIVE";
  state.request = null;
  state.requestError = null;
  state.feature = false;
  state.secondSubscriber = false;
  state.passwordPending = false;
  state.secondSubscriber = false;
});
afterEach(() => {
  cleanup();
  state.client?.clear();
});

it("submits native profile form once, preserves its version through background reads and isolates Cancel", async () => {
  const view = render(ui());
  fireEvent.change(first(), { target: { value: "Draft" } });
  fireEvent.change(
    screen.getByLabelText(messages.tutor.settings.currentPassword),
    { target: { value: "Independent password" } },
  );
  state.profile = { ...state.profile!, firstName: "Server", profileVersion: 8 };
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: ["tutor-profile"] });
  });
  expect(first().value).toBe("Draft");
  const form = screen.getByRole("form", {
    name: messages.tutor.settings.profileHeading,
  });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({ firstName: "Draft", expectedProfileVersion: 3 }),
  );
  state.pending = true;
  view.rerender(ui());
  expect(first().matches(":disabled")).toBe(true);
  expect(screen.getByLabelText("Academic draft").matches(":disabled")).toBe(
    false,
  );
  state.pending = false;
  state.error = { message: "Save failed" };
  act(() => state.callbacks.onSettled());
  view.rerender(ui());
  expect(first().value).toBe("Draft");
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.cancel }),
  );
  expect(first().value).toBe("Server");
  expect(
    screen.getByLabelText<HTMLInputElement>(
      messages.tutor.settings.currentPassword,
    ).value,
  ).toBe("Independent password");
});

it("keeps an accepted profile locked after failed synchronization and retries only reads before repeat save", async () => {
  render(ui());
  fireEvent.change(first(), { target: { value: "Saved" } });
  fireEvent.click(save());
  state.read.mockRejectedValue(new Error("Read unavailable"));
  await act(async () => {
    await state.callbacks.onSuccess();
    state.callbacks.onSettled();
  });
  expect(first().value).toBe("Saved");
  expect(first().matches(":disabled")).toBe(true);
  expect(
    screen.getByText(messages.tutor.settings.profileSyncFailed),
  ).toBeTruthy();
  fireEvent.submit(
    screen.getByRole("form", { name: messages.tutor.settings.profileHeading }),
  );
  expect(state.save).toHaveBeenCalledOnce();
  state.profile = { ...state.profile!, firstName: "Saved", profileVersion: 4 };
  state.read.mockResolvedValue(state.profile);
  fireEvent.click(
    screen.getByRole("button", { name: messages.accountProfile.retryRefresh }),
  );
  await waitFor(() => expect(first().matches(":disabled")).toBe(false));
  fireEvent.change(first(), { target: { value: "Second" } });
  fireEvent.click(save());
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ firstName: "Second", expectedProfileVersion: 4 }),
  );
});

it("preserves a conflicted draft on failed explicit Reload and adopts only a successful fresh snapshot", async () => {
  const view = render(ui());
  fireEvent.change(first(), { target: { value: "Conflict draft" } });
  state.error = { message: "PROFILE_CONFLICT", data: { code: "CONFLICT" } };
  view.rerender(ui());
  state.read.mockRejectedValue(new Error("Offline"));
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.accountProfile.reloadIdentity,
    }),
  );
  await waitFor(() => expect(first().matches(":disabled")).toBe(true));
  await screen.findAllByText(messages.participantRecovery.loadFailed);
  expect(first().value).toBe("Conflict draft");
  state.profile = { ...state.profile!, firstName: "Fresh", profileVersion: 9 };
  state.read.mockResolvedValue(state.profile);
  fireEvent.click(
    screen.getByRole("button", { name: messages.accountProfile.retryRefresh }),
  );
  await waitFor(() => expect(first().value).toBe("Fresh"));
  fireEvent.click(save());
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedProfileVersion: 9 }),
  );
});

it("conceals denied profile data until an explicitly successful authorized read", async () => {
  render(ui());
  const denied = Object.assign(new Error("Denied"), {
    data: { code: "FORBIDDEN" },
  });
  state.read.mockRejectedValue(denied);
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: ["tutor-profile"] });
  });
  await screen.findByText(messages.participantRecovery.accessDenied);
  expect(
    screen.queryByRole("form", {
      name: messages.tutor.settings.profileHeading,
    }),
  ).toBeNull();
  expect(
    screen.getByText(messages.participantRecovery.accessDenied),
  ).toBeTruthy();
  state.read.mockRejectedValue(new Error("Transport unavailable"));
  fireEvent.click(
    screen.getByRole("button", { name: messages.participantRecovery.retry }),
  );
  await act(async () => undefined);
  expect(screen.queryByText("@person")).toBeNull();
  state.read.mockResolvedValue(state.profile!);
  fireEvent.click(
    screen.getByRole("button", { name: messages.participantRecovery.retry }),
  );
  await waitFor(() => expect(first().value).toBe("Original"));
});

it("does not treat unknown security or membership reads as disabled step-up or no pending request", () => {
  state.feature = undefined;
  state.request = undefined;
  render(ui());
  expect(
    screen
      .getByLabelText(messages.tutor.settings.currentPassword)
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: messages.tutor.settings.optOutBtn }),
  ).toBeNull();
  expect(screen.queryByText("@person")).not.toBeNull();
});

it("shows an initial profile failure without fabricating an editable identity and retries only the read", async () => {
  state.profile = undefined;
  state.read.mockRejectedValue(new Error("Initial read unavailable"));
  render(ui());
  await screen.findByText(messages.participantRecovery.loadFailed);
  expect(
    screen.queryByRole("form", {
      name: messages.tutor.settings.profileHeading,
    }),
  ).toBeNull();
  const fresh: Snapshot = {
    firstName: "Recovered",
    lastName: "Person",
    preferredName: "",
    alternativeNames: "",
    legacyName: null,
    englishName: "Recovered Person",
    username: "person",
    email: "person@example.test",
    profileVersion: 6,
  };
  state.read.mockResolvedValue(fresh);
  fireEvent.click(
    screen.getByRole("button", { name: messages.participantRecovery.retry }),
  );
  await waitFor(() => expect(first().value).toBe("Recovered"));
  expect(state.save).not.toHaveBeenCalled();
});

it("guards a direct password change when emailed step-up is disabled", () => {
  render(ui());
  for (const [label, value] of [
    [messages.tutor.settings.currentPassword, "CurrentPass"],
    [messages.tutor.settings.newPassword, "NewPassword"],
    [messages.tutor.settings.confirmPassword, "NewPassword"],
  ] as const)
    fireEvent.change(
      screen.getByLabelText((text) => text.startsWith(label)),
      { target: { value } },
    );
  const change = screen.getByRole("button", {
    name: messages.tutor.settings.changePasswordBtn,
  });
  fireEvent.click(change);
  fireEvent.click(change);
  expect(state.password).toHaveBeenCalledOnce();
  expect(state.password).toHaveBeenCalledWith({
    currentPassword: "CurrentPass",
    newPassword: "NewPassword",
  });
  expect(state.code).not.toHaveBeenCalled();
});

it("guards same-turn password changes and preserves five-character emailed-code behavior", () => {
  state.feature = true;
  const view = render(ui());
  for (const [label, value] of [
    [messages.tutor.settings.currentPassword, "CurrentPass"],
    [messages.tutor.settings.newPassword, "NewPassword"],
    [messages.tutor.settings.confirmPassword, "NewPassword"],
  ] as const)
    fireEvent.change(
      screen.getByLabelText((text) => text.startsWith(label)),
      { target: { value } },
    );
  const send = screen.getByRole("button", {
    name: messages.account.password.sendCode,
  });
  fireEvent.click(send);
  fireEvent.click(send);
  expect(state.code).toHaveBeenCalledOnce();
  act(() => {
    state.codeCallbacks.onSuccess({ email: "person@example.test" });
    state.codeCallbacks.onSettled();
  });
  fireEvent.change(screen.getByLabelText(messages.account.password.codeLabel), {
    target: { value: "abc-123456" },
  });
  expect(
    screen.getByLabelText<HTMLInputElement>(messages.account.password.codeLabel)
      .value,
  ).toBe("ABC12");
  const change = screen.getByRole("button", {
    name: messages.tutor.settings.changePasswordBtn,
  });
  fireEvent.click(change);
  fireEvent.click(change);
  expect(state.password).toHaveBeenCalledOnce();
  state.passwordPending = true;
  view.rerender(ui());
  expect(
    within(
      screen.getByRole("heading", {
        name: messages.tutor.settings.passwordHeading,
      }).parentElement!.parentElement!,
    )
      .getByRole("button", { name: messages.account.password.cancel })
      .matches(":disabled"),
  ).toBe(true);
});
it("evicts a denied shared query once per episode with an enabled sibling subscriber", async () => {
  state.secondSubscriber = true;
  render(ui());
  const evict = vi.spyOn(state.client!, "removeQueries");
  state.read.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: ["tutor-profile"] });
  });
  await screen.findByText(messages.participantRecovery.accessDenied);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(evict).toHaveBeenCalledOnce();
  expect(state.read.mock.calls.length).toBeLessThanOrEqual(2);
  expect(screen.queryByLabelText("First Name Required")).toBeNull();
  const beforeRetry = state.read.mock.calls.length;
  fireEvent.click(
    screen.getByRole("button", { name: messages.participantRecovery.retry }),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: messages.participantRecovery.retry })
        .matches(":disabled"),
    ).toBe(false),
  );
  expect(evict).toHaveBeenCalledOnce();
  expect(state.read.mock.calls.length).toBe(beforeRetry + 1);
  state.profile = {
    ...state.profile!,
    firstName: "Authorized",
    profileVersion: 8,
  };
  state.read.mockResolvedValue(state.profile);
  fireEvent.click(
    screen.getByRole("button", { name: messages.participantRecovery.retry }),
  );
  await waitFor(() => expect(first().value).toBe("Authorized"));
  state.read.mockRejectedValue(
    Object.assign(new Error("Denied again"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: ["tutor-profile"] });
  });
  await screen.findByText(messages.participantRecovery.accessDenied);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(evict).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText("First Name Required")).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});
