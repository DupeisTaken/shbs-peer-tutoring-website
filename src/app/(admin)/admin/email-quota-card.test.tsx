// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { EmailQuotaCard } from "./email-quota-card";

const mocks = vi.hoisted(() => ({
  locale: "en",
  auth: vi.fn(),
  account: vi.fn(),
  quota: vi.fn(),
  resetTime: vi.fn(),
}));

vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: { user: { findUnique: mocks.account } } }));
vi.mock("~/server/email/aliyun-quota", () => ({
  aliyunQuotaResetTime: mocks.resetTime,
  DAILY_FREE_EMAIL_LIMIT: 200,
  getAliyunEmailQuota: mocks.quota,
}));
vi.mock("next-intl/server", () => ({
  getFormatter: () => createFormatter({ locale: mocks.locale }),
  getTranslations: () =>
    createTranslator({
      locale: mocks.locale,
      messages: (mocks.locale === "en" ? en : zh).admin.dashboard.emailQuota,
    }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = "en";
  mocks.auth.mockResolvedValue({
    user: { id: "synthetic-admin" },
    role: "ADMIN",
  });
  mocks.account.mockResolvedValue({
    role: "ADMIN",
    suspendedAt: null,
    mergedIntoId: null,
    recoveryVoidedAt: null,
  });
  mocks.quota.mockResolvedValue({
    dailyRemaining: 137,
    balanceRemaining: 1842,
  });
  mocks.resetTime.mockReturnValue(new Date("2000-01-01T16:00:00Z"));
});

afterEach(cleanup);

it("shows localized daily availability, free balance and the confirmed reset time", async () => {
  render(await EmailQuotaCard());
  expect(screen.getByRole("heading", { name: "Email Quota" })).toBeTruthy();
  expect(screen.getByText("137 / 200")).toBeTruthy();
  expect(screen.getByText("free emails left today")).toBeTruthy();
  expect(
    screen.getByText("Free balance has 1,842 emails remaining."),
  ).toBeTruthy();
  expect(screen.getByText(/Daily quota resets at 00:00.*GMT\+8/)).toBeTruthy();
});

it("localizes an exhausted balance and an unknown reset time for Head", async () => {
  mocks.locale = "zh";
  mocks.account.mockResolvedValue({ role: "HEAD" });
  mocks.quota.mockResolvedValue({ dailyRemaining: 0, balanceRemaining: 0 });
  mocks.resetTime.mockReturnValue(null);
  render(await EmailQuotaCard());
  expect(screen.getByRole("heading", { name: "邮件额度" })).toBeTruthy();
  expect(screen.getByText("0 / 200")).toBeTruthy();
  expect(screen.getByText("免费余额还可发送 0 封邮件。")).toBeTruthy();
  expect(screen.getByText("额度每日重置，具体时间未知。")).toBeTruthy();
});

it("keeps a known balance visible when the daily field is unavailable", async () => {
  mocks.quota.mockResolvedValue({ dailyRemaining: null, balanceRemaining: 1 });
  render(await EmailQuotaCard());
  expect(screen.getByText("Daily free quota unavailable.")).toBeTruthy();
  expect(screen.getByText("Free balance has 1 email remaining.")).toBeTruthy();
});

it("shows an unavailable state if the provider lookup fails", async () => {
  mocks.quota.mockResolvedValue(null);
  render(await EmailQuotaCard());
  expect(
    screen.getByText("Email quota is currently unavailable."),
  ).toBeTruthy();
  expect(screen.queryByText(/emails remaining/)).toBeNull();
});

it.each([
  { role: "VIEWER" },
  { role: "COORDINATOR" },
  { role: "ADMIN", suspendedAt: new Date() },
  { role: "ADMIN", mergedIntoId: "other-account" },
  { role: "ADMIN", recoveryVoidedAt: new Date() },
  null,
])(
  "hides data and skips the provider for an ineligible current account %#",
  async (account) => {
    mocks.account.mockResolvedValue(account);
    expect(await EmailQuotaCard()).toBeNull();
    expect(mocks.quota).not.toHaveBeenCalled();
  },
);

it("does not query Aliyun when signed out", async () => {
  mocks.auth.mockResolvedValue(null);
  expect(await EmailQuotaCard()).toBeNull();
  expect(mocks.account).not.toHaveBeenCalled();
  expect(mocks.quota).not.toHaveBeenCalled();
});
