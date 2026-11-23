// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import {
  canViewEmailQuota,
  EmailQuotaCard,
  EmailQuotaCardSkeleton,
  renderEmailQuotaCard,
} from "./email-quota-card";

const mocks = vi.hoisted(() => ({
  locale: "en",
  auth: vi.fn(),
  account: vi.fn(),
  quota: vi.fn(),
  resetTime: vi.fn(),
  enabled: vi.fn(),
}));

vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: { user: { findUnique: mocks.account } } }));
vi.mock("~/server/email/aliyun-quota", () => ({
  aliyunQuotaEnabled: mocks.enabled,
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
  mocks.enabled.mockReturnValue(true);
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

it("shows localized daily availability, structured free balance and the confirmed reset time", async () => {
  render(await EmailQuotaCard());
  expect(screen.getByRole("heading", { name: "Email Quota" })).toBeTruthy();
  expect(screen.getByText("Daily Free Quota")).toBeTruthy();
  expect(screen.getByText("137 / 200")).toBeTruthy();
  expect(screen.getByText("emails left today")).toBeTruthy();
  expect(screen.getByText("Total Free Balance")).toBeTruthy();
  expect(screen.getByText("1,842")).toBeTruthy();
  expect(screen.getByText("emails remaining")).toBeTruthy();
  expect(
    screen.getByText("One-time free allowance; does not reset daily."),
  ).toBeTruthy();
  expect(screen.getByText(/Daily quota resets at 00:00.*GMT\+8/)).toBeTruthy();
  expect(screen.queryByText("Low Quota")).toBeNull();
  expect(screen.queryByText("Unavailable")).toBeNull();
});

it("localizes an exhausted balance and an unconfigured reset time for Head", async () => {
  mocks.locale = "zh";
  mocks.account.mockResolvedValue({ role: "HEAD" });
  mocks.quota.mockResolvedValue({ dailyRemaining: 0, balanceRemaining: 0 });
  mocks.resetTime.mockReturnValue(null);
  render(await EmailQuotaCard());
  expect(screen.getByRole("heading", { name: "邮件额度" })).toBeTruthy();
  expect(screen.getByText("免费余额已用完")).toBeTruthy();
  expect(screen.getByText("0 / 200")).toBeTruthy();
  expect(screen.getByText("0")).toBeTruthy();
  expect(screen.getByText("封剩余邮件")).toBeTruthy();
  expect(
    screen.getByText("免费余额已用完，每日重置不会补充免费额度。"),
  ).toBeTruthy();
  expect(screen.getByText("每日额度按天重置，暂未配置重置时间。")).toBeTruthy();
});

it("distinguishes daily limit reached from free balance exhaustion", async () => {
  mocks.quota.mockResolvedValue({ dailyRemaining: 0, balanceRemaining: 900 });
  render(await EmailQuotaCard());
  expect(screen.getByText("Daily Limit Reached")).toBeTruthy();
  expect(screen.queryByText("Free Balance Exhausted")).toBeNull();
  expect(screen.getByText("900")).toBeTruthy();
  expect(
    screen.getByText("One-time free allowance; does not reset daily."),
  ).toBeTruthy();
});

it("keeps a known balance visible when the daily field is unavailable", async () => {
  mocks.quota.mockResolvedValue({ dailyRemaining: null, balanceRemaining: 1 });
  render(await EmailQuotaCard());
  expect(screen.getByText("Low Quota")).toBeTruthy();
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.getByText("Daily free quota unavailable.")).toBeTruthy();
  expect(screen.getByText("1")).toBeTruthy();
  expect(screen.getByText("email remaining")).toBeTruthy();
});

it("shows an unavailable state without implying email delivery is broken if the lookup fails", async () => {
  mocks.quota.mockResolvedValue(null);
  render(await EmailQuotaCard());
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(
    screen.getByText("Email quota is currently unavailable."),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Could not read the Direct Mail free allowance. Email delivery is not affected.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/emails remaining/)).toBeNull();
});

it("renders an accessible loading skeleton that reserves the card region", () => {
  render(
    <EmailQuotaCardSkeleton
      title="Email Quota"
      loadingLabel="Loading email quota…"
    />,
  );
  const region = screen.getByRole("region", { name: "Email Quota" });
  expect(region.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByRole("status").textContent).toBe("Loading email quota…");
});

it("skips the role and provider reads when quota monitoring is disabled", async () => {
  mocks.enabled.mockReturnValue(false);
  expect(await renderEmailQuotaCard("h3")).toBeNull();
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.quota).not.toHaveBeenCalled();
});

it("uses a nested heading when rendered within delivery settings", async () => {
  render(await EmailQuotaCard({ heading: "h3" }));
  expect(
    screen.getByRole("heading", { name: "Email Quota", level: 3 }),
  ).toBeTruthy();
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
    expect(await canViewEmailQuota()).toBe(false);
    expect(await renderEmailQuotaCard("h3")).toBeNull();
    expect(await EmailQuotaCard()).toBeNull();
    expect(mocks.quota).not.toHaveBeenCalled();
  },
);

it("does not query Aliyun when signed out", async () => {
  mocks.auth.mockResolvedValue(null);
  expect(await canViewEmailQuota()).toBe(false);
  expect(await EmailQuotaCard()).toBeNull();
  expect(mocks.account).not.toHaveBeenCalled();
  expect(mocks.quota).not.toHaveBeenCalled();
});
