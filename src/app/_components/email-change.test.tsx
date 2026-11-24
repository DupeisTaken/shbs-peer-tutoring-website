// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

type QueryError = { message: string; data?: { code?: string } } | null;
type EmailSettingsData = {
  email: string;
  deliveryAvailable: boolean;
  secondaryEmailBindingEnabled: boolean;
  emails: { email: string; verifiedAt: Date | null }[];
};

const mocks = vi.hoisted(() => {
  const state: {
    routerRefresh: ReturnType<typeof vi.fn>;
    settingsRefetch: ReturnType<
      typeof vi.fn<
        () => Promise<{
          isSuccess: boolean;
          data: EmailSettingsData | undefined;
        }>
      >
    >;
    invalidateMe: ReturnType<typeof vi.fn>;
    invalidateProfile: ReturnType<typeof vi.fn>;
    requestMutate: ReturnType<typeof vi.fn>;
    requestReset: ReturnType<typeof vi.fn>;
    confirmMutate: ReturnType<typeof vi.fn>;
    confirmReset: ReturnType<typeof vi.fn>;
    settingsData: EmailSettingsData | undefined;
    settingsError: QueryError;
    settingsFetching: boolean;
    requestPending: boolean;
    requestError: QueryError;
    confirmPending: boolean;
    confirmError: QueryError;
    requestOnSuccess: null | ((_: unknown, input: { email: string }) => void);
    requestOnSettled: null | (() => void);
    confirmOnSuccess: null | (() => Promise<void>);
    confirmOnSettled: null | (() => void);
  } = {
    routerRefresh: vi.fn(),
    settingsRefetch: vi.fn(),
    invalidateMe: vi.fn(),
    invalidateProfile: vi.fn(),
    requestMutate: vi.fn(),
    requestReset: vi.fn(),
    confirmMutate: vi.fn(),
    confirmReset: vi.fn(),
    settingsData: {
      email: "primary@example.test",
      deliveryAvailable: true,
      secondaryEmailBindingEnabled: false,
      emails: [{ email: "primary@example.test", verifiedAt: new Date() }],
    },
    settingsError: null,
    settingsFetching: false,
    requestPending: false,
    requestError: null,
    confirmPending: false,
    confirmError: null,
    requestOnSuccess: null,
    requestOnSettled: null,
    confirmOnSuccess: null,
    confirmOnSettled: null,
  };
  return state;
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      account: { me: { invalidate: mocks.invalidateMe } },
      tutor: { myProfile: { invalidate: mocks.invalidateProfile } },
    }),
    account: {
      emailSettings: {
        useQuery: () => ({
          data: mocks.settingsData,
          error: mocks.settingsError,
          isFetching: mocks.settingsFetching,
          isSuccess: Boolean(mocks.settingsData) && !mocks.settingsError,
          refetch: mocks.settingsRefetch,
        }),
      },
      requestEmailChange: {
        useMutation: (options: {
          onSuccess?: (_: unknown, input: { email: string }) => void;
          onSettled?: () => void;
        }) => {
          mocks.requestOnSuccess = options.onSuccess ?? null;
          mocks.requestOnSettled = options.onSettled ?? null;
          return {
            mutate: mocks.requestMutate,
            reset: mocks.requestReset,
            isPending: mocks.requestPending,
            error: mocks.requestError,
          };
        },
      },
      confirmEmailChange: {
        useMutation: (options: {
          onSuccess?: () => Promise<void>;
          onSettled?: () => void;
        }) => {
          mocks.confirmOnSuccess = options.onSuccess ?? null;
          mocks.confirmOnSettled = options.onSettled ?? null;
          return {
            mutate: mocks.confirmMutate,
            reset: mocks.confirmReset,
            isPending: mocks.confirmPending,
            error: mocks.confirmError,
          };
        },
      },
    },
  },
}));

import { EmailChange } from "./email-change";

const wrap = (locale: "en" | "zh" = "en", embedded = true) => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "zh" ? zh : en}
  >
    <EmailChange embedded={embedded} />
  </NextIntlClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    settingsData: {
      email: "primary@example.test",
      deliveryAvailable: true,
      secondaryEmailBindingEnabled: false,
      emails: [{ email: "primary@example.test", verifiedAt: new Date() }],
    },
    settingsError: null,
    settingsFetching: false,
    requestPending: false,
    requestError: null,
    confirmPending: false,
    confirmError: null,
  });
  mocks.settingsRefetch.mockImplementation(async () => ({
    isSuccess: Boolean(mocks.settingsData) && !mocks.settingsError,
    data: mocks.settingsData,
  }));
  mocks.invalidateMe.mockResolvedValue(undefined);
  mocks.invalidateProfile.mockResolvedValue(undefined);
});
afterEach(cleanup);

it.each([
  { locale: "en" as const, messages: en },
  { locale: "zh" as const, messages: zh },
])(
  "completes primary-email replacement when secondary binding is disabled and refreshes the server shell ($locale)",
  async ({ locale, messages }) => {
    render(wrap(locale));
    const t = messages.emailChange;
    const emailInput = screen.getByLabelText<HTMLInputElement>(t.email);
    const passwordInput = screen.getByLabelText<HTMLInputElement>(t.password);
    fireEvent.change(emailInput, {
      target: { value: "  NewPrimary@Example.Test " },
    });
    fireEvent.change(passwordInput, { target: { value: "CurrentPass123!" } });
    fireEvent.submit(emailInput.closest("form")!);

    expect(mocks.requestMutate).toHaveBeenCalledWith({
      email: "NewPrimary@Example.Test",
      currentPassword: "CurrentPass123!",
    });

    await act(async () => {
      mocks.requestOnSuccess?.(
        { ok: true },
        { email: "NewPrimary@Example.Test" },
      );
      mocks.requestOnSettled?.();
    });

    expect(screen.getByText(/newprimary@example\.test/)).toBeTruthy();

    // Can return to address entry with "Use another email".
    fireEvent.click(screen.getByRole("button", { name: t.changeAddress }));
    expect(screen.getByLabelText(t.email)).toBeTruthy();

    // Request again and verify.
    fireEvent.change(screen.getByLabelText(t.password), {
      target: { value: "CurrentPass123!" },
    });
    fireEvent.submit(screen.getByLabelText(t.email).closest("form")!);
    await act(async () => {
      mocks.requestOnSuccess?.(
        { ok: true },
        { email: "NewPrimary@Example.Test" },
      );
      mocks.requestOnSettled?.();
    });

    const codeInput = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(codeInput, { target: { value: "0421" } });
    fireEvent.submit(codeInput.closest("form")!);
    expect(mocks.confirmMutate).toHaveBeenCalledWith({ code: "0421" });

    await act(async () => {
      await mocks.confirmOnSuccess?.();
      mocks.confirmOnSettled?.();
    });

    expect(screen.getByText(t.success)).toBeTruthy();
    expect(mocks.settingsRefetch).toHaveBeenCalledOnce();
    expect(mocks.invalidateMe).toHaveBeenCalledOnce();
    expect(mocks.invalidateProfile).toHaveBeenCalledOnce();
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
  },
);

it("recovers a committed confirmation whose refresh failed using reads only", async () => {
  mocks.settingsRefetch.mockRejectedValueOnce(new Error("Refresh failed"));
  render(wrap("en"));
  fireEvent.change(screen.getByLabelText(en.emailChange.email), {
    target: { value: "fresh@example.test" },
  });
  fireEvent.change(screen.getByLabelText(en.emailChange.password), {
    target: { value: "Pass123!" },
  });
  fireEvent.submit(
    screen.getByLabelText(en.emailChange.email).closest("form")!,
  );
  await act(async () => {
    mocks.requestOnSuccess?.({ ok: true }, { email: "fresh@example.test" });
    mocks.requestOnSettled?.();
  });

  fireEvent.change(screen.getByRole("textbox"), { target: { value: "1234" } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await act(async () => {
    await mocks.confirmOnSuccess?.();
    mocks.confirmOnSettled?.();
  });

  expect(screen.getByText(en.emailChange.success)).toBeTruthy();
  expect(screen.getByText(en.emailChange.savedRefreshFailed)).toBeTruthy();
  expect(mocks.routerRefresh).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  });
  expect(mocks.confirmMutate).toHaveBeenCalledOnce();
  expect(mocks.settingsRefetch).toHaveBeenCalledTimes(2);
  expect(mocks.routerRefresh).toHaveBeenCalledOnce();
  expect(screen.queryByText(en.emailChange.savedRefreshFailed)).toBeNull();
});

it("blocks submission when delivery is unavailable and conceals on access denial", () => {
  mocks.settingsData = {
    email: "primary@example.test",
    deliveryAvailable: false,
    secondaryEmailBindingEnabled: false,
    emails: [{ email: "primary@example.test", verifiedAt: new Date() }],
  };
  const view = render(wrap("en"));
  expect(screen.getByText(en.emailChange.unavailable)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.emailChange.send,
    }).disabled,
  ).toBe(true);

  mocks.settingsError = { message: "Denied", data: { code: "UNAUTHORIZED" } };
  view.rerender(wrap("en"));
  expect(screen.getByText(en.participantRecovery.accessDenied)).toBeTruthy();
  expect(screen.queryByLabelText(en.emailChange.email)).toBeNull();
});
