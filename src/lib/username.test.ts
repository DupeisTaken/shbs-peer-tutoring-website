import { expect, it } from "vitest";
import {
  accountUsernameSchema,
  defaultUsername,
  usernameCandidates,
  hasLatinName,
} from "./username";

it.each([
  ["José", "García", "jgarcia28"],
  ["Jose", "Garcia", "jgarcia28"],
  ["王", "小明", "member28"],
  ["Madonna", "", "madonna28"],
  ["李", "Chen", "chen28"],
  ["Jean-Luc", "O’Neill", "joneill28"],
  ["", "", "member28"],
  ["!!!", "---", "member28"],
])(
  "normalizes %s %s without guessing transliteration",
  (first, last, expected) => {
    expect(defaultUsername(first, last, 2028)).toBe(expected);
  },
);
it("uses an optional Latin spelling only for a name without Latin letters", () => {
  expect(defaultUsername("王", "小明", 2028, "Xiaoming Wang")).toBe("xwang28");
  expect(defaultUsername("Alice", "Chen", 2028, "Unrelated Name")).toBe(
    "achen28",
  );
  expect(defaultUsername("王", "小明", null, "王小明")).toBe("member");
  expect(hasLatinName("Élodie")).toBe(true);
  expect(hasLatinName("王小明123")).toBe(false);
});
it("keeps all dense collision candidates within the editor contract", () => {
  const base = defaultUsername("Alexander", "S".repeat(80), 2028);
  expect(base).toHaveLength(56);
  const generator = usernameCandidates(base);
  const candidates = Array.from(
    { length: 1030 },
    () => generator.next().value as string,
  );
  expect(new Set(candidates).size).toBe(candidates.length);
  for (const handle of candidates)
    expect(accountUsernameSchema.safeParse(handle).success).toBe(true);
});
