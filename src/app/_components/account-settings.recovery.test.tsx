/** @vitest-environment jsdom */
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
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import { AccountSettings } from "./account-settings";
const state = vi.hoisted(() => {
  const initialReads: { feature: boolean | undefined } = { feature: false };
  return {
    snapshot: {
      id: "self",
      name: "Original Person",
      firstName: "Original",
      lastName: "Person",
      preferredName: "",
      alternativeNames: "",
      legacyName: null,
      username: "original",
      email: null,
      role: "STUDENT",
      profileVersion: 3,
    },
    initial: true,
    ...initialReads,
    secondSubscriber: false,
    password: vi.fn(),
    client: null as QueryClient | null,
    read: vi.fn(),
    save: vi.fn(),
    reset: vi.fn(),
    refresh: vi.fn(),
    callbacks: {
      onSuccess: async (): Promise<void> => undefined,
      onSettled: (): void => undefined,
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refresh, back: vi.fn() }),
}));
vi.mock("./academic-profile", () => ({
  AcademicPanel: () => {
    useQuery({
      queryKey: ["account-identity"],
      queryFn: state.read,
      initialData: state.initial ? state.snapshot : undefined,
      staleTime: Infinity,
      retry: false,
      enabled: state.secondSubscriber,
    });
    return <input aria-label="Academic draft" />;
  },
}));
vi.mock("./school-departure", () => ({ SchoolDeparturePanel: () => null }));
vi.mock("./membership-editor", () => ({ MembershipEditor: () => null }));
vi.mock("./account-emails", () => ({
  AccountEmails: () => null,
  EmailPreferences: () => null,
}));
vi.mock("./two-factor-settings", () => ({ TwoFactorSettings: () => null }));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: () => ["account-identity"],
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
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
          }),
        },
      },
      account: {
        me: {
          useQuery: (_input: unknown, options: { enabled: boolean }) =>
            useQuery({
              queryKey: ["account-identity"],
              queryFn: state.read,
              initialData: state.initial ? state.snapshot : undefined,
              staleTime: Infinity,
              enabled: options.enabled,
              retry: false,
            }),
        },
        updateName: {
          useMutation: (options: typeof state.callbacks) => {
            state.callbacks = options;
            return {
              mutate: state.save,
              reset: state.reset,
              isPending: false,
              isSuccess: false,
              error: null,
            };
          },
        },
        requestPasswordChangeCode: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        changePassword: {
          useMutation: () => ({ mutate: state.password, isPending: false }),
        },
      },
    },
  };
});
function ui() {
  return (
    <QueryClientProvider client={state.client!}>
      <NextIntlClientProvider locale="en" messages={en}>
        <AccountSettings />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function first() {
  return screen.getByLabelText<HTMLInputElement>("First Name Required");
}
beforeEach(() => {
  state.client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  state.initial = true;
  state.feature = false;
  state.secondSubscriber = false;
  state.password.mockReset();
  state.snapshot = {
    ...state.snapshot,
    name: "Original Person",
    firstName: "Original",
    profileVersion: 3,
  };
  state.read.mockReset().mockImplementation(async () => state.snapshot);
  state.save.mockReset();
  state.reset.mockReset();
  state.refresh.mockReset();
});
afterEach(() => {
  cleanup();
  state.client?.clear();
});
it("retains an edited identity beside transport recovery and does not adopt its version on Retry", async () => {
  render(ui());
  fireEvent.change(first(), { target: { value: "Draft" } });
  state.read.mockRejectedValue(new Error("Offline"));
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: ["account-identity"] });
  });
  await screen.findByText(en.participantRecovery.refreshFailed);
  expect(first().value).toBe("Draft");
  expect(first().matches(":disabled")).toBe(true);
  state.snapshot = {
    ...state.snapshot,
    firstName: "Server",
    profileVersion: 8,
  };
  state.read.mockResolvedValue(state.snapshot);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() => expect(first().matches(":disabled")).toBe(false));
  expect(first().value).toBe("Draft");
  fireEvent.click(
    screen.getByRole("button", { name: en.uiPatterns.saveProfile }),
  );
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({ expectedProfileVersion: 3 }),
    expect.any(Object),
  );
});
it("recovers an accepted write using only reads before enabling a repeat save", async () => {
  render(ui());
  fireEvent.change(first(), { target: { value: "Saved" } });
  fireEvent.click(
    screen.getByRole("button", { name: en.uiPatterns.saveProfile }),
  );
  state.read.mockRejectedValue(new Error("Synchronization failed"));
  await act(async () => {
    await state.callbacks.onSuccess();
    state.callbacks.onSettled();
  });
  expect(first().value).toBe("Saved");
  expect(first().matches(":disabled")).toBe(true);
  expect(screen.getByText(en.tutor.settings.profileSyncFailed)).toBeTruthy();
  state.snapshot = { ...state.snapshot, firstName: "Saved", profileVersion: 4 };
  state.read.mockResolvedValue(state.snapshot);
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.retryRefresh }),
  );
  await waitFor(() => expect(first().matches(":disabled")).toBe(false));
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.refresh).toHaveBeenCalledOnce();
  fireEvent.change(first(), { target: { value: "Next" } });
  fireEvent.click(
    screen.getByRole("button", { name: en.uiPatterns.saveProfile }),
  );
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedProfileVersion: 4 }),
    expect.any(Object),
  );
});
it("conceals cached identity after denial until an explicitly successful authorized read", async () => {
  render(ui());
  state.read.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: ["account-identity"] });
  });
  await screen.findByText(en.participantRecovery.accessDenied);
  expect(screen.queryByText("@original")).toBeNull();
  expect(screen.queryByLabelText("First Name Required")).toBeNull();
  expect(screen.getByLabelText("Academic draft")).toBeTruthy();
  state.read.mockRejectedValue(new Error("Network"));
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: en.participantRecovery.retry })
        .matches(":disabled"),
    ).toBe(false),
  );
  expect(screen.queryByText("@original")).toBeNull();
  state.read.mockResolvedValue(state.snapshot);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() => expect(first().value).toBe("Original"));
  expect(state.save).not.toHaveBeenCalled();
});
it("renders no fabricated identity on initial failure and recovers only its read", async () => {
  state.initial = false;
  state.read.mockRejectedValue(new Error("Unavailable"));
  render(ui());
  await screen.findByText(en.participantRecovery.loadFailed);
  expect(screen.queryByLabelText("First Name Required")).toBeNull();
  state.read.mockResolvedValue(state.snapshot);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() => expect(first().value).toBe("Original"));
  expect(state.save).not.toHaveBeenCalled();
});

it("blocks password writes while step-up configuration is unknown and guards the known direct-change path", () => {
  state.feature = undefined;
  const view = render(ui());
  expect(
    screen
      .getByLabelText(en.tutor.settings.currentPassword)
      .matches(":disabled"),
  ).toBe(true);
  expect(first().matches(":disabled")).toBe(false);
  state.feature = false;
  state.secondSubscriber = false;
  view.rerender(ui());
  for (const [label, value] of [
    [en.tutor.settings.currentPassword, "CurrentPassword"],
    [en.tutor.settings.newPassword, "NewPassword"],
    [en.tutor.settings.confirmPassword, "NewPassword"],
  ] as const)
    fireEvent.change(
      screen.getByLabelText((text) => text.startsWith(label)),
      { target: { value } },
    );
  const action = screen.getByRole("button", {
    name: en.tutor.settings.changePasswordBtn,
  });
  fireEvent.click(action);
  fireEvent.click(action);
  expect(state.password).toHaveBeenCalledOnce();
});

it("evicts a denied shared query once per episode with an enabled sibling subscriber", async () => {
  state.secondSubscriber = true;
  render(ui());
  const evict = vi.spyOn(state.client!, "removeQueries");
  state.read.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: ["account-identity"] });
  });
  await screen.findByText(en.participantRecovery.accessDenied);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(evict).toHaveBeenCalledOnce();
  expect(state.read.mock.calls.length).toBeLessThanOrEqual(2);
  expect(screen.queryByLabelText("First Name Required")).toBeNull();
  const beforeRetry = state.read.mock.calls.length;
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: en.participantRecovery.retry })
        .matches(":disabled"),
    ).toBe(false),
  );
  expect(evict).toHaveBeenCalledOnce();
  expect(state.read.mock.calls.length).toBe(beforeRetry + 1);
  state.snapshot = {
    ...state.snapshot,
    firstName: "Authorized",
    profileVersion: 8,
  };
  state.read.mockResolvedValue(state.snapshot);
  fireEvent.click(
    screen.getByRole("button", { name: en.participantRecovery.retry }),
  );
  await waitFor(() => expect(first().value).toBe("Authorized"));
  state.read.mockRejectedValue(
    Object.assign(new Error("Denied again"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: ["account-identity"] });
  });
  await screen.findByText(en.participantRecovery.accessDenied);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(evict).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText("First Name Required")).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});
