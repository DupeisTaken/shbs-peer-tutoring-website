import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { LOCALES } from "~/i18n/config";
import { translationMessageCompatibility } from "./translation-message-contract";

describe("live translation message contract", () => {
  it.each(LOCALES)(
    "preserves representative literal, argument, rich and numeric source contracts in %s",
    (locale) => {
      const load = (code: string) =>
        JSON.parse(
          readFileSync(
            new URL(`../../messages/${code}.json`, import.meta.url),
            "utf8",
          ),
        ) as Record<string, unknown>;
      const get = (messages: Record<string, unknown>, key: string) =>
        key
          .split(".")
          .reduce<unknown>(
            (current, part) => (current as Record<string, unknown>)[part],
            messages,
          ) as string;
      const english = load("en");
      const translated = load(locale);
      for (const key of [
        "common.save",
        "sessionPlanning.respondBy",
        "public.signup.agree",
        "workflows.qualificationCount",
      ]) {
        expect(
          translationMessageCompatibility(
            get(english, key),
            get(translated, key),
          ),
          `${locale}:${key}`,
        ).toEqual({ compatible: true });
      }
    },
  );
  it.each([
    ["Save", "Save reviewed changes"],
    ["Respond by {deadline}", "请在 {deadline} 前回复"],
    ["{first} and {last}", "{last}、{first}（{first}）"],
    [
      "{count} {count, plural, one {record} other {records}}",
      "{count, plural, other {# 条记录}}",
    ],
    ["{count, plural, one {# record} other {# records}}", "{count} 条记录"],
    [
      "{count, plural, one {# item} other {# items}}",
      "{count, plural, zero {aucun} one {un} two {deux} few {quelques} many {beaucoup} other {#}}",
    ],
    [
      "{count, number}",
      "{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
    ],
    ["{amount, number, ::currency/USD}", "{amount, number, ::currency/EUR}"],
    ["{at, date, short}", "{at, time, short}"],
    ["{state, select, active {Active} other {Other}}", "Status: {state}"],
    [
      "Accept <policy>{appTitle}</policy>",
      "<policy>{appTitle} 政策</policy>已接受",
    ],
    [
      "{count, plural, one {<link>{name}</link>} other {<link>{name}</link>}}",
      "<link>{name}</link> · {count, plural, other {#}}",
    ],
    ["Use '{literal}' with {name}", "{name} uses '{different literal}'"],
  ])(
    "allows compatible translated wording and locale formats: %s",
    (source, translated) => {
      expect(translationMessageCompatibility(source, translated)).toEqual({
        compatible: true,
      });
    },
  );

  it.each([
    ["Save", "Save {unknown}"],
    ["Respond by {deadline}", "Respond promptly"],
    ["Respond by {deadline}", "Respond by {when}"],
    ["Save", "<link>Save</link>"],
    ["<policy>Read</policy>", "Read"],
    ["<policy>Read</policy>", "{policy}"],
    ["<policy>Read</policy>", "<policy>Read</policy> {policy}"],
    ["{policy}", "<policy>Read</policy>"],
    ["{deadline}", "{deadline, number}"],
    ["{deadline}", "{deadline, plural, one {Soon} other {Later}}"],
    ["{count, number}", "{count, date}"],
    ["{at, date}", "{at, number}"],
    ["{at, date}", "{at, date} {at}"],
    [
      "{count, plural, one {<policy>One</policy>} other {Many}}",
      "{count, plural, one {<unexpected>One</unexpected>} other {Many}}",
    ],
    [
      "{state, select, ready {{name}} other {{name}}}",
      "{state, select, ready {{name}} other {{missing}}}",
    ],
  ])(
    "refuses unsupported argument/callback contracts: %s -> %s",
    (source, translated) => {
      expect(translationMessageCompatibility(source, translated)).toMatchObject(
        { compatible: false, reason: "arguments" },
      );
    },
  );

  it("reports correction details without confusing branch words or plural # with argument names", () => {
    expect(
      translationMessageCompatibility(
        "{count, plural, other {{name}}}",
        "{count, date} {newName}",
      ),
    ).toEqual({
      compatible: false,
      reason: "arguments",
      missing: ["name"],
      unexpected: ["newName"],
      changed: ["count"],
    });
  });

  it("distinguishes invalid source and submitted ICU syntax", () => {
    expect(translationMessageCompatibility("{broken", "Valid")).toEqual({
      compatible: false,
      reason: "source-syntax",
    });
    expect(translationMessageCompatibility("Valid", "{broken")).toEqual({
      compatible: false,
      reason: "syntax",
    });
  });

  it("retains valid locale plural behavior with the installed formatter", () => {
    const source = "{count} {count, plural, one {record} other {records}}";
    const value = "{count, plural, other {# 条记录}}";
    expect(translationMessageCompatibility(source, value)).toEqual({
      compatible: true,
    });
    const errors: unknown[] = [];
    const translate = createTranslator({
      locale: "zh",
      messages: { count: value },
      onError: (error) => errors.push(error),
    });
    expect(translate("count", { count: 1 })).toBe("1 条记录");
    expect(translate("count", { count: 4 })).toBe("4 条记录");
    expect(errors).toEqual([]);
  });

  it("uses only callbacks present in the source and preserves their rendering", () => {
    const source = "Read <policy>{appTitle}</policy>";
    const value = "<policy>{appTitle} policy</policy> accepted";
    expect(translationMessageCompatibility(source, value)).toEqual({
      compatible: true,
    });
    const errors: unknown[] = [];
    const translate = createTranslator({
      locale: "en",
      messages: { policy: value },
      onError: (error) => errors.push(error),
    });
    const rendered = translate.rich("policy", {
      appTitle: "Synthetic",
      policy: (chunks) =>
        createElement("a", { href: "/synthetic-policy" }, chunks),
    });
    expect(renderToStaticMarkup(createElement("div", null, rendered))).toBe(
      '<div><a href="/synthetic-policy">Synthetic policy</a> accepted</div>',
    );
    expect(errors).toEqual([]);
  });
});
