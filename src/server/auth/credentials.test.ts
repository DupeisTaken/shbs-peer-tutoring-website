import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("~/server/db", () => ({
  db: { user: { findFirst: mocks.findFirst } },
}));
vi.mock("./password", () => ({ verifyPassword: () => true }));
import { verifySigninPassword } from "./credentials";

beforeEach(() => {
  mocks.findFirst.mockReset().mockResolvedValue({
    id: "student",
    email: "student@example.test",
    name: "Student",
    passwordHash: "hash",
    twoFactorEnabled: false,
    suspendedAt: null,
  });
});

it("allows a class of students to sign in behind one school IP", async () => {
  for (let i = 0; i < 35; i++)
    expect(
      (
        await verifySigninPassword(
          `class-${i}@example.test`,
          "password",
          "school-ip",
        )
      ).ok,
    ).toBe(true);
});
it("retains the ten-attempt per-identifier limit across different IP addresses", async () => {
  for (let i = 0; i < 10; i++)
    expect(
      (
        await verifySigninPassword(
          "guarded@example.test",
          "password",
          `ip-${i}`,
        )
      ).ok,
    ).toBe(true);
  expect(
    await verifySigninPassword(
      " GUARDED@example.test ",
      "password",
      "other-ip",
    ),
  ).toEqual({ ok: false, reason: "rate_limited" });
});
it("does not authenticate a suspended account", async () => {
  mocks.findFirst.mockResolvedValueOnce({
    id: "suspended",
    passwordHash: "hash",
    suspendedAt: new Date(),
  });
  expect(
    await verifySigninPassword(
      "suspended@example.test",
      "password",
      "suspended-ip",
    ),
  ).toEqual({ ok: false, reason: "invalid" });
});
