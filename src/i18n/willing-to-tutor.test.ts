import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { LOCALES } from "./config";
import type en from "../../messages/en.json";

// English defaults also appear in unfinished locale catalogs; keep them consistent.
it.each(LOCALES)(
  "uses tutor terminology in the %s catalog without changing message keys",
  (locale) => {
    const messages = JSON.parse(
      readFileSync(
        new URL(`../../messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ) as typeof en;
    const t = createTranslator({ locale, messages });
    expect(JSON.stringify(messages)).not.toMatch(
      /willing(?:ness)? to teach|teaching willingness/i,
    );
    if (locale !== "zh") {
      expect(t("subjectAvailability.willing")).toBe("Willing to tutor");
      expect(t("subjectAvailability.willingness")).toBe("Willing to tutor");
      expect(t("subjectAvailability.notWilling")).toBe("Not willing to tutor");
      expect(t("tutorDetails.willingness")).toBe("Willing to tutor");
      expect(
        t("subjectAvailability.willingnessFor", { subject: "Biology" }),
      ).toBe("Willingness: Biology");
    } else {
      expect(t("subjectAvailability.willingness")).toBe("辅导意愿");
    }
  },
);
