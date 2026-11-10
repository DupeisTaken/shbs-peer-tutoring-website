"use server";

import { resetPassword } from "~/server/auth/password-reset";
import { newPasswordLengthError } from "~/lib/password-contract";

export type ResetState =
  | { ok: true; username: string | null; email: string }
  | { ok?: false; error: string; code?: "password-length" }
  | undefined;

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
  const passwordError = newPasswordLengthError(password);
  if (passwordError) return { error: passwordError, code: "password-length" };
  if (password !== confirm) return { error: "Passwords don't match." };

  const result = await resetPassword(token, password);
  if (!result) return { error: "This reset link is invalid or has expired." };
  return { ok: true, username: result.username, email: result.email };
}
