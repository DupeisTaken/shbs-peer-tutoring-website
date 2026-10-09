import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  inspect: vi.fn(),
  owner: vi.fn(),
  redeem: vi.fn(),
  cookie: vi.fn(),
}));
vi.mock("~/server/auth", () => ({
  auth: state.auth,
  signIn: state.signIn,
  signOut: vi.fn(),
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: state.cookie }),
}));
vi.mock("~/server/auth/account-invitations", () => ({
  inspectAccountInvitation: state.inspect,
  invitationEmailOwner: state.owner,
  redeemAccountInvitation: state.redeem,
}));
import { invitationSignIn, rememberInvitation } from "./actions";
const input = { invitationId: "recipient-invitation", proof: "a".repeat(64) };

it("stores only server-validated short-lived HttpOnly handoff proof", async () => {
  const handoff = { invitationId: "receipt123", proof: "a".repeat(64) };
  await rememberInvitation(handoff);
  expect(state.inspect).toHaveBeenCalledWith({}, handoff);
  expect(state.cookie).toHaveBeenCalledWith(
    "invitation-receipt123",
    handoff.proof,
    expect.objectContaining({
      httpOnly: true,
      sameSite: "lax",
      path: "/register-account",
      maxAge: 900,
    }),
  );
  state.cookie.mockClear();
  state.inspect.mockRejectedValueOnce(Error("invalid proof"));
  await expect(rememberInvitation(handoff)).rejects.toThrow("invalid proof");
  expect(state.cookie).not.toHaveBeenCalled();
});
beforeEach(() => {
  vi.clearAllMocks();
  state.auth.mockResolvedValue(null);
  state.inspect.mockResolvedValue({
    kind: "LOGIN",
    email: "recipient@example.test",
    requiresSignIn: true,
    mfaRequired: false,
    needsPassword: false,
    completed: false,
  });
  state.signIn.mockResolvedValue(undefined);
  state.owner.mockResolvedValue({ id: "recipient" });
  state.redeem.mockResolvedValue({ completed: true });
});
it("records sign-in-only completion after an accepted session exchange", async () => {
  await expect(invitationSignIn(input)).resolves.toMatchObject({
    signedIn: true,
    completedLogin: true,
  });
  expect(state.signIn).toHaveBeenCalledOnce();
  expect(state.redeem).toHaveBeenCalledWith(
    {},
    { ...input, reviewed: true, firstName: "", lastName: "" },
    "recipient",
    true,
  );
  expect(state.signIn.mock.invocationCallOrder[0]).toBeLessThan(
    state.redeem.mock.invocationCallOrder[0]!,
  );
});
it("never records completion after failed session creation", async () => {
  state.signIn.mockRejectedValue(new Error("Session write failed"));
  await expect(invitationSignIn(input)).rejects.toThrow("Session write failed");
  expect(state.redeem).not.toHaveBeenCalled();
});
it("retains enforced MFA without consuming a sign-in-only source", async () => {
  state.inspect.mockResolvedValue({
    kind: "LOGIN",
    requiresSignIn: true,
    mfaRequired: true,
    needsPassword: false,
  });
  await expect(invitationSignIn(input)).resolves.toMatchObject({
    signedIn: false,
    mfaRequired: true,
  });
  expect(state.signIn).not.toHaveBeenCalled();
  expect(state.redeem).not.toHaveBeenCalled();
});
it("resumes sign-in-only completion after the exact recipient completes MFA", async () => {
  state.auth.mockResolvedValue({ user: { id: "recipient" } });
  state.inspect.mockResolvedValue({
    kind: "LOGIN",
    email: "recipient@example.test",
    requiresSignIn: false,
    mfaRequired: true,
    needsPassword: false,
  });
  await expect(invitationSignIn(input)).resolves.toMatchObject({
    completedLogin: true,
  });
  expect(state.signIn).not.toHaveBeenCalled();
  expect(state.redeem).toHaveBeenCalledOnce();
});
it("never automatically accepts participation when the code signs in an existing account", async () => {
  state.inspect.mockResolvedValue({
    kind: "CREW",
    requiresSignIn: true,
    mfaRequired: false,
    needsPassword: false,
  });
  await expect(invitationSignIn(input)).resolves.toMatchObject({
    signedIn: true,
    completedLogin: false,
  });
  expect(state.redeem).not.toHaveBeenCalled();
});
