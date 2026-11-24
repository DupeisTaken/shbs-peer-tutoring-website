// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ResetPasswordForm } from "./reset-password-form";

const mocks = vi.hoisted(() => ({
  action: vi.fn<(...args: unknown[]) => Promise<undefined>>(),
}));
vi.mock("./actions", () => ({
  resetPasswordAction: (...args: unknown[]) => mocks.action(...args),
}));

afterEach(cleanup);

it.each([
  { locale: "en" as const, messages: en },
  { locale: "zh" as const, messages: zh },
])(
  "enforces 8–1024 client bounds and describes the length rule ($locale)",
  ({ locale, messages }) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ResetPasswordForm token="synthetic-token" />
      </NextIntlClientProvider>,
    );
    const password = screen.getByLabelText<HTMLInputElement>(
      new RegExp(`^${messages.auth.reset.fields.newPassword}`),
    );
    const confirm = screen.getByLabelText<HTMLInputElement>(
      messages.auth.reset.fields.confirmPassword,
    );
    expect(password.minLength).toBe(8);
    expect(password.maxLength).toBe(1024);
    expect(confirm.minLength).toBe(8);
    expect(confirm.maxLength).toBe(1024);
    expect(password.getAttribute("aria-describedby")).toBe(
      "reset-password-length",
    );
    expect(screen.getByText(/8–1024/)).toBeTruthy();

    fireEvent.change(password, { target: { value: "a".repeat(1024) } });
    fireEvent.change(confirm, { target: { value: "a".repeat(1024) } });
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.auth.reset.submit,
      }).disabled,
    ).toBe(false);
  },
);
