import { beforeEach, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";

type JwtCallback = (args: { token: JWT }) => Promise<JWT | null>;
type Authorize = (raw: object, request: Request) => Promise<object | null>;
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  jwt: undefined as JwtCallback | undefined,
  authorize: undefined as Authorize | undefined,
  verifyPassword: vi.fn(),
  verifyCode: vi.fn(),
}));
vi.mock("./credentials", () => ({ clientIpFromRequest: () => "test-ip", verifySigninPassword: mocks.verifyPassword }));
vi.mock("./two-factor", () => ({ verifyLoginCode: mocks.verifyCode }));
vi.mock("~/server/program/features", () => ({ getFeatures: async () => ({ EMAIL_2FA: true }) }));
vi.mock("next-auth/providers/credentials", () => ({ default: (config: object) => config }));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: mocks.findUser } },
}));
vi.mock("next-auth", () => ({
  CredentialsSignin: class extends Error {},
  default: (config: { callbacks: { jwt: JwtCallback }; providers: { authorize: Authorize }[] }) => {
    mocks.jwt = config.callbacks.jwt;
    mocks.authorize = config.providers[0]!.authorize;
    return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() };
  },
}));
import "./index";

beforeEach(() => { mocks.findUser.mockReset(); mocks.verifyPassword.mockReset(); mocks.verifyCode.mockReset(); });

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

it("revokes tutor session access while retaining historical identity links", async () => {
  mocks.findUser.mockResolvedValue({ tutorId: "historical-tutor", tutorAccessRevoked: true, role: "VIEWER" });
  expect(await mocks.jwt!({ token: { sub: "historic", role: "TUTOR", tutorId: "historical-tutor" } })).toMatchObject({ role: "VIEWER", tutorId: null });
});

it("allows suspended 2FA users to authenticate for appeal only after a valid emailed code", async () => {
  mocks.findUser.mockResolvedValue({ id: "suspended", email: "suspended@example.test", twoFactorEnabled: true, suspendedAt: new Date() });
  mocks.verifyCode.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const input = { intent: "login_2fa", userId: "suspended", code: "ABCDE" };
  const request = new Request("http://localhost/api/auth/callback/credentials");
  expect(await mocks.authorize!(input, request)).toBeNull();
  expect(await mocks.authorize!(input, request)).toMatchObject({ id: "suspended" });
  expect(mocks.verifyCode).toHaveBeenCalledTimes(2);
});

it("does not let a suspended 2FA user bypass the emailed code with a password-only POST", async () => {
  mocks.verifyPassword.mockResolvedValue({ ok: true, user: { id: "suspended", email: "suspended@example.test", twoFactorEnabled: true } });
  await expect(mocks.authorize!({ identifier: "suspended@example.test", password: "Password123!" }, new Request("http://localhost")))
    .rejects.toMatchObject({ code: "two_factor_required" });
});
