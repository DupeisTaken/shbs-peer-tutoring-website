import { describe, expect, it } from "vitest";

import de from "../../messages/de.json";
import el from "../../messages/el.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ja from "../../messages/ja.json";
import ko from "../../messages/ko.json";
import zh from "../../messages/zh.json";
import { LOCALES, type Locale } from "./config";

const bundledMessages = {
  en,
  zh,
  es,
  ja,
  ko,
  el,
  de,
  fr,
} satisfies Record<
  Locale,
  { common: { language: string }; landing: { nav: { menu: string } } }
>;

describe("bundled header translations", () => {
  it("keeps every configured locale aligned with the public mobile menu", () => {
    expect(Object.keys(bundledMessages).sort()).toEqual([...LOCALES].sort());

    for (const locale of LOCALES) {
      const messages = bundledMessages[locale];
      expect(messages.landing.nav.menu, `${locale} menu label`).toMatch(/\S/);
      expect(messages.common.language, `${locale} language label`).toMatch(
        /\S/,
      );
    }
  });
});
