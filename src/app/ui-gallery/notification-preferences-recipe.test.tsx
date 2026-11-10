// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { NotificationPreferencesRecipe } from "./notification-preferences-recipe";

afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "stages independent choices and permits badge edits with email disabled in %s",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    const t = messages.notificationPreferences;
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <NotificationPreferencesRecipe />
      </NextIntlClientProvider>,
    );
    const name = (pattern: string, category: string) =>
      pattern.replace("{category}", category);
    const badge = screen.getByRole<HTMLInputElement>("checkbox", {
      name: name(t.badgeFor, t.categories.tutoring),
    });
    const email = screen.getByRole<HTMLInputElement>("checkbox", {
      name: name(t.emailFor, t.categories.tutoring),
    });
    fireEvent.click(badge);
    fireEvent.click(email);
    fireEvent.click(
      screen.getByRole("button", { name: messages.uiPatterns.cancel }),
    );
    expect(badge.checked).toBe(true);
    expect(email.checked).toBe(false);
    fireEvent.click(email);
    fireEvent.click(
      screen.getByRole("checkbox", { name: messages.programEmail.enable }),
    );
    expect(email.disabled).toBe(true);
    expect(email.checked).toBe(false);
    expect(badge.disabled).toBe(false);
    fireEvent.click(badge);
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: messages.programEmail.enable }),
    );
    expect(email.checked).toBe(false);
    expect(badge.checked).toBe(false);
    expect(
      screen.queryByRole("checkbox", {
        name: name(t.badgeFor, t.categories.reminders),
      }),
    ).toBeNull();
    expect(screen.getByText(t.emailOnly)).toBeTruthy();
  },
);

it.each(["en", "zh"] as const)(
  "demonstrates a locked email and restores the saved choice after unlock in %s",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <NotificationPreferencesRecipe />
      </NextIntlClientProvider>,
    );
    const email = screen.getByRole<HTMLInputElement>("checkbox", {
      name: messages.notificationPreferences.emailFor.replace(
        "{category}",
        messages.notificationPreferences.categories.messages,
      ),
    });
    const lock = screen.getByRole("checkbox", {
      name: messages.notificationPreferences.lockDemo,
    });
    fireEvent.click(lock);
    expect(email.checked).toBe(true);
    expect(email.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.notificationPreferences.save,
      }),
    );
    fireEvent.click(lock);
    expect(email.checked).toBe(false);
    expect(email.disabled).toBe(false);
  },
);
