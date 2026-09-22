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
  it("limits the viewer banner to permitted management summaries", () => {
    for (const locale of LOCALES) {
      expect(bundledMessages[locale].admin.readOnly.banner, locale).toMatch(/\S/);
    }
    // Viewer accounts can still edit their own profile and exchange permitted messages.
    // The banner must describe the management area, not promise every page or ban every write.
    expect(en.admin.readOnly.banner).toContain("management access");
    expect(en.admin.readOnly.banner).toContain("permitted summaries");
    expect(en.admin.readOnly.banner).not.toMatch(/everything|can't make changes/);
    expect(zh.admin.readOnly.banner).toContain("管理区域");
    expect(zh.admin.readOnly.banner).toContain("允许浏览");
    expect(zh.admin.readOnly.banner).not.toMatch(/全部内容|无法进行更改/);
  });

  it("keeps every configured locale aligned with the public mobile menu", () => {
    expect(Object.keys(bundledMessages).sort()).toEqual([...LOCALES].sort());

    for (const locale of LOCALES) {
      const messages = bundledMessages[locale];
      expect(messages.landing.nav.menu, `${locale} menu label`).toMatch(/\S/);
      expect(messages.common.language, `${locale} language label`).toMatch(
        /\S/,
      );
      expect(
        messages.workflow.policyScrollHint,
        `${locale} policy reading hint`,
      ).toMatch(/\S/);
    }
  });
});
