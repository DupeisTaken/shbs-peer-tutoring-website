// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { SignupSourceBadge } from "./signup-source-badge";
afterEach(cleanup);
it.each([
  ["en", "STAFF", "Staff-entered"],
  ["en", "SELF_SERVICE", "Self-service"],
  ["en", "UNKNOWN", "Earlier signup"],
  ["zh", "STAFF", "工作人员录入"],
  ["zh", "SELF_SERVICE", "自主报名"],
  ["zh", "UNKNOWN", "早期报名"],
])(
  "renders %s provenance %s without a management-status label",
  (locale, source, label) => {
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
      >
        <SignupSourceBadge source={source} />
      </NextIntlClientProvider>,
    );
    const badge = screen.getByText(label);
    expect(badge.className).toBe("badge-slate");
    expect(badge.getAttribute("title")).toContain(
      locale === "zh" ? "不会改变审批" : "does not change approval",
    );
    expect(screen.queryByText(/Manually managed/)).toBeNull();
  },
);
