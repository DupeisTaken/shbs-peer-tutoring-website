// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import es from "../../../messages/es.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import el from "../../../messages/el.json";
import de from "../../../messages/de.json";
import fr from "../../../messages/fr.json";

const state = vi.hoisted(() => ({
  cached: false,
  retry: vi.fn(),
  write: vi.fn(),
}));
vi.mock("~/trpc/react", () => {
  const mutation = {
    useMutation: () => ({ mutate: state.write, isPending: false }),
  };
  return {
    api: {
      account: {
        me: {
          useQuery: () => ({
            data: { role: "ADMIN", canTranslate: false },
            isSuccess: true,
            refetch: state.retry,
          }),
        },
      },
      i18n: {
        managedLanguages: {
          useQuery: () => ({
            data: state.cached
              ? [{ code: "en", label: "English", enabled: true, builtIn: true }]
              : undefined,
            error: new Error("Synthetic read failure"),
            isLoading: false,
            isSuccess: false,
            refetch: state.retry,
          }),
        },
        canManageLanguages: {
          useQuery: () => ({
            data: true,
            isSuccess: true,
            refetch: state.retry,
          }),
        },
        addLanguage: mutation,
        reorderLanguages: mutation,
        deleteLanguage: mutation,
        setLanguageEnabled: mutation,
      },
      useUtils: () => ({
        i18n: {
          managedLanguages: { invalidate: vi.fn() },
          languages: { invalidate: vi.fn() },
        },
      }),
    },
  };
});
import { LanguagesPanel } from "./languages-panel";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.cached = false;
});

for (const [locale, messages] of Object.entries({ en, zh })) {
  for (const cached of [false, true]) {
    it(`renders authored ${locale} managed-read guidance and read-only Retry with cached=${cached}`, async () => {
      state.cached = cached;
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <LanguagesPanel canAdd={false} />
        </NextIntlClientProvider>,
      );
      expect(
        screen.getByText(messages.localization.languagesReadFailed),
      ).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toContain(
        "Synthetic read failure",
      );
      fireEvent.click(
        screen.getByRole("button", { name: messages.uiPatterns.retry }),
      );
      await waitFor(() => expect(state.retry).toHaveBeenCalledTimes(3));
      expect(state.write).not.toHaveBeenCalled();
    });
  }
}
for (const [locale, messages] of Object.entries({
  en,
  zh,
  es,
  ja,
  ko,
  el,
  de,
  fr,
})) {
  it(`uses existing authored Retry and positive managed-read guidance in ${locale}`, () => {
    expect(messages.uiPatterns.retry.trim().length).toBeGreaterThan(0);
    expect(
      messages.localization.languagesReadFailed.trim().length,
    ).toBeGreaterThan(0);
  });
}
