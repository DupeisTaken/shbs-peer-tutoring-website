/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ErrorRecoveryRecipe } from "./error-recovery-recipe";

afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "maps client errors to localized copy without leaking internals and exercises route error recovery in %s",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    const isZh = locale === "zh";
    render(
      <NextIntlClientProvider
        locale={locale}
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <ErrorRecoveryRecipe locale={locale} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText(messages.errorRecovery.conflict)).toBeTruthy();

    const selector = screen.getByRole("combobox", {
      name: isZh ? "模拟客户端错误" : "Simulated client error",
    });
    fireEvent.change(selector, { target: { value: "INTERNAL_SERVER_ERROR" } });
    expect(screen.getByRole("alert").textContent).toContain(
      messages.errorRecovery.internal,
    );
    expect(screen.queryByText(/PrismaClientKnownRequestError/)).toBeNull();

    fireEvent.change(selector, { target: { value: "NETWORK" } });
    expect(screen.getByRole("alert").textContent).toContain(
      messages.errorRecovery.network,
    );

    fireEvent.click(
      screen.getByRole("button", { name: messages.uiPatterns.retry }),
    );
    expect(
      screen.getByText(isZh ? "本地重试次数: 1" : "Local retries: 1"),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: isZh ? "模拟路由错误" : "Simulate route error",
      }),
    );
    expect(screen.getByText(messages.pageRecovery.errorTitle)).toBeTruthy();
    expect(screen.getByText(messages.pageRecovery.errorBody)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: messages.workflows.home })
        .getAttribute("href"),
    ).toBe("/");

    const retryButtons = screen.getAllByRole("button", {
      name: messages.uiPatterns.retry,
    });
    fireEvent.click(retryButtons.at(-1)!);
    expect(screen.getByRole("status").textContent).toContain(
      isZh ? "已在本示例中恢复路由显示" : "Route recovered in this synthetic example",
    );
  },
);
