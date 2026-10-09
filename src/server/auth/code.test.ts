import { afterEach, expect, it, vi } from "vitest";
import { randomInt } from "crypto";
import type * as Crypto from "crypto";
import {
  generateRegistrationCode,
  normalizeRegCode,
  REG_CODE_ALPHABET,
} from "./code";

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});
afterEach(() => vi.mocked(randomInt).mockReset());

it("issues five unambiguous uppercase characters containing both letters and digits", () => {
  for (let i = 0; i < 250; i++) {
    const code = generateRegistrationCode();
    expect(code).toMatch(/^[023456789ABCDEFGHIJKMNPQRSTUVWXYZ]{5}$/);
    expect(code).toMatch(/[A-Z]/);
    expect(code).toMatch(/[02-9]/);
  }
});

it("accepts copied separators and lowercase without changing code identity", () => {
  expect(normalizeRegCode(" ab-3d 7 ")).toBe("AB3D7");
});

it.each(["AB0CD", "abocd", "ABOCD", " aB-o cD "])(
  "normalizes %s to the same zero code",
  (input) => expect(normalizeRegCode(input)).toBe("AB0CD"),
);

it("generates zero as the only digit and never generates its O alias", () => {
  expect(REG_CODE_ALPHABET).not.toContain("O");
  const draws = Array.from("AB0CD", (character) =>
    REG_CODE_ALPHABET.indexOf(character),
  );
  // Bounded deterministic draws fail promptly if zero is wrongly rejected as a digit.
  vi.mocked(randomInt).mockImplementation(() => {
    const draw = draws.shift();
    if (draw === undefined) throw new Error("Unexpected extra random draw");
    return draw;
  });
  expect(generateRegistrationCode()).toBe("AB0CD");
});

it("generates I while excluding its digit 1 alias", () => {
  expect(REG_CODE_ALPHABET).not.toContain("1");
  const draws = Array.from("ABI0D", (character) =>
    REG_CODE_ALPHABET.indexOf(character),
  );
  vi.mocked(randomInt).mockImplementation(() => {
    const draw = draws.shift();
    if (draw === undefined) throw new Error("Unexpected extra random draw");
    return draw;
  });
  expect(generateRegistrationCode()).toBe("ABI0D");
});

it.each(["ABI0D", "abiOd", "ab10d", " aB-1 oD "])(
  "normalizes %s to the canonical I and zero code",
  (input) => expect(normalizeRegCode(input)).toBe("ABI0D"),
);

it("preserves digit 1 in legacy hexadecimal receipts and six-character OTPs", () => {
  expect(normalizeRegCode(" a1b2-cod4-e5f6 ")).toBe("A1B2C0D4E5F6");
  expect(normalizeRegCode(" a1b2co ")).toBe("A1B2C0");
  expect(normalizeRegCode("123456")).toBe("123456");
});
