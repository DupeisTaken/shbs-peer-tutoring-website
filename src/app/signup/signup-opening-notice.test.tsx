import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { SignupOpeningNotice } from "./signup-opening-notice";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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
});
