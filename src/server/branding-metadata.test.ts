import { describe, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { APP_TITLE } from "~/lib/branding";

const state = vi.hoisted((): { locale: "en" | "zh" } => ({ locale: "en" }));

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => {
    let value: unknown = state.locale === "zh" ? zh : en;
    for (const part of key.split(".")) {
      value = (value as Record<string, unknown>)[part];
    }
    return String(value);
  }),
}));

import { brandingMetadata, pageMetadata } from "./branding-metadata";

describe("brandingMetadata and pageMetadata", () => {
  it("returns the base app title and description when no page title is supplied", async () => {
    const meta = await brandingMetadata();
    expect(meta.title).toBe(APP_TITLE);
    expect(meta.description).toContain(APP_TITLE);
  });

  it.each(["en", "zh"] as const)(
    "resolves localized route titles in %s",
    async (locale) => {
      state.locale = locale;
      const messages = locale === "zh" ? zh : en;
      const meta = await pageMetadata("admin.nav.links.usersRoles");
      expect(meta.title).toBe(
        `${messages.admin.nav.links.usersRoles} · ${APP_TITLE}`,
      );
      expect(meta.description).toBeUndefined();
    },
  );
});
