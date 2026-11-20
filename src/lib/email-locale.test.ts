import { expect, it } from "vitest";
import {
  emailLocaleFromHeaders,
  emailText,
  normalizeEmailLocale,
} from "./email-locale";

it.each([undefined, null, "", "fr", "zh-CN", "ZH", {}, 1])(
  "defaults unsupported email locale %s to English",
  (value) => expect(normalizeEmailLocale(value)).toBe("en"),
);

it("selects maintained copy without parsing or altering its contents", () => {
  const copy = {
    en: "Example / 例子 remains literal data",
    zh: "保留 Example / 例子 原始内容",
  };
  expect(emailText("en", copy)).toBe(copy.en);
  expect(emailText("zh", copy)).toBe(copy.zh);
});

it.each([
  ["NEXT_LOCALE=zh", "zh"],
  ["session=synthetic; NEXT_LOCALE=en; other=x", "en"],
  ["session=x; NEXT_LOCALE=zh", "zh"],
  ["NEXT_LOCALE=zh-CN", "en"],
  ["NEXT_LOCALE=%7A%68", "en"],
  ["next_locale=zh", "en"],
  ["NEXT_LOCALE=zh=ignored", "en"],
  ["OTHER=zh", "en"],
] as const)(
  "uses only the exact supported signup cookie %s",
  (cookie, expected) => {
    expect(
      emailLocaleFromHeaders(new Headers({ cookie, "accept-language": "zh" })),
    ).toBe(expected);
  },
);

it("uses English when there is no selected cookie", () => {
  expect(emailLocaleFromHeaders()).toBe("en");
  expect(emailLocaleFromHeaders(new Headers({ "accept-language": "zh" }))).toBe(
    "en",
  );
});
