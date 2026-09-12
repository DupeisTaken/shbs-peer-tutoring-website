/**
 * Locale-sync guard: every bundled locale must have exactly the same key set as the English
 * source (the canonical `LOCALES` list drives which files are checked). This fails the suite on
 * any drift — a missing key (which would otherwise render as a `⟦key⟧` placeholder at runtime, see
 * ./fallback) or an extra/stale key — so translations stay in sync.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  parse,
  TYPE,
  type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser";

import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES } from "./config";

const messagesDir = fileURLToPath(new URL("../../messages/", import.meta.url));

function flatten(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {},
) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v as Record<string, unknown>, key, out);
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

function load(locale: string): Record<string, string> {
  return flatten(
    JSON.parse(readFileSync(`${messagesDir}${locale}.json`, "utf8")) as Record<
      string,
      unknown
    >,
  );
}

const en = load(DEFAULT_LOCALE);
const enKeys = Object.keys(en);
/** Parse nested plurals and rich-text tags: regexes confuse translated branch text with arguments. */
function argumentsOf(
  nodes: MessageFormatElement[],
  found = new Set<string>(),
): string[] {
  for (const node of nodes) {
    if (node.type !== TYPE.literal && node.type !== TYPE.pound) {
      found.add(`${node.type === TYPE.tag ? "tag" : "argument"}:${node.value}`);
    }
    if (node.type === TYPE.tag) argumentsOf(node.children, found);
    if (node.type === TYPE.select || node.type === TYPE.plural) {
      for (const option of Object.values(node.options))
        argumentsOf(option.value, found);
    }
  }
  return [...found].sort();
}

describe("locale parity", () => {
  it("every LOCALES entry has a label and a loader-able file", () => {
    for (const loc of LOCALES) {
      expect(LOCALE_LABELS[loc], `missing label for ${loc}`).toBeTruthy();
      expect(
        () => load(loc),
        `missing/invalid messages/${loc}.json`,
      ).not.toThrow();
    }
  });

  for (const loc of LOCALES) {
    it(`${loc} contains valid ICU messages`, () => {
      for (const [key, value] of Object.entries(load(loc))) {
        expect(() => parse(value), `${loc}:${key}`).not.toThrow();
      }
    });
    it(`${loc} has no blank translation values`, () => {
      const blank = Object.entries(load(loc))
        .filter(([, value]) => value.trim().length === 0)
        .map(([key]) => key);
      expect(blank).toEqual([]);
    });
  }

  for (const loc of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
    describe(loc, () => {
      const m = load(loc);
      const keys = new Set(Object.keys(m));

      it("has no missing or extra keys vs. en", () => {
        const missing = enKeys.filter((k) => !keys.has(k));
        const extra = [...keys].filter((k) => !(k in en));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      });

      it("preserves ICU placeholders", () => {
        for (const k of enKeys) {
          expect(argumentsOf(parse(m[k]!)), `${loc}:${k}`).toEqual(
            argumentsOf(parse(en[k]!)),
          );
        }
      });
    });
  }
});
