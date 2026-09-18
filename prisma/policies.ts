import { readFileSync } from "node:fs";

/** Sample development policies; staff adapt, review and publish them for a school. */
export const POLICY_VERSION = "2026.09.18";

// Only include reviewed sample translations in development seeds.
// Missing policy locales already fall back to English in the runtime policy loader.
export const BUNDLED_POLICIES = ["tutor-policy", "tutee-policy"].flatMap(
  (slug) =>
    ["en", "zh"].map((locale) => {
      const body = readFileSync(
        new URL(`./policies/${slug}.${locale}.md`, import.meta.url),
        "utf8",
      )
        .replace(/\r\n/g, "\n")
        .trim();
      const title = body.split("\n")[0]?.replace(/^# /, "").trim();
      if (!title || !body.startsWith("# "))
        throw new Error(`Missing policy title: ${slug}.${locale}`);
      return { slug, locale, title, version: POLICY_VERSION, body };
    }),
);
