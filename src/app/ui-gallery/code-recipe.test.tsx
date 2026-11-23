/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { CodeRecipe } from "./code-recipe";

afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "exercises purpose-tinted code inputs, legacy format, error/pending states and lifecycle metadata in %s",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    const isZh = locale === "zh";
    render(
      <NextIntlClientProvider
        locale={locale}
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <CodeRecipe locale={locale} />
      </NextIntlClientProvider>,
    );

    const invitationInput = screen.getByLabelText<HTMLInputElement>(
      `${messages.codes.invitationLabel} ${messages.signupFields.required}`,
    );
    fireEvent.click(
      screen.getByRole("button", { name: isZh ? "旧格式示例" : "Legacy example" }),
    );
    expect(invitationInput.value).toBe("A1B2C3D4E5F6");

    fireEvent.click(
      screen.getByRole("button", { name: isZh ? "切换错误状态" : "Toggle error" }),
    );
    expect(invitationInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(
      isZh ? "示例验证码不正确" : "example code was incorrect",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: isZh ? "切换待处理状态" : "Toggle pending",
      }),
    );
    expect(invitationInput.matches(":disabled")).toBe(true);

    const sourceSelect = screen.getByRole("combobox", {
      name: isZh ? "签发来源" : "Issue source",
    });
    fireEvent.change(sourceSelect, { target: { value: "crewApplication" } });
    expect(
      screen.getAllByText(messages.admin.registrationCodes.source.crewApplication)
        .length,
    ).toBeGreaterThanOrEqual(2);

    const lifecycleSelect = screen.getByRole("combobox", {
      name: isZh ? "可用状态" : "Lifecycle state",
    });
    fireEvent.change(lifecycleSelect, {
      target: { value: "applicationInvalid" },
    });
    expect(
      screen.getAllByText(
        messages.admin.registrationCodes.unavailableReason.applicationInvalid,
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/alex\.chen@example\.edu/)).toBeTruthy();
  },
);
