// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

type QueryError = { message: string; data?: { code?: string } } | null;

const mocks = vi.hoisted(() => {
  const state: {
    mutate: ReturnType<typeof vi.fn<(input: unknown) => void>>;
    reset: ReturnType<typeof vi.fn<() => void>>;
    meRefetch: ReturnType<
      typeof vi.fn<
        () => Promise<{
          isSuccess: boolean;
          data: { twoFactorEnabled: boolean } | undefined;
        }>
      >
    >;
    featuresRefetch: ReturnType<
      typeof vi.fn<
        () => Promise<{
          isSuccess: boolean;
          data:
            | { EMAIL_2FA: boolean; EMAIL_DELIVERY_AVAILABLE: boolean }
            | undefined;
        }>
      >
    >;
    meData: { twoFactorEnabled: boolean } | undefined;
    featuresData:
      | { EMAIL_2FA: boolean; EMAIL_DELIVERY_AVAILABLE: boolean }
      | undefined;
    meError: QueryError;
    featuresError: QueryError;
    meFetching: boolean;
    featuresFetching: boolean;
    pending: boolean;
    recover: boolean;
    error: QueryError;
    onSuccess: null | (() => Promise<void>);
    onSettled: null | (() => void);
  } = {
    mutate: vi.fn(),
    reset: vi.fn(),
    meRefetch: vi.fn(),
    featuresRefetch: vi.fn(),
    meData: { twoFactorEnabled: true },
    featuresData: { EMAIL_2FA: true, EMAIL_DELIVERY_AVAILABLE: true },
    meError: null,
    featuresError: null,
    meFetching: false,
    featuresFetching: false,
    pending: false,
    recover: false,
    error: null,
    onSuccess: null,
    onSettled: null,
  };
  return state;
});

vi.mock("~/trpc/react", () => ({
  api: {
    program: {
      features: {
        useQuery: () => ({
          data: mocks.featuresData,
          error: mocks.featuresError,
          isFetching: mocks.featuresFetching,
          isSuccess: Boolean(mocks.featuresData) && !mocks.featuresError,
          refetch: mocks.featuresRefetch,
        }),
      },
    },
    account: {
      me: {
        useQuery: () => ({
          data: mocks.meData,
          error: mocks.meError,
          isFetching: mocks.meFetching,
          isSuccess: Boolean(mocks.meData) && !mocks.meError,
          refetch: mocks.meRefetch,
        }),
      },
      setTwoFactorEnabled: {
        useMutation: (options: {
          onSuccess?: () => Promise<void>;
          onSettled?: () => void;
        }) => {
          mocks.onSuccess = options.onSuccess ?? null;
          mocks.onSettled = options.onSettled ?? null;
          return {
            mutate: (input: unknown) => {
              mocks.mutate(input);
              if (mocks.recover) {
                void options.onSuccess?.().finally(() => options.onSettled?.());
              }
            },
            reset: mocks.reset,
            isPending: mocks.pending,
            error: mocks.error,
          };
        },
      },
    },
  },
}));

import { TwoFactorSettings } from "./two-factor-settings";

const wrap = (locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "zh" ? zh : en}
  >
    <TwoFactorSettings />
  </NextIntlClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    meData: { twoFactorEnabled: true },
    featuresData: { EMAIL_2FA: true, EMAIL_DELIVERY_AVAILABLE: true },
    meError: null,
    featuresError: null,
    meFetching: false,
    featuresFetching: false,
    pending: false,
    recover: false,
    error: null,
  });
  mocks.meRefetch.mockImplementation(async () => ({
    isSuccess: Boolean(mocks.meData) && !mocks.meError,
    data: mocks.meData,
  }));
  mocks.featuresRefetch.mockImplementation(async () => ({
    isSuccess: Boolean(mocks.featuresData) && !mocks.featuresError,
    data: mocks.featuresData,
  }));
});
afterEach(cleanup);

it.each([
  { locale: "en" as const, messages: en },
  { locale: "zh" as const, messages: zh },
])(
  "shows exhaustion, preserves the draft during pending/error states and clears it only after recovery ($locale)",
  async ({ locale, messages }) => {
    const labels = messages.auth.twoFactor.settings;
    const view = render(wrap(locale));
    const input = screen.getByLabelText<HTMLInputElement>(
      labels.currentPassword,
    );
    fireEvent.change(input, { target: { value: "SyntheticPassword239!" } });
    input.focus();
    fireEvent.submit(input.closest("form")!);
    expect(mocks.mutate).toHaveBeenCalledWith({
      enabled: false,
      currentPassword: "SyntheticPassword239!",
    });

    mocks.pending = true;
    view.rerender(wrap(locale));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: labels.saving })
        .disabled,
    ).toBe(true);
    expect(input.value).toBe("SyntheticPassword239!");

    mocks.pending = false;
    mocks.error = {
      message:
        "Too many password confirmations. Wait fifteen minutes before trying again.",
    };
    mocks.onSettled?.();
    view.rerender(wrap(locale));
    expect(screen.getByText(mocks.error.message)).toBeTruthy();
    expect(input.value).toBe("SyntheticPassword239!");
    expect(mocks.meRefetch).not.toHaveBeenCalled();

    mocks.error = null;
    mocks.recover = true;
    mocks.meData = { twoFactorEnabled: false };
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(input.value).toBe(""));
    expect(mocks.meRefetch).toHaveBeenCalledOnce();
    expect(mocks.featuresRefetch).toHaveBeenCalledOnce();
    view.rerender(wrap(locale));
    expect(screen.getByText(labels.saved)).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: labels.enable })
        .disabled,
    ).toBe(true);
  },
);

it.each([
  { locale: "en" as const, messages: en },
  { locale: "zh" as const, messages: zh },
])(
  "does not misreport loading or failed reads as Disabled or program-off ($locale)",
  ({ locale, messages }) => {
    const labels = messages.auth.twoFactor.settings;
    mocks.meData = undefined;
    mocks.featuresData = undefined;
    mocks.meFetching = true;
    mocks.featuresFetching = true;
    const view = render(wrap(locale));

    expect(screen.getByText(labels.loading)).toBeTruthy();
    expect(screen.queryByText(labels.disabled)).toBeNull();
    expect(screen.queryByText(labels.featureOff)).toBeNull();

    // Failed program.features read with loaded account.me still must not claim program-off.
    mocks.meData = { twoFactorEnabled: false };
    mocks.meFetching = false;
    mocks.featuresFetching = false;
    mocks.featuresError = { message: "Network failure" };
    view.rerender(wrap(locale));
    expect(screen.getByText(labels.loadFailed)).toBeTruthy();
    expect(screen.queryByText(labels.featureOff)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: messages.uiPatterns.retry }),
    );
    expect(mocks.featuresRefetch).toHaveBeenCalledOnce();

    // Failed initial account.me read hides the status badge and offers Retry.
    mocks.meData = undefined;
    mocks.meError = { message: "Account read failed" };
    mocks.featuresData = { EMAIL_2FA: true, EMAIL_DELIVERY_AVAILABLE: true };
    mocks.featuresError = null;
    view.rerender(wrap(locale));
    expect(screen.queryByText(labels.disabled)).toBeNull();
    expect(screen.getByText(labels.loadFailed)).toBeTruthy();
  },
);

it("retains password draft during cached refresh failure while blocking writes", () => {
  const labels = en.auth.twoFactor.settings;
  const view = render(wrap("en"));
  const input = screen.getByLabelText<HTMLInputElement>(labels.currentPassword);
  fireEvent.change(input, { target: { value: "KeepDraft123!" } });

  mocks.featuresError = { message: "Transient read error" };
  view.rerender(wrap("en"));

  expect(input.value).toBe("KeepDraft123!");
  expect(input.disabled).toBe(true);
  expect(screen.getByText(labels.refreshFailed)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: labels.disable })
      .disabled,
  ).toBe(true);
  fireEvent.submit(input.closest("form")!);
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("conceals cached settings on authoritative denial until fresh reads succeed", () => {
  const labels = en.auth.twoFactor.settings;
  const view = render(wrap("en"));
  expect(screen.getByText(labels.enabled)).toBeTruthy();

  mocks.meError = { message: "Forbidden", data: { code: "FORBIDDEN" } };
  view.rerender(wrap("en"));
  expect(screen.getByText(labels.accessDenied)).toBeTruthy();
  expect(screen.queryByText(labels.enabled)).toBeNull();
  expect(screen.queryByLabelText(labels.currentPassword)).toBeNull();

  // Transport failure after denial keeps settings concealed.
  mocks.meError = { message: "Network error" };
  view.rerender(wrap("en"));
  expect(screen.getByText(labels.accessDenied)).toBeTruthy();

  // Fresh authorized reads restore controls.
  mocks.meError = null;
  view.rerender(wrap("en"));
  expect(screen.getByText(labels.enabled)).toBeTruthy();
});

it("still allows disabling when enabled even if program flag or delivery is off", () => {
  const labels = en.auth.twoFactor.settings;
  mocks.meData = { twoFactorEnabled: true };
  mocks.featuresData = { EMAIL_2FA: false, EMAIL_DELIVERY_AVAILABLE: false };
  render(wrap("en"));
  const input = screen.getByLabelText<HTMLInputElement>(labels.currentPassword);
  fireEvent.change(input, { target: { value: "DisableMe123!" } });
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: labels.disable,
  });
  expect(button.disabled).toBe(false);
  fireEvent.submit(input.closest("form")!);
  expect(mocks.mutate).toHaveBeenCalledWith({
    enabled: false,
    currentPassword: "DisableMe123!",
  });
});

it("offers read-only retry after an accepted toggle whose post-write refresh fails", async () => {
  const labels = en.auth.twoFactor.settings;
  mocks.meRefetch.mockRejectedValueOnce(new Error("Post-write read failed"));
  render(wrap("en"));

  const input = screen.getByLabelText<HTMLInputElement>(labels.currentPassword);
  fireEvent.change(input, { target: { value: "ValidPass123!" } });
  fireEvent.submit(input.closest("form")!);
  expect(mocks.mutate).toHaveBeenCalledOnce();

  await act(async () => {
    await mocks.onSuccess?.();
    mocks.onSettled?.();
  });

  expect(screen.getByText(labels.saved)).toBeTruthy();
  expect(screen.getByText(labels.savedRefreshFailed)).toBeTruthy();
  expect(input.disabled).toBe(true);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  });
  expect(mocks.mutate).toHaveBeenCalledOnce();
  expect(mocks.meRefetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(labels.savedRefreshFailed)).toBeNull();
});
