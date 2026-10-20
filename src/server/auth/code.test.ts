import { afterEach, expect, it, vi } from "vitest";
import { randomInt } from "crypto";
import type * as Crypto from "crypto";
import {
  generateRegistrationCode,
  generateEmailVerificationCode,
  normalizeRegCode,
  normalizeEmailCode,
  REG_CODE_ALPHABET,
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

it("issues mixed five-character invitations and four-digit mailbox codes", () => {
  for (let i = 0; i < 250; i++) {
    const invitation = generateRegistrationCode();
    expect(invitation).toMatch(/^[023456789ABCDEFGHIJKMNPQRSTUVWXYZ]{5}$/);
    expect(invitation).toMatch(/[A-Z]/);
    expect(invitation).toMatch(/[0-9]/);
    expect(generateEmailVerificationCode()).toMatch(/^[0-9]{4}$/);
  }
});

it("rejects single-class invitations while retaining canonical zero and I", () => {
  const draws = ["00000", "AAAAA", "0AI9Z"].flatMap((candidate) =>
    [...candidate].map((character) => REG_CODE_ALPHABET.indexOf(character)),
  );
  vi.mocked(randomInt).mockImplementation(() => draws.shift() ?? 0);
  expect(generateRegistrationCode()).toBe("0AI9Z");
  expect(randomInt).toHaveBeenCalledTimes(15);
  expect(randomInt).toHaveBeenCalledWith(0, REG_CODE_ALPHABET.length);
});

it.each([0, 9])(
  "fails closed when a faulty random source never provides mixed characters (%s)",
  (value) => {
    vi.mocked(randomInt).mockImplementation(() => value);
    expect(() => generateRegistrationCode()).toThrow(
      "Could not generate a mixed registration code.",
    );
    expect(randomInt).toHaveBeenCalledTimes(500);
  },
);

it("keeps leading zeros and digit one in numeric mailbox codes", () => {
  vi.mocked(randomInt)
    // crypto also exposes a callback overload returning void; implementations
    // retain the synchronous numeric draws without narrowing that public API.
    .mockImplementationOnce(() => 1)
    .mockImplementationOnce(() => 9999);
  expect(generateEmailVerificationCode()).toBe("0001");
  expect(generateEmailVerificationCode()).toBe("9999");
  expect(randomInt).toHaveBeenNthCalledWith(1, 0, 10000);
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
