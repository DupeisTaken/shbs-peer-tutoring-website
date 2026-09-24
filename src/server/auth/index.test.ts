import { beforeEach, expect, it, vi } from "vitest";
import type { User } from "next-auth";
import type { JWT } from "next-auth/jwt";

type JwtCallback = (args: { token: JWT; user?: User }) => Promise<JWT | null>;
type Authorize = (raw: object, request: Request) => Promise<object | null>;
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  jwt: undefined as JwtCallback | undefined,
  authorize: undefined as Authorize | undefined,
  verifyPassword: vi.fn(),
  verifyCode: vi.fn(),
  credentialState: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("~/server/transactions", () => ({ lockEntity: vi.fn() }));
vi.mock("~/server/account-profile", () => ({ lockAccountProfile: vi.fn(), updateAccountProfile: vi.fn() }));
vi.mock("./tutor-link", () => ({ resolveTutorLink: async () => null }));
vi.mock("./username", () => ({ ensureUserUsername: vi.fn() }));
vi.mock("./credentials", () => ({ clientIpFromRequest: () => "test-ip", verifySigninPassword: mocks.verifyPassword }));
vi.mock("./two-factor", () => ({ verifyLoginCode: mocks.verifyCode }));
vi.mock("~/server/program/features", () => ({ getFeatures: async () => ({ EMAIL_2FA: true }) }));
vi.mock("next-auth/providers/credentials", () => ({ default: (config: object) => config }));
vi.mock("~/server/db", () => ({
  db: {
    user: { findUnique: mocks.findUser },
    $transaction: async (work: (tx: object) => Promise<unknown>) => work({
      $queryRaw: vi.fn(),
      user: { findUnique: mocks.credentialState, update: mocks.updateUser },
    }),
  },
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

beforeEach(() => { mocks.findUser.mockReset(); mocks.verifyPassword.mockReset(); mocks.verifyCode.mockReset(); mocks.credentialState.mockReset(); mocks.updateUser.mockReset(); });

it("invalidates a deleted student session instead of leaving a sign-in redirect loop", async () => {
  mocks.findUser.mockResolvedValue(null);
  expect(
    await mocks.jwt!({
      token: { sub: "deleted-student", role: "STUDENT", tutorId: null },
    }),
  ).toBeNull();
});
it("revokes tutor participation on the next request when management removes the link", async () => {
  mocks.findUser.mockResolvedValue({ tutorId: null, sessionVersion: 0 });
  expect(
    await mocks.jwt!({
      token: { sub: "student", role: "STUDENT", tutorId: "old-tutor-link", sessionVersion: 0 },
    }),
  ).toMatchObject({ sub: "student", tutorId: null });
});

it("revokes tutor session access while retaining historical identity links", async () => {
  mocks.findUser.mockResolvedValue({ tutorId: "historical-tutor", tutorAccessRevoked: true, role: "VIEWER", sessionVersion: 0 });
  expect(await mocks.jwt!({ token: { sub: "historic", role: "TUTOR", tutorId: "historical-tutor", sessionVersion: 0 } })).toMatchObject({ role: "VIEWER", tutorId: null });
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

// Credential evidence keeps the generation captured before a reset, even when issuance resumes later.
it.each([undefined, 0, -1, 0.5, NaN])("rejects a legacy or stale reused session (%s)", async (sessionVersion) => {
  mocks.findUser.mockResolvedValue({ role: "VIEWER", tutorId: null, sessionVersion: 1 });
  expect(await mocks.jwt!({ token: { sub: "user", role: "VIEWER", tutorId: null, sessionVersion } })).toBeNull();
});
it("does not turn a password verified before rotation into a fresh session", async () => {
  mocks.findUser.mockResolvedValue({ emailVerifiedAt: new Date(), tutorId: null, sessionVersion: 1 });
  expect(await mocks.jwt!({
    token: { role: "VIEWER", tutorId: null },
    user: { id: "user", email: "user@example.test", sessionVersion: 0 },
  })).toBeNull();
});
it("carries the password generation from verified credentials without returning the hash", async () => {
  mocks.verifyPassword.mockResolvedValue({ ok: true, user: { id: "user", email: "user@example.test", twoFactorEnabled: false, sessionVersion: 4 } });
  expect(await mocks.authorize!({ identifier: "user@example.test", password: "Password123!" }, new Request("http://localhost")))
    .toEqual({ id: "user", email: "user@example.test", name: undefined, sessionVersion: 4 });
});

it("rechecks credential evidence under the user lock when rotation wins after the initial read", async () => {
  mocks.findUser.mockResolvedValue({ emailVerifiedAt: new Date(), tutorId: null, sessionVersion: 0 });
  mocks.credentialState.mockResolvedValue({ sessionVersion: 1 });
  expect(await mocks.jwt!({ token: { role: "VIEWER", tutorId: null }, user: { id: "user", sessionVersion: 0 } })).toBeNull();
  expect(mocks.updateUser).not.toHaveBeenCalled();
});

it("issues a new login at the proved generation after rotation, then rejects it on the next rotation", async () => {
  mocks.findUser.mockResolvedValue({ emailVerifiedAt: new Date(), tutorId: null, sessionVersion: 1 });
  mocks.credentialState.mockResolvedValue({ sessionVersion: 1 });
  mocks.updateUser.mockResolvedValue({ id: "user", role: "VIEWER", tutorId: null, sessionVersion: 1 });
  const token = await mocks.jwt!({ token: { role: "VIEWER", tutorId: null }, user: { id: "user", sessionVersion: 1 } });
  expect(token).toMatchObject({ sub: "user", sessionVersion: 1 });
  mocks.findUser.mockResolvedValue({ role: "VIEWER", tutorId: null, sessionVersion: 2 });
  expect(await mocks.jwt!({ token: token! })).toBeNull();
});
