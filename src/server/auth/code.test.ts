import { expect, it } from "vitest";
import { generateRegistrationCode, normalizeRegCode } from "./code";

it("issues five unambiguous uppercase characters containing both letters and digits", () => {
  for (let i = 0; i < 250; i++) {
    const code = generateRegistrationCode();
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
    expect(code).toMatch(/[A-Z]/);
    expect(code).toMatch(/[2-9]/);
  }
});

it("accepts copied separators and lowercase without changing code identity", () => {
  expect(normalizeRegCode(" ab-3d 7 ")).toBe("AB3D7");
});
