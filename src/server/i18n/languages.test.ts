import { describe, expect, it } from "vitest";

import { LOCALES } from "~/i18n/config";
import { mergeLanguages, type StoredLanguage } from "./languages";

function stored(
  code: string,
  enabled: boolean,
  sortOrder: number,
): StoredLanguage {
  return {
    code,
    label: code.toUpperCase(),
    builtIn: false,
    enabled,
    sortOrder,
  };
}

describe("language visibility", () => {
  it("publishes only the polished default catalogs when no settings are stored", () => {
    expect(mergeLanguages([]).map((language) => language.code)).toEqual([
      "en",
      "zh",
    ]);
  });

  it("keeps every bundled catalog available to translation managers", () => {
    expect(
      mergeLanguages([], { includeDisabled: true }).map(
        (language) => language.code,
      ),
    ).toEqual([...LOCALES]);
  });

  it("hides unfinished custom languages publicly without removing them from management", () => {
    const rows = [stored("pt-br", false, 0), stored("de", true, 1)];

    expect(mergeLanguages(rows).map((language) => language.code)).toEqual([
      "de",
      "en",
      "zh",
    ]);
    expect(
      mergeLanguages(rows, { includeDisabled: true }).find(
        (language) => language.code === "pt-br",
      ),
    ).toMatchObject({ enabled: false, builtIn: false });
  });

  it("always preserves English as the fallback even if stored data is stale", () => {
    expect(mergeLanguages([stored("en", false, 0)])[0]).toMatchObject({
      code: "en",
      enabled: true,
      builtIn: true,
    });
  });
});
