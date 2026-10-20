import { afterEach, expect, it, vi } from "vitest";
import { randomInt } from "crypto";
import type * as Crypto from "crypto";
import {
  generateRegistrationCode,
  generateEmailVerificationCode,
  normalizeRegCode,
  normalizeEmailCode,
} from "./code";
import {
  isEmailCodeFormat,
  normalizeRegCodeDraft,
} from "~/lib/registration-code";

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});
afterEach(() => vi.mocked(randomInt).mockReset());

it("issues independent five-digit invitations and four-digit mailbox codes", () => {
  for (let i = 0; i < 250; i++) {
    expect(generateRegistrationCode()).toMatch(/^[0-9]{5}$/);
    expect(generateEmailVerificationCode()).toMatch(/^[0-9]{4}$/);
  }
});

it("keeps leading zeros and digit one at both cryptographic bounds", () => {
  vi.mocked(randomInt)
    // crypto also exposes a callback overload returning void; implementations
    // retain the synchronous numeric draws without narrowing that public API.
    .mockImplementationOnce(() => 11)
    .mockImplementationOnce(() => 1)
    .mockImplementationOnce(() => 99999)
    .mockImplementationOnce(() => 9999);
  expect(generateRegistrationCode()).toBe("00011");
  expect(generateEmailVerificationCode()).toBe("0001");
  expect(generateRegistrationCode()).toBe("99999");
  expect(generateEmailVerificationCode()).toBe("9999");
  expect(randomInt).toHaveBeenNthCalledWith(1, 0, 100000);
  expect(randomInt).toHaveBeenNthCalledWith(2, 0, 10000);
});

it.each([" 00-1 11 ", "00111"])("preserves numeric invitation %s", (input) => {
  expect(normalizeRegCode(input)).toBe("00111");
});
it("preserves four-digit mailbox values during typing and paste", () => {
  expect(normalizeEmailCode(" 0-1 01 ")).toBe("0101");
  expect(normalizeRegCodeDraft("a1b2c", true)).toBe("A1B2C");
  expect(normalizeRegCodeDraft("00111", false)).toBe("00111");
});
it.each(["ABI0D", "abiOd", "ab10d", " aB-1 oD "])(
  "retains legacy mixed-character aliases %s",
  (input) => {
    expect(normalizeRegCode(input)).toBe("ABI0D");
    expect(normalizeEmailCode(input)).toBe("ABI0D");
  },
);
it("preserves longer legacy hexadecimal receipts and six-character OTPs", () => {
  expect(normalizeRegCode(" a1b2-cod4-e5f6 ")).toBe("A1B2C0D4E5F6");
  expect(normalizeEmailCode(" a1b2co ")).toBe("A1B2C0");
});
it.each(["0001", "AB10D", "A1B2C0", "A1B2C0D4E5F6"])(
  "accepts current and outstanding mailbox shapes %s",
  (input) => expect(isEmailCodeFormat(input)).toBe(true),
);
it.each(["", "123", "ABCD", "ABCDEFZ", "1234567"])(
  "rejects unsupported mailbox shape %s",
  (input) => expect(isEmailCodeFormat(input)).toBe(false),
);
