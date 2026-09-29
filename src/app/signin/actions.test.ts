import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  candidate: vi.fn(),
  verify: vi.fn(),
  issue: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ signIn: mocks.signIn }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => ({ EMAIL_2FA: true }),
}));
vi.mock("~/server/auth/credentials", () => ({
  findSigninTwoFactorUser: mocks.candidate,
  verifySigninPassword: mocks.verify,
}));
vi.mock("~/server/auth/two-factor", () => ({ issueLoginCode: mocks.issue }));
vi.mock("~/server/email/sender", () => ({
  isEmailDeliveryAvailable: () => true,
}));
import { signInAction } from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.candidate.mockResolvedValue(null);
  mocks.signIn.mockRejectedValue(new Error("NEXT_REDIRECT"));
});

it.each(["password", "code"])(
  "retains query and fragment on the %s step",
  async (step) => {
    const form = new FormData();
    form.set("step", step);
    form.set("callbackUrl", "/admin/approvals?request=one#details");
    await expect(signInAction({ step: "password" }, form)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({
        redirectTo: "/admin/approvals?request=one#details",
      }),
    );
  },
);
it.each(["password", "code"])(
  "rejects a tampered callback on the %s step",
  async (step) => {
    const form = new FormData();
    form.set("step", step);
    form.set("callbackUrl", "//evil.example");
    await expect(signInAction({ step: "password" }, form)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/" }),
    );
  },
);
it("issues a code before redirecting and preserves the destination on completion", async () => {
  mocks.candidate.mockResolvedValue({ twoFactorEnabled: true });
  mocks.verify.mockResolvedValue({
    ok: true,
    user: { id: "synthetic", sessionVersion: 1 },
  });
  mocks.issue.mockResolvedValue({ email: "synthetic@example.test" });
  const form = new FormData();
  form.set("step", "password");
  form.set("callbackUrl", "/messages");
  const state = await signInAction({ step: "password" }, form);
  expect(state.step).toBe("code");
  expect(mocks.signIn).not.toHaveBeenCalled();
  form.set("step", "code");
  form.set("code", "AB234");
  await expect(signInAction(state, form)).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.signIn).toHaveBeenCalledWith(
    "credentials",
    expect.objectContaining({
      userId: "synthetic",
      code: "AB234",
      redirectTo: "/messages",
    }),
  );
});
