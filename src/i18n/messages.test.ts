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
      expect(bundledMessages[locale].admin.readOnly.banner, locale).toMatch(
        /\S/,
      );
    }
    // Viewer accounts can still edit their own profile and exchange permitted messages.
    // The banner must describe the management area, not promise every page or ban every write.
    expect(en.admin.readOnly.banner).toContain("management access");
    expect(en.admin.readOnly.banner).toContain("permitted summaries");
    expect(en.admin.readOnly.banner).not.toMatch(
      /everything|can't make changes/,
    );
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

describe("English heading and navigation capitalization", () => {
  it("capitalizes content words in title-style labels", () => {
    const minorWords = new Set([
      "a",
      "an",
      "and",
      "as",
      "at",
      "but",
      "by",
      "for",
      "from",
      "in",
      "into",
      "nor",
      "of",
      "on",
      "or",
      "over",
      "the",
      "to",
      "via",
      "with",
    ]);
    const errors: string[] = [];
    // These keys contain full sentences even though their names end in Title.
    const proseTitles = new Set([
      "landing.heroTitle",
      "admin.requests.banFlagTitle",
    ]);
    // Some rendered h1–h3 labels use action or section keys instead of Title/Heading.
    const sectionHeadings = new Set([
      "admin.tutees.addTutee",
      "courseGroups.import",
      "qualificationRequests.approved",
      "qualificationRequests.history",
      "workflow.current",
      "workflow.assignments",
      "workflow.participation",
      "tuteePortal.needHelp",
      "messaging.rolePermissions",
      "messaging.userOverrides",
      "messaging.inbox",
      "messaging.supervision",
      "workflows.send",
      "workflows.policy",
      "workflows.calendar",
      "workflows.support",
      "workflows.schedule",
      "corrections.patrolHistory",
    ]);

    // Audit all heading/title keys and navigation groups; prose and locale-specific
    // casing follow their own conventions. The supervision key is also an h1.
    function visit(messages: Record<string, unknown>, prefix = "") {
      for (const [key, value] of Object.entries(messages)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          visit(value as Record<string, unknown>, path);
          continue;
        }
        if (
          typeof value !== "string" ||
          proseTitles.has(path) ||
          !(
            /(^|\.)(?:title|heading|[^.]+(?:Title|Heading))$/.test(path) ||
            path.includes(".nav.") ||
            sectionHeadings.has(path)
          )
        )
          continue;

        // ICU arguments are data, not words to capitalize in the message text.
        const words = [
          ...value
            .replace(/\{[^}]*\}/g, "")
            .matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g),
        ].map(([word]) => word);
        if (
          words.some(
            (word, index) =>
              index > 0 &&
              !minorWords.has(word.toLowerCase()) &&
              /^[a-z]/.test(word),
          )
        )
          errors.push(`${path}: ${value}`);
      }
    }

    visit(en);
    expect(errors).toEqual([]);
    expect(en.messaging.supervision).toBe("Message Supervision");
    expect(en.signupFields.title).toBe("Signup Forms");
  });
});
