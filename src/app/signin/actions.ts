"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { getTranslations } from "next-intl/server";

import { signIn } from "~/server/auth";

/**
 * Server action behind the sign-in form. On success `signIn` throws a redirect (to
 * `redirectTo`) which must propagate; on bad credentials it throws an `AuthError`, which
 * we translate into a generic message (never leaking whether the email or password was wrong).
 * When `authorize` rate-limits the attempt it throws a CredentialsSignin with code
 * `rate_limited`, which we surface as a distinct "too many attempts" message.
 */
export async function signInAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const t = await getTranslations("auth");
  try {
    await signIn("credentials", {
      identifier: formData.get("identifier"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code === "rate_limited") {
      return t("tooManyAttempts");
    }
    if (error instanceof AuthError) {
      return t("invalidCredentials");
    }
    throw error; // re-throw the success redirect (NEXT_REDIRECT)
  }
  return undefined;
}
