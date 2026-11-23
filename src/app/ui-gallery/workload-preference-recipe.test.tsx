/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { WorkloadPreferenceRecipe } from "./workload-preference-recipe";

afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

it.each(["en", "zh"] as const)(
  "uses an entrance card dialog that retains independent drafts, restores focus and exercises advisory warnings in %s",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <WorkloadPreferenceRecipe />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText(
        locale === "en"
          ? /1 assigned block.*Preferred sessions: 1/
          : /1 个已分配时段.*期望辅导次数：1/,
      ),
    ).toBeTruthy();

    const trigger = screen.getByRole("button", {
      name: new RegExp(messages.dashboard.availability.edit),
    });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    const availability = within(dialog).getByRole("button", {
      name: "15:00–16:00",
    });
    const choice = within(dialog).getByRole("button", { name: "4" });
    fireEvent.click(availability);
    fireEvent.click(choice);
    expect(availability.getAttribute("aria-pressed")).toBe("true");
    expect(choice.getAttribute("aria-pressed")).toBe("true");

    // Closing the dialog without saving retains both unsaved drafts and restores focus.
    fireEvent.click(
      within(dialog).getByRole("button", { name: messages.accountProfile.close }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Advisory warning still reflects saved preference (1), not unsaved draft (4).
    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "en" ? "Try assigning a session" : "尝试分配辅导",
      }),
    );
    expect(
      screen.getByText(
        locale === "en"
          ? /This assignment would result in 2/
          : /此分配将使辅导次数达到 2/,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "en" ? "Continue" : "继续",
      }),
    );

    // Reopening the entrance dialog shows retained drafts and permits saving/clearing.
    fireEvent.click(trigger);
    const reopened = screen.getByRole("dialog");
    expect(
      within(reopened)
        .getByRole("button", { name: "15:00–16:00" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(reopened)
        .getByRole("button", { name: "4" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(
      within(reopened).getByRole("button", {
        name: locale === "en" ? "Save preference" : "保存偏好",
      }),
    );
    fireEvent.click(
      within(reopened).getByRole("button", {
        name: locale === "en" ? "Clear preference" : "清除偏好",
      }),
    );
    expect(
      [0, 1, 2, 3, 4].every(
        (value) =>
          within(reopened)
            .getByRole("button", { name: String(value) })
            .getAttribute("aria-pressed") === "false",
      ),
    ).toBe(true);
    expect(
      screen.queryByText(
        locale === "en" ? /This assignment would result/ : /此分配将使/,
      ),
    ).toBeNull();
  },
);
