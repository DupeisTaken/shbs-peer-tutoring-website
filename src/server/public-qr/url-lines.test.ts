import { expect, it } from "vitest";
import { publicQrUrlLines } from "./url-lines";

it("keeps a normal signup path together while retaining the complete URL", () => {
  expect(publicQrUrlLines("https://tutoring.example.edu/tutor")).toEqual([
    "https://tutoring.example.edu/",
    "tutor",
  ]);
});

it.each([
  "https://example.edu/",
  `https://${"w".repeat(63)}.${"m".repeat(63)}.example.edu/tutee`,
  "https://xn--fiqs8s.example.edu:8443/crew",
])("bounds readable lines without losing URL characters: %s", (url) => {
  const lines = publicQrUrlLines(url);
  expect(lines.join("")).toBe(url);
  expect(lines.every((line) => line.length > 0 && line.length <= 32)).toBe(
    true,
  );
});
