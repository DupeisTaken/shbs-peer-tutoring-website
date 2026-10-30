/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { SignupOpeningNotice } from "./signup-opening-notice";

const { refreshMock, routerMock } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refreshMock: refresh, routerMock: { refresh } };
});

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  refreshMock.mockReset();
});

describe("signup opening notice", () => {
  it("labels the opening instant's winter offset even when viewed in summer", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="America/New_York"
      >
        <SignupOpeningNotice
          periodLabel="Synthetic Q1"
          opensAt="2027-01-15T14:00:00Z"
          previewUrl={null}
          serverNow="2026-07-01T12:00:00Z"
        />
      </NextIntlClientProvider>,
    );
    expect(markup).toContain("EST (GMT-05:00)");
    expect(markup).not.toContain("EDT");
    expect(markup).toContain("9:00");
  });
  it("shows the quarter, countdown, and linked preview sheet before opening", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <SignupOpeningNotice
          periodLabel="2026–27 Q3"
          opensAt="2026-09-01T00:00:00.000Z"
          previewUrl="https://example.com/preview-sheet"
          serverNow="2026-08-30T00:00:00.000Z"
        />
      </NextIntlClientProvider>,
    );

    expect(markup).toContain("2026–27 Q3 Tutee Signup");
    expect(markup).toContain('role="timer"');
    expect(markup).toContain('href="https://example.com/preview-sheet"');
    expect(markup).toContain("Preview signup sheet");
    expect(markup).toContain("Days");
  });

  it("uses server-relative time and retries the opening refresh", async () => {
    vi.useFakeTimers();
    // A wildly fast client clock must not bypass the server-authored countdown.
    vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"));

    render(
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <SignupOpeningNotice
          periodLabel="2026–27 Q3"
          opensAt="2026-09-01T00:00:02.000Z"
          previewUrl="https://example.com/preview-sheet"
          serverNow="2026-09-01T00:00:00.000Z"
        />
      </NextIntlClientProvider>,
    );

    expect(refreshMock).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // If the first route refresh is stale or fails, retry after a bounded delay.
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });
});

// Heading, status and countdown carry distinct information in both supported public locales.
it.each(["en", "zh"] as const)(
  "keeps dates out of the heading and distinguishes opening kinds in %s",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    const view = (
      kind: "current" | "planned" | "scheduled" | "pending",
      now = "2026-08-30T00:00:00Z",
    ) => (
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <SignupOpeningNotice
          periodLabel="2026–27 Q4"
          currentPeriodLabel={kind === "current" ? undefined : "2026–27 Q3"}
          opensAt="2026-09-01T00:00:00Z"
          previewUrl={null}
          serverNow={now}
          sharedNowMs={new Date(now).getTime()}
          openingKind={kind}
        />
      </NextIntlClientProvider>
    );
    const mounted = render(view("planned"));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      messages.signupTransition.nextTitle.replace("{period}", "2026–27 Q4"),
    );
    expect(
      mounted.container.querySelector("time")?.getAttribute("dateTime"),
    ).toBe("2026-09-01T00:00:00Z");
    expect(screen.getByText(messages.signupBanner.plannedLabel)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      messages.signupBanner.plannedHelp,
    );
    expect(screen.getByRole("timer").getAttribute("aria-live")).toBe("off");
    expect(
      screen.queryByText(messages.public.signup.gate.noPreview),
    ).toBeNull();
    expect(mounted.container.textContent?.match(/2026–27 Q3/g)).toHaveLength(1);
    mounted.rerender(view("scheduled"));
    expect(screen.getByText(messages.signupBanner.scheduledLabel)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      messages.signupBanner.scheduledHelp,
    );
    expect(screen.queryByText(messages.signupBanner.plannedLabel)).toBeNull();
    mounted.rerender(view("pending"));
    expect(
      screen.getAllByText(messages.signupTransition.pendingActivation),
    ).toHaveLength(1);
    expect(screen.getByRole("timer")).toBeTruthy();
    mounted.rerender(view("pending", "2026-09-01T00:00:00Z"));
    expect(screen.queryByRole("timer")).toBeNull();
    expect(
      screen.getAllByText(messages.signupTransition.pendingActivation),
    ).toHaveLength(1);
    mounted.rerender(view("current", "2026-09-01T00:00:00Z"));
    expect(screen.getByRole("status").textContent).toBe(
      messages.signupBanner.checking,
    );
    expect(screen.queryByRole("timer")).toBeNull();
  },
);
