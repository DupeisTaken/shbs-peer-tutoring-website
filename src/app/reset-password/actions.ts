"use server";

import { resetPassword } from "~/server/auth/password-reset";

export type ResetState = { ok?: true; error?: string } | undefined;

/**
 * Server action behind the reset-password form. Validates the token + new password and,
 * on success, updates the password (the token is single-use). See password-reset.ts.
 */
export async function resetPasswordAction(
  _prevState: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const tokenRaw = formData.get("token");
  const passwordRaw = formData.get("password");
  const confirmRaw = formData.get("confirm");
  const token = typeof tokenRaw === "string" ? tokenRaw : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  const confirm = typeof confirmRaw === "string" ? confirmRaw : "";

  if (!token) return { error: "This reset link is invalid or has expired." };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) return { error: "Passwords don't match." };

  const ok = await resetPassword(token, password);
  if (!ok) return { error: "This reset link is invalid or has expired." };
  return { ok: true };
}
