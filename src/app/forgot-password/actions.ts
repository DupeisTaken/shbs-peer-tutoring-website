"use server";

import { issuePasswordReset } from "~/server/auth/password-reset";

/**
 * Server action behind the forgot-password form. Always returns the same success state
 * (whether or not an account matched) so the form can't be used to enumerate accounts.
 * Email delivery is scaffolded — see src/server/auth/password-reset.ts.
 */
export async function forgotPasswordAction(
  _prevState: { sent: boolean } | undefined,
  formData: FormData,
): Promise<{ sent: boolean }> {
  const raw = formData.get("identifier");
  const identifier = typeof raw === "string" ? raw : "";
  await issuePasswordReset(identifier);
  return { sent: true };
}
