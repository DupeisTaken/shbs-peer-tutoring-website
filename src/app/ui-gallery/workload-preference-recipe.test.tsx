/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { WorkloadPreferenceRecipe } from "./workload-preference-recipe";
afterEach(cleanup);
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
          ? /1 assigned block.*Preferred maximum: 1/
          : /1 个已分配时段.*期望上限：1/,
      ),
    ).toBeTruthy();
    fireEvent.change(select, { target: { value: "4" } });
    expect(
      screen.getByText(
        locale === "en"
          ? /This change would result in 2/
          : /此更改将使已分配时段达到 2/,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "en" ? "Save preference" : "保存偏好",
      }),
    );
    expect(
      screen.queryByText(
        locale === "en" ? /This change would result/ : /此更改将使/,
      ),
    ).toBeNull();
  },
);
