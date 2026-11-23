import { expect, it } from "vitest";
import { pageTitleReference } from "./page-title-reference";

it("identifies the exact title language and retains its saved text", () => {
  expect(
    pageTitleReference({ en: "English title", zh: "  保存的标题\n" }, "zh"),
  ).toEqual({ value: "  保存的标题\n", locale: "zh" });
});

it.each([undefined, null, "", " \n", 42])(
  "identifies an English fallback without inventing a target-locale title (%s)",
  (zh) => {
    expect(pageTitleReference({ zh, en: "English title" }, "zh")).toEqual({
      value: "English title",
      locale: "en",
    });
  },
);

it.each([
  undefined,
  null,
  [],
  "Not a title map",
  {},
  { fr: "Unrelated language" },
  { en: " " },
])(
  "does not substitute another language or malformed title map (%j)",
  (title) => {
    expect(pageTitleReference(title, "zh")).toBeNull();
  },
);
