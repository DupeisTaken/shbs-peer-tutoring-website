/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const state = vi.hoisted(() => ({ binding: false }));
vi.mock("~/trpc/react", () => {
  const mutation = {
    useMutation: () => ({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    }),
  };
  return {
    api: {
      useUtils: () => ({
        account: {
          emailSettings: { invalidate: vi.fn() },
          me: { invalidate: vi.fn() },
        },
        tutor: { myProfile: { invalidate: vi.fn() } },
      }),
      account: {
        emailSettings: {
          _def: () => ({ path: ["account", "emailSettings"] }),
          useQuery: () => ({
            data: {
              email: "synthetic-primary@example.test",
              emails: [
                {
                  email: "synthetic-primary@example.test",
                  verifiedAt: new Date("2026-01-01"),
                },
              ],
              secondaryEmailBindingEnabled: state.binding,
              deliveryAvailable: true,
            },
            isLoading: false,
            error: null,
          }),
        },
        requestSecondaryEmail: mutation,
        confirmSecondaryEmail: mutation,
        manageSecondaryEmail: mutation,
        requestEmailChange: mutation,
        confirmEmailChange: mutation,
      },
    },
  };
});
import { AccountEmails } from "./account-emails";

const ui = (locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
    <AccountEmails />
  </NextIntlClientProvider>
);
beforeEach(() => {
  state.binding = false;
});
afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "keeps primary-only replacement reachable with binding off in %s",
  async (locale) => {
    const catalog = locale === "en" ? en : zh;
    render(ui(locale));
    expect(screen.getByText("synthetic-primary@example.test")).toBeTruthy();
    expect(
      screen.getByText(catalog.accountEmails.bindingDisabled),
    ).toBeTruthy();
    expect(screen.queryByLabelText(catalog.accountEmails.addLabel)).toBeNull();
    expect(screen.queryByLabelText(catalog.emailChange.email)).toBeNull();

    // Both account routes mount this manager. Its retained disclosure exposes the
    // independent primary-change proof flow even with no secondary addresses.
    fireEvent.click(screen.getByText(catalog.emailChange.title));
    const input = await screen.findByLabelText<HTMLInputElement>(
      catalog.emailChange.email,
    );
    fireEvent.change(input, { target: { value: "replacement@example.test" } });
    expect(
      screen.getByRole("button", { name: catalog.emailChange.send }),
    ).toBeTruthy();
    fireEvent.click(screen.getByText(catalog.emailChange.title));
    fireEvent.click(screen.getByText(catalog.emailChange.title));
    expect(
      (
        await screen.findByLabelText<HTMLInputElement>(
          catalog.emailChange.email,
        )
      ).value,
    ).toBe("replacement@example.test");
  },
);

it("offers normal optional address verification when secondary binding is enabled", () => {
  state.binding = true;
  render(ui());
  expect(screen.getByLabelText(en.accountEmails.addLabel)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: en.accountEmails.add }),
  ).toBeTruthy();
  expect(screen.getByText(en.emailChange.title)).toBeTruthy();
});
