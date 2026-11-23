import { describe, expect, it } from "vitest";
import { pickLocalized, resolveLocalized } from "./page-blocks";

describe("localized block text", () => {
  it.each<{
    map: Record<string, string> | undefined;
    locale: string;
    value: string;
    chosen: string | undefined;
  }>([
    {
      map: { en: "English", zh: "中文" },
      locale: "zh",
      value: "中文",
      chosen: "zh",
    },
    {
      map: { fr: "Français", en: "English" },
      locale: "zh",
      value: "English",
      chosen: "en",
    },
    {
      map: { fr: "Français", de: "Deutsch" },
      locale: "zh",
      value: "Français",
      chosen: "fr",
    },
    { map: { en: "English", zh: "" }, locale: "zh", value: "", chosen: "zh" },
    { map: { fr: "Français", en: "" }, locale: "zh", value: "", chosen: "en" },
    { map: { fr: "", de: "Deutsch" }, locale: "zh", value: "", chosen: "fr" },
    { map: {}, locale: "zh", value: "", chosen: undefined },
    { map: undefined, locale: "zh", value: "", chosen: undefined },
    {
      map: { "zh-Hant": "繁體中文", en: "English" },
      locale: "zh-Hant",
      value: "繁體中文",
      chosen: "zh-Hant",
    },
  ])(
    "retains the selected key for $locale/$chosen without changing text fallback",
    ({ map, locale, value, chosen }) => {
      expect(resolveLocalized(map, locale)).toEqual({ value, locale: chosen });
      expect(pickLocalized(map, locale)).toBe(value);
    },
  );
});
