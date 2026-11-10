/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { StaticTranslationQueryFixture } from "~/test/translation-query-bindings";
import type * as IntentClientModule from "~/lib/translation-intent-client";
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

const fixture = vi.hoisted(() => ({
  queries: undefined as StaticTranslationQueryFixture | undefined,
  failed: ((): "" | "account" | "languages" | "strings" => "")(),
  cachedAccount: false,
  denied: false,
  retry: vi.fn(),
  write: vi.fn(),
  fallback: vi.fn(),
  intlError: vi.fn(),
  intentClient: undefined as
    IntentClientModule.TranslationIntentClient | undefined,
}));
// Each test models a new page with a fresh REAL registry. No intent controller
// transition or translation hook is replaced by a copy-test shortcut.
vi.mock("~/lib/translation-intent-client", async (importOriginal) => {
  const actual = await importOriginal<typeof IntentClientModule>();
  return {
    ...actual,
    get translationIntentClient() {
      return fixture.intentClient!;
    },
  };
});
vi.mock("./student-portal", () => ({ Pager: () => null }));
vi.mock("~/trpc/react", async () => {
  const { createStaticTranslationQueryFixture } =
    await import("~/test/translation-query-bindings");
  const queries = createStaticTranslationQueryFixture();
  fixture.queries = queries;
  const paths: Record<string, string> = {
    account: "account.me",
    languages: "i18n.managedLanguages",
    capability: "i18n.canManageLanguages",
    strings: "localization.strings",
    content: "home.content",
    news: "home.news",
    sections: "home.sections",
    pages: "home.pages",
    review: "translationReview.list",
  };
  const data = (name: string) => {
    if (name === "account")
      return {
        id: "translation-copy-actor",
        role: "ADMIN",
        canTranslate: true,
      };
    if (name === "languages")
      return [
        { code: "en", label: "English", enabled: true, builtIn: true },
        { code: "zh", label: "中文", enabled: true, builtIn: true },
      ];
    if (name === "capability") return true;
    if (name === "content")
      return [
        {
          key: "tagline",
          kind: "text",
          default: "Synthetic destination",
          override: null,
        },
      ];
    return [];
  };
  const read = (name: string) =>
    queries.read(
      paths[name]!,
      () => {
        const failed = fixture.failed === name;
        const error = failed
          ? Object.assign(
              new Error("Synthetic read unavailable"),
              fixture.denied ? { data: { code: "FORBIDDEN" } } : {},
            )
          : null;
        return {
          data:
            failed && !(name === "account" && fixture.cachedAccount)
              ? undefined
              : data(name),
          error,
          isSuccess: !failed,
        };
      },
      name === "strings"
        ? [
            { locale: "en", refLocales: [] },
            { locale: "zh", refLocales: [] },
          ]
        : name === "content"
          ? [{ locale: "en" }, { locale: "zh" }]
          : name === "review"
            ? [{ page: 0, state: "PENDING" }]
            : [undefined],
      fixture.retry,
    );
  const mutation = {
    useMutation: () => ({
      mutate: fixture.write,
      mutateAsync: fixture.write,
      reset: vi.fn(),
      isPending: false,
      error: null,
    }),
  };
  const target = { invalidate: async () => undefined, fetch: async () => [] };
  return {
    api: {
      account: { me: read("account") },
      i18n: {
        managedLanguages: read("languages"),
        canManageLanguages: read("capability"),
        addLanguage: mutation,
        reorderLanguages: mutation,
        deleteLanguage: mutation,
        setLanguageEnabled: mutation,
      },
      localization: { strings: read("strings"), setString: mutation },
      home: {
        content: read("content"),
        news: read("news"),
        sections: read("sections"),
        pages: read("pages"),
        setContent: mutation,
        setNewsTranslation: mutation,
        setSectionTranslation: mutation,
        setPageTitle: mutation,
      },
      translationReview: { list: read("review"), decide: mutation },
      translationIntent: { stop: mutation },
      useUtils: () => ({
        client: { translationIntent: { get: { query: fixture.write } } },
        translationIntent: { get: { fetch: fixture.write } },
        translationReview: { list: target },
        localization: { strings: target },
        i18n: { managedLanguages: target, languages: target },
        home: {
          ...target,
          content: target,
          news: target,
          sections: target,
          pages: target,
        },
      }),
    },
  };
});

import { createTranslationIntentClient } from "~/lib/translation-intent-client";
import { TranslationComposer } from "./translation-composer";
import { TranslationEditor } from "./translation-editor";
import { TranslationStrings } from "./translation-strings";
import { LanguagesPanel } from "./languages-panel";

const catalogues = { en, zh, es, ja, ko, el, de, fr };
beforeEach(() => {
  fixture.queries!.reset();
  vi.clearAllMocks();
  fixture.failed = "";
  fixture.cachedAccount = false;
  fixture.denied = false;
  fixture.retry.mockResolvedValue({ data: {} });
  window.sessionStorage.clear();
  fixture.intentClient = createTranslationIntentClient(
    () => window.sessionStorage,
  );
});
afterEach(() => {
  cleanup();
  fixture.queries!.client.clear();
});

function show(locale: "en" | "zh", content: ReactNode) {
  fixture.queries!.prepare();
  return rtlRender(
    <QueryClientProvider client={fixture.queries!.client}>
      <NextIntlClientProvider
        locale={locale}
        messages={catalogues[locale]}
        timeZone="Asia/Shanghai"
        onError={fixture.intlError}
        getMessageFallback={({ namespace, key }) => {
          const missing = [namespace, key].filter(Boolean).join(".");
          fixture.fallback(missing);
          return `[missing:${missing}]`;
        }}
      >
        {content}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

it.each(["en", "zh"] as const)(
  "renders the actual Composer form boundary from the top-level %s catalogue",
  (locale) => {
    show(locale, <TranslationComposer />);
    expect(screen.getByText(catalogues[locale].saveBoundary.form)).toBeTruthy();
    expect(fixture.fallback).not.toHaveBeenCalled();
    expect(fixture.intlError).not.toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
  },
);

const retryCases = [
  {
    surface: "Editor initial account error",
    component: "editor",
    resource: "account",
    cached: false,
    denied: false,
  },
  {
    surface: "Editor cached account error",
    component: "editor",
    resource: "account",
    cached: true,
    denied: false,
  },
  {
    surface: "Strings ordinary read error",
    component: "strings",
    resource: "strings",
    cached: false,
    denied: false,
  },
  {
    surface: "Strings denied read",
    component: "strings",
    resource: "strings",
    cached: false,
    denied: true,
  },
  {
    surface: "Languages ordinary read error",
    component: "languages",
    resource: "languages",
    cached: false,
    denied: false,
  },
  {
    surface: "Languages denied read",
    component: "languages",
    resource: "languages",
    cached: false,
    denied: true,
  },
] as const;
it.each(
  retryCases.flatMap((test) =>
    (["en", "zh"] as const).map((locale) => ({ ...test, locale })),
  ),
)(
  "renders and invokes localized common.retry for $surface ($locale)",
  async ({ component, resource, cached, denied, locale }) => {
    fixture.failed = resource;
    fixture.cachedAccount = cached;
    fixture.denied = denied;
    show(
      locale,
      component === "editor" ? (
        <TranslationEditor initialView="review" />
      ) : component === "strings" ? (
        <TranslationStrings />
      ) : (
        <LanguagesPanel canAdd={false} />
      ),
    );
    const label = catalogues[locale].common.retry;
    const retry = screen.getByRole("button", { name: label });
    expect(retry.textContent).toBe(label);
    expect(fixture.fallback).not.toHaveBeenCalled();
    expect(fixture.intlError).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(fixture.retry).toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
  },
);

it.each(LOCALES)(
  "keeps saveBoundary.form and common.retry at their exact shared paths in %s",
  (locale: Locale) => {
    const catalogue = catalogues[locale];
    const common: Record<string, unknown> = catalogue.common;
    const workflows: Record<string, unknown> = catalogue.workflows;
    expect(typeof common.retry).toBe("string");
    expect(String(common.retry).trim().length).toBeGreaterThan(0);
    expect(typeof catalogue.saveBoundary.form).toBe("string");
    expect(catalogue.saveBoundary.form.trim().length).toBeGreaterThan(0);
    expect(workflows).not.toHaveProperty("saveBoundary");
  },
);
