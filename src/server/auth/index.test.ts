import { beforeEach, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";

type JwtCallback = (args: { token: JWT }) => Promise<JWT | null>;
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  jwt: undefined as JwtCallback | undefined,
}));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: mocks.findUser } },
}));
vi.mock("next-auth", () => ({
  CredentialsSignin: class extends Error {},
  default: (config: { callbacks: { jwt: JwtCallback } }) => {
    mocks.jwt = config.callbacks.jwt;
    return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() };
  },
}));
import "./index";

beforeEach(() => mocks.findUser.mockReset());

it("invalidates a deleted student session instead of leaving a sign-in redirect loop", async () => {
  mocks.findUser.mockResolvedValue(null);
  expect(
    await mocks.jwt!({
      token: { sub: "deleted-student", role: "STUDENT", tutorId: null },
    }),
  ).toBeNull();
});
it("revokes tutor participation on the next request when management removes the link", async () => {
  mocks.findUser.mockResolvedValue({ tutorId: null });
  expect(
    await mocks.jwt!({
      token: { sub: "student", role: "STUDENT", tutorId: "old-tutor-link" },
    }),
  ).toMatchObject({ sub: "student", tutorId: null });
});
