// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(), invalidate: vi.fn(), enabled: true, delivery: true,
  pending: false, success: false, recover: false, error: null as null | { message: string },
}));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ account: { me: { invalidate: mocks.invalidate } } }),
  program: { features: { useQuery: () => ({ data: { EMAIL_2FA: true, EMAIL_DELIVERY_AVAILABLE: mocks.delivery } }) } },
  account: {
    me: { useQuery: () => ({ data: { twoFactorEnabled: mocks.enabled } }) },
    setTwoFactorEnabled: { useMutation: (options: { onSuccess: () => Promise<void> }) => ({
      mutate: (input: unknown) => { mocks.mutate(input); if (mocks.recover) void options.onSuccess(); },
      isPending: mocks.pending, isSuccess: mocks.success, error: mocks.error,
    }) },
  },
} }));
import { TwoFactorSettings } from "./two-factor-settings";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, { enabled: true, delivery: true, pending: false, success: false, recover: false, error: null });
});
afterEach(cleanup);

it.each([{ locale: "en", messages: en }, { locale: "zh", messages: zh }])(
  "shows exhaustion, preserves the draft during pending/error states and clears it only after recovery ($locale)",
  async ({ locale, messages }) => {
    const labels = messages.auth.twoFactor.settings;
    const ui = () => <NextIntlClientProvider locale={locale} messages={messages}><TwoFactorSettings /></NextIntlClientProvider>;
    const view = render(ui());
    const input = screen.getByLabelText<HTMLInputElement>(labels.currentPassword);
    fireEvent.change(input, { target: { value: "SyntheticPassword239!" } });
    input.focus();
    fireEvent.submit(input.closest("form")!);
    expect(mocks.mutate).toHaveBeenCalledWith({ enabled: false, currentPassword: "SyntheticPassword239!" });

    mocks.pending = true;
    view.rerender(ui());
    expect(screen.getByRole<HTMLButtonElement>("button", { name: labels.saving }).disabled).toBe(true);
    expect(input.value).toBe("SyntheticPassword239!");
    mocks.pending = false;
    mocks.error = { message: "Too many password confirmations. Wait fifteen minutes before trying again." };
    view.rerender(ui());
    expect(screen.getByText(mocks.error.message)).toBeTruthy();
    expect(input.value).toBe("SyntheticPassword239!");
    expect(document.activeElement).toBe(input);
    expect(mocks.invalidate).not.toHaveBeenCalled();

    // The server decides when the budget recovers; a later successful response clears secrets.
    mocks.error = null;
    mocks.recover = true;
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(input.value).toBe(""));
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    mocks.enabled = false;
    mocks.success = true;
    view.rerender(ui());
    expect(screen.getByText(labels.saved)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: labels.enable }).disabled).toBe(true);
  },
);
