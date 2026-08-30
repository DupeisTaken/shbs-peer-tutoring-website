/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
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
  it("shows the quarter, countdown, and linked preview sheet before opening", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <SignupOpeningNotice
          quarter="Q3"
          opensAt="2026-09-01T00:00:00.000Z"
          previewUrl="https://example.com/preview-sheet"
          serverNow="2026-08-30T00:00:00.000Z"
        />
      </NextIntlClientProvider>,
    );

    expect(markup).toContain("Q3 Tutee Signups will open by");
    expect(markup).toContain('role="timer"');
    expect(markup).toContain('href="https://example.com/preview-sheet"');
    expect(markup).toContain("You may preview the sheet");
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
          quarter="Q3"
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
