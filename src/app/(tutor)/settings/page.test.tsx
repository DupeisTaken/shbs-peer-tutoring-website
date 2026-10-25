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
import type { NameFieldStates } from "~/lib/name-field-policy";
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
    nameStates: undefined as NameFieldStates | undefined,
    profile: undefined as Snapshot | undefined,
    client: null as QueryClient | null,
    read: vi.fn<() => Promise<Snapshot>>(),
    save: vi.fn(),
    reset: vi.fn(),
    password: vi.fn(),
    code: vi.fn(),
    optOut: vi.fn(),
    refreshMembership: vi.fn<() => Promise<void>>(),
    refreshRequest: vi.fn<() => Promise<void>>(),
    reentry: vi.fn(),
    recall: vi.fn(),
    recallSettled: undefined as undefined | (() => void),
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
    tutorId: "tutor-1",
    membershipError: null as null | {
      message: string;
      data?: { code: string };
    },
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
          me: { invalidate: state.refreshMembership },
          myStatusRequest: { invalidate: state.refreshRequest },
        },
      }),
      program: {
        ...(
          await import("~/test/name-field-policy-fixtures")
        ).nameFieldPolicyQueries(() => state.nameStates),
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
            data: {
              id: state.tutorId,
              englishName: "Original Person",
              status: state.status,
            },
            error: state.membershipError,
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
          useMutation: () => ({ mutateAsync: state.optOut, isPending: false }),
        },
        requestReentry: {
          useMutation: () => ({ mutate: state.reentry, isPending: false }),
        },
        recallStatusRequest: {
          useMutation: (options: { onSettled: () => void }) => {
            state.recallSettled = options.onSettled;
            return { mutate: state.recall, isPending: false };
          },
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
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  state.nameStates = undefined;
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
  state.tutorId = "tutor-1";
  state.membershipError = null;
  state.request = null;
  state.requestError = null;
  state.feature = false;
  state.secondSubscriber = false;
  state.passwordPending = false;
  state.recallSettled = undefined;
  state.optOut.mockResolvedValue({
    ok: true,
    id: "request-1",
    eligibleAt: new Date("2026-11-01T00:00:00Z"),
  });
  state.refreshMembership.mockReset().mockResolvedValue(undefined);
  state.refreshRequest.mockReset().mockResolvedValue(undefined);
  state.secondSubscriber = false;
});
afterEach(() => {
  cleanup();
  state.client?.clear();
});
it("shows a useful all-Hidden Tutor profile while keeping email/security/academics independent", () => {
  state.nameStates = {
    firstName: "hidden",
    lastName: "hidden",
    preferredName: "hidden",
    alternativeNames: "hidden",
  };
  render(ui());
  expect(screen.getByText(messages.nameFields.hiddenProfileHelp)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.tutor.settings.save }),
  ).toBeNull();
  expect(
    screen.getByLabelText<HTMLInputElement>("Academic draft").disabled,
  ).toBe(false);
  expect(screen.getByText("Email ownership")).toBeTruthy();
  fireEvent.submit(
    screen.getByRole("form", { name: messages.tutor.settings.profileHeading }),
  );
  expect(state.save).not.toHaveBeenCalled();
  expect(state.profile?.firstName).toBe("Original");
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

it("guards same-turn password changes and preserves four-digit emailed-code behavior", () => {
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
  fireEvent.change(
    screen.getByLabelText(new RegExp(messages.account.password.codeLabel)),
    {
      target: { value: "00-12" },
    },
  );
  expect(
    screen.getByLabelText<HTMLInputElement>(
      new RegExp(messages.account.password.codeLabel),
    ).value,
  ).toBe("0012");
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

const optOutReason = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: messages.tutor.settings.optOutReasonLabel,
  });
function openOptOut() {
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.settings.optOutBtn }),
  );
  return within(
    screen.getByRole("dialog", { name: messages.tutor.settings.optOutBtn }),
  );
}
function confirmOptOut() {
  return within(screen.getByRole("dialog")).getByRole("button", {
    name: messages.tutor.settings.optOutBtn,
  });
}

it("labels the opt-out reason and reviews the named request without writing on Cancel or Escape", () => {
  render(ui());
  const reason = optOutReason();
  expect(
    document.getElementById(reason.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe(messages.tutor.settings.optOutHelp);
  fireEvent.change(reason, { target: { value: "Time for exams" } });
  const review = openOptOut();
  expect(review.getByText("Original Person")).toBeTruthy();
  expect(review.getByText("Time for exams")).toBeTruthy();
  expect(
    review.getByText(messages.tutor.settings.optOutReviewHelp),
  ).toBeTruthy();
  fireEvent.click(
    review.getByRole("button", { name: messages.actionReview.cancel }),
  );
  expect(reason.value).toBe("Time for exams");
  openOptOut();
  fireEvent.cancel(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(reason.value).toBe("Time for exams");
  expect(state.optOut).not.toHaveBeenCalled();
});

it("admits one opt-out write, freezes its own draft while pending, and preserves a rejected reason", async () => {
  let reject!: (error: Error) => void;
  state.optOut.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(ui());
  fireEvent.change(optOutReason(), {
    target: { value: "  Retained reason  " },
  });
  openOptOut();
  const confirm = confirmOptOut();
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(state.optOut).toHaveBeenCalledExactlyOnceWith({
    reason: "Retained reason",
  });
  expect(optOutReason().disabled).toBe(true);
  expect(screen.getByLabelText("Academic draft").matches(":disabled")).toBe(
    false,
  );
  fireEvent.cancel(screen.getByRole("dialog"));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => {
    reject(new Error("Synthetic request failed"));
  });
  expect(screen.getByRole("alert").textContent).toContain(
    "Synthetic request failed",
  );
  expect(state.refreshMembership).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: messages.actionReview.cancel,
    }),
  );
  expect(optOutReason().value).toBe("  Retained reason  ");
  expect(optOutReason().disabled).toBe(false);
});

it("keeps an accepted queued request through failed refresh and retries only reads after Close", async () => {
  let finishSibling!: () => void;
  state.refreshMembership.mockRejectedValue(new Error("Read unavailable"));
  state.refreshRequest.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSibling = resolve;
      }),
  );
  render(ui());
  openOptOut();
  fireEvent.click(confirmOptOut());
  await waitFor(() => expect(state.refreshRequest).toHaveBeenCalledOnce());
  expect(optOutReason().disabled).toBe(true);
  expect(
    within(screen.getByRole("dialog"))
      .getByRole("button", { name: messages.actionReview.close })
      .matches(":disabled"),
  ).toBe(true);
  await act(async () => {
    finishSibling();
  });
  expect(screen.getByText(messages.actionReview.refreshFailed)).toBeTruthy();
  expect(screen.getByRole("dialog").textContent).toContain("Nov 1, 2026");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: messages.actionReview.close,
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(optOutReason().disabled).toBe(true);
  state.refreshMembership.mockResolvedValue(undefined);
  fireEvent.click(
    screen.getByRole("button", { name: messages.actionReview.retry }),
  );
  await screen.findByText(messages.tutor.settings.optOutSubmitted);
  expect(state.optOut).toHaveBeenCalledExactlyOnceWith({ reason: undefined });
  expect(state.refreshMembership).toHaveBeenCalledTimes(2);
  expect(state.refreshRequest).toHaveBeenCalledTimes(2);
});

it.each(["status", "request", "read error", "identity"])(
  "rechecks live opt-out admission after a changed %s",
  async (change) => {
    const view = render(ui());
    openOptOut();
    if (change === "status") state.status = "OPTED_OUT";
    if (change === "request")
      state.request = { id: "other", kind: "OPT_OUT", eligibleAt: null };
    if (change === "read error") state.requestError = new Error("Unavailable");
    if (change === "identity") state.tutorId = "another-tutor";
    view.rerender(ui());
    fireEvent.click(confirmOptOut());
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog")).getByRole("alert").textContent,
      ).toContain(messages.participantRecovery.loadFailed),
    );
    expect(state.optOut).not.toHaveBeenCalled();
  },
);

it("conceals an opt-out review after authoritative access denial", () => {
  const view = render(ui());
  fireEvent.change(optOutReason(), { target: { value: "Private reason" } });
  openOptOut();
  state.membershipError = {
    message: "Access denied",
    data: { code: "FORBIDDEN" },
  };
  view.rerender(ui());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.optOut).not.toHaveBeenCalled();
});

it("shows a fresh pending request, preserves Recall, and permits a new deliberate request after recall", async () => {
  state.refreshRequest.mockImplementationOnce(async () => {
    state.request = { id: "request-1", kind: "OPT_OUT", eligibleAt: null };
  });
  const view = render(ui());
  openOptOut();
  fireEvent.click(confirmOptOut());
  await screen.findByText(messages.tutor.settings.optOutSubmitted);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: messages.actionReview.close,
    }),
  );
  expect(
    screen.getByText(messages.tutor.settings.optOutPendingNoDate),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.tutor.settings.optOutBtn }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.settings.recall }),
  );
  expect(state.recall).toHaveBeenCalledExactlyOnceWith({
    requestId: "request-1",
  });
  // Model the existing recall's settled mutation and authoritative cleared read.
  act(() => {
    state.request = null;
    state.recallSettled?.();
  });
  view.rerender(ui());
  openOptOut();
  expect(state.optOut).toHaveBeenCalledOnce();
  fireEvent.click(confirmOptOut());
  await waitFor(() => expect(state.optOut).toHaveBeenCalledTimes(2));
  await screen.findByText(messages.tutor.settings.optOutSubmitted);
});
