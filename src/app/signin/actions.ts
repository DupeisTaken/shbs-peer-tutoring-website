"use server";

import { AuthError } from "next-auth";

import { signIn } from "~/server/auth";

/**
 * Server action behind the sign-in form. On success `signIn` throws a redirect (to
 * `redirectTo`) which must propagate; on bad credentials it throws an `AuthError`, which
 * we translate into a generic message (never leaking whether the email or password was wrong).
 */
export async function signInAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "Invalid email or password.";
    }
    throw error; // re-throw the success redirect (NEXT_REDIRECT)
  }
  return undefined;
}
