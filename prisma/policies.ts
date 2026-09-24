import { readFileSync } from "node:fs";

/** Review drafts for development; school approval and runtime publication remain separate. */
export const POLICY_VERSION = "2026.09.24";

// Include only the maintained English/Chinese drafts in development seeds.
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
