/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as React from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import type { ResetState } from "./actions";

const state = vi.hoisted(() => ({
  result: undefined as ResetState,
  action: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useActionState: () => [state.result, state.action, false],
}));
vi.mock("./actions", () => ({ resetPasswordAction: state.action }));
import { ResetPasswordForm } from "./reset-password-form";

beforeEach(() => {
  state.result = undefined;
  state.action.mockReset();
});
afterEach(cleanup);
it.each(["en", "zh"] as const)(
  "bounds both new credential fields and retains the draft under localized length feedback in %s",
  (locale) => {
    const catalog = locale === "en" ? en : zh;
    const ui = () => (
      <NextIntlClientProvider locale={locale} messages={catalog}>
        <ResetPasswordForm token="synthetic-reset-token" />
      </NextIntlClientProvider>
    );
    const rendered = render(ui());
    const password = screen.getByLabelText<HTMLInputElement>((name) =>
      name.startsWith(catalog.auth.reset.fields.newPassword),
    );
    const confirmation = screen.getByLabelText<HTMLInputElement>((name) =>
      name.startsWith(catalog.auth.reset.fields.confirmPassword),
    );
    for (const input of [password, confirmation]) {
      expect(input.minLength).toBe(8);
      expect(input.maxLength).toBe(1024);
      expect(input.autocomplete).toBe("new-password");
      fireEvent.change(input, { target: { value: "RetainedResetDraft123!" } });
    }
    const hint = document.getElementById(
      password.getAttribute("aria-describedby")!,
    );
    expect(hint?.textContent).toBe(
      catalog.auth.reset.passwordLength
        .replace("{min}", "8")
        .replace("{max}", "1024"),
    );
    state.result = {
      error: "Server fallback must not override localized field feedback",
      code: "password-length",
    };
    rendered.rerender(ui());
    expect(screen.getByRole("alert").textContent).toBe(hint?.textContent);
    expect(password.value).toBe("RetainedResetDraft123!");
    expect(confirmation.value).toBe("RetainedResetDraft123!");
    expect(state.action).not.toHaveBeenCalled();
  },
);
