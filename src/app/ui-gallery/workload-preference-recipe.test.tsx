/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { WorkloadPreferenceRecipe } from "./workload-preference-recipe";
afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
});
it.each(["en", "zh"] as const)(
  "demonstrates a shared block, independent optional draft/save and advisory warning in %s without API access",
  (locale) => {
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
      >
        <WorkloadPreferenceRecipe />
      </NextIntlClientProvider>,
    );
    const select = screen.getByRole<HTMLSelectElement>("combobox");
    expect(
      screen.getByText(
        locale === "en"
          ? /1 assigned block.*Preferred sessions: 1/
          : /1 个已分配时段.*期望辅导次数：1/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(select, { target: { value: "4" } });
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
    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "en" ? "Save preference" : "保存偏好",
      }),
    );
    expect(
      screen.queryByText(
        locale === "en" ? /This assignment would result/ : /此分配将使/,
      ),
    ).toBeNull();
  },
);
