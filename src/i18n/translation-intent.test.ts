import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { expect, it } from "vitest";
import { TRANSLATION_OPERATIONS } from "~/lib/translation-intent";
import { getMessageFallback } from "./fallback";
import type en from "../../messages/en.json";

type Catalog = Pick<typeof en, "translationIntent">;
const labels = [
  "title",
  "help",
  "pending",
  "unknown",
  "notRecorded",
  "acceptedDraft",
  "acceptedPublished",
  "stopped",
  "restoreOnly",
  "lookup",
  "stop",
  "retryExact",
  "refreshAccepted",
  "dismiss",
  "storageFailed",
  "retryStorage",
  "signIn",
  "reference",
  "submitFailed",
  "refreshFailed",
  "readFailed",
  "refreshAuthority",
  "authorityRequired",
  "noRequests",
  "modes.DRAFT",
  "modes.PUBLISH",
  ...TRANSLATION_OPERATIONS.map(
    (operation) => `operations.${operation}` as const,
  ),
] as const;

it.each(["en", "zh", "de", "el", "es", "fr", "ja", "ko"])(
  "renders every actual receipt recovery path, including nested operation labels, in %s",
  (locale) => {
    const messages = JSON.parse(
      readFileSync(
        new URL(`../../messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ) as Catalog;
    const errors: unknown[] = [];
    const translate = createTranslator({
      locale,
      messages,
      namespace: "translationIntent",
      onError: (error) => errors.push(error),
      getMessageFallback,
    });
    expect(labels).toHaveLength(31);
    for (const label of labels) {
      const text = translate(label, { id: "synthetic-request" });
      expect(text.trim(), label).not.toBe("");
      expect(text, label).not.toContain("⟦");
      if (label === "reference") expect(text).toContain("synthetic-request");
    }
    expect(errors).toEqual([]);
  },
);
