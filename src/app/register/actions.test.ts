import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  inspect: vi.fn(),
  owner: vi.fn(),
  redeem: vi.fn(),
}));
vi.mock("~/server/auth", () => ({
  auth: state.auth,
  signIn: state.signIn,
  signOut: vi.fn(),
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth/account-invitations", () => ({
  inspectAccountInvitation: state.inspect,
  invitationEmailOwner: state.owner,
  redeemAccountInvitation: state.redeem,
}));
import { invitationSignIn } from "./actions";
const input = { invitationId: "recipient-invitation", proof: "a".repeat(64) };
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
  await expect(invitationSignIn(input)).resolves.toEqual({
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
