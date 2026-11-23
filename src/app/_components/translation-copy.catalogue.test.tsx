/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import es from "../../../messages/es.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import el from "../../../messages/el.json";
import de from "../../../messages/de.json";
import fr from "../../../messages/fr.json";
import { LOCALES, type Locale } from "~/i18n/config";
import { getMessageFallback } from "~/i18n/fallback";

const fixture = vi.hoisted(() => ({
  failed: false,
  cachedAccount: false,
  retry: vi.fn(),
  write: vi.fn(),
  fallback: vi.fn(),
  intlError: vi.fn(),
}));
vi.mock("./student-portal", () => ({ Pager: () => null }));
vi.mock("~/trpc/react", () => {
  const empty = { useQuery: () => ({ data: [], isLoading: false }) };
  const mutation = {
    useMutation: () => ({
      mutate: fixture.write,
      reset: vi.fn(),
      isPending: false,
      error: null,
    }),
  };
  return {
    api: {
      account: {
        me: {
          useQuery: () => ({
            data:
              fixture.failed && !fixture.cachedAccount
                ? undefined
                : { role: "ADMIN", canTranslate: true },
            error: fixture.failed
              ? new Error("Synthetic account read unavailable")
              : null,
            isLoading: false,
            refetch: fixture.retry,
          }),
        },
      },
      i18n: {
        managedLanguages: {
          useQuery: () => ({
            data: LOCALES.map((code) => ({ code, label: code })),
            isLoading: false,
          }),
        },
      },
      home: {
        content: {
          useQuery: () => ({
            data: [
              {
                key: "tagline",
                kind: "text",
                default: "Synthetic destination",
                override: null,
              },
            ],
            isLoading: false,
          }),
        },
        news: empty,
        sections: empty,
        pages: empty,
        setContent: mutation,
        setNewsTranslation: mutation,
        setSectionTranslation: mutation,
        setPageTitle: mutation,
      },
      useUtils: () => ({
        translationReview: { list: { invalidate: vi.fn() } },
        home: { invalidate: vi.fn() },
      }),
    },
  };
});

import { TranslationEditor } from "./translation-editor";

const catalogues = { en, zh, es, ja, ko, el, de, fr };
beforeEach(() => {
  vi.clearAllMocks();
  fixture.failed = false;
  fixture.cachedAccount = false;
  fixture.retry.mockResolvedValue({ data: {} });
});
afterEach(cleanup);

function editor(locale: Locale) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={catalogues[locale]}
      timeZone="Asia/Shanghai"
      onError={fixture.intlError}
      getMessageFallback={(info) => {
        fixture.fallback(info);
        return getMessageFallback(info);
      }}
    >
      <TranslationEditor initialView="website" />
    </NextIntlClientProvider>
  );
}

function expectResolvedCopy(container: HTMLElement) {
  expect(container.textContent).not.toContain("workflows.saveBoundary.form");
  expect(container.textContent).not.toContain("common.retry");
  expect(fixture.fallback).not.toHaveBeenCalled();
  expect(fixture.intlError).not.toHaveBeenCalled();
  expect(fixture.write).not.toHaveBeenCalled();
}

it.each(LOCALES)(
  "renders the mounted Website composer with exact shared form copy in %s",
  (locale) => {
    const view = render(editor(locale));
    expect(screen.getByText(catalogues[locale].saveBoundary.form)).toBeTruthy();
    expect(catalogues[locale].workflows).not.toHaveProperty("saveBoundary");
    expectResolvedCopy(view.container);
  },
);

// These are the two common.retry callers in main's actual parent editor.
// Strings and Languages use different recovery contracts in this revision.
it.each(
  LOCALES.flatMap((locale) =>
    [false, true].map((cached) => ({ locale, cached })),
  ),
)(
  "renders and invokes parent Retry in $locale (cached account: $cached)",
  async ({ locale, cached }) => {
    fixture.cachedAccount = cached;
    fixture.failed = !cached;
    const view = render(editor(locale));
    if (cached) {
      fireEvent.change(
        screen.getByLabelText(catalogues[locale].workflows.target),
        {
          target: { value: "tagline" },
        },
      );
      fireEvent.change(
        screen.getByLabelText(catalogues[locale].workflows.translation),
        { target: { value: "Synthetic unsaved translation" } },
      );
      fixture.failed = true;
      view.rerender(editor(locale));
      expect(
        screen
          .getByLabelText(catalogues[locale].workflows.translation)
          .matches(":disabled"),
      ).toBe(true);
    } else {
      expect(screen.queryByRole("tabpanel")).toBeNull();
    }
    const label = catalogues[locale].common.retry;
    const retry = screen.getByRole("button", { name: label });
    expect(retry.textContent).toBe(label);
    expectResolvedCopy(view.container);
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(fixture.retry).toHaveBeenCalledOnce();
    fixture.failed = false;
    view.rerender(editor(locale));
    expect(screen.getByText(catalogues[locale].saveBoundary.form)).toBeTruthy();
    if (cached) {
      const draft = screen.getByLabelText<HTMLTextAreaElement>(
        catalogues[locale].workflows.translation,
      );
      expect(draft.value).toBe("Synthetic unsaved translation");
      expect(draft.matches(":disabled")).toBe(false);
    }
    expectResolvedCopy(view.container);
  },
);
