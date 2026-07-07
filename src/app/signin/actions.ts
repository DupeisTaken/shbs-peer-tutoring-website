"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { db } from "~/server/db";
import { signIn } from "~/server/auth";
import { verifySigninPassword } from "~/server/auth/credentials";
import { maskEmail } from "~/server/auth/mask";
import { issueLoginCode } from "~/server/auth/two-factor";
import { getFeatures } from "~/server/program/features";

export type SignInState =
  | { step: "password"; error?: string }
  | { step: "code"; userId: string; email: string; error?: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
}

/**
 * Server action behind the sign-in form. On success `signIn` throws a redirect (to
 * `redirectTo`) which must propagate; on bad credentials it throws an `AuthError`, which
 * we translate into a generic message (never leaking whether the email or password was wrong).
 * When `authorize` rate-limits the attempt it throws a CredentialsSignin with code
 * `rate_limited`, which we surface as a distinct "too many attempts" message.
 */
export async function signInAction(
  prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const t = await getTranslations("auth");
  const step = formData.get("step");

  if (step === "code") {
    const userIdRaw = formData.get("userId");
    const emailRaw = formData.get("email");
    const userId =
      typeof userIdRaw === "string"
        ? userIdRaw
        : prevState.step === "code"
          ? prevState.userId
          : "";
    const email =
      typeof emailRaw === "string" ? emailRaw : prevState.step === "code" ? prevState.email : "";
    try {
      await signIn("credentials", {
        intent: "login_2fa",
        userId,
        code: formData.get("code"),
        redirectTo: "/",
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return { step: "code", userId, email, error: t("twoFactor.invalid") };
      }
      throw error; // re-throw the success redirect (NEXT_REDIRECT)
    }
    return prevState;
  }

  const identifierRaw = formData.get("identifier");
  const passwordRaw = formData.get("password");
  const identifier = typeof identifierRaw === "string" ? identifierRaw : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  const verified = await verifySigninPassword(identifier, password, await clientIp());
  if (!verified.ok) {
    return {
      step: "password",
      error: verified.reason === "rate_limited" ? t("tooManyAttempts") : t("invalidCredentials"),
    };
  }

  const features = await getFeatures(db);
  if (features.EMAIL_2FA && verified.user.twoFactorEnabled) {
    const { email } = await issueLoginCode(verified.user.id);
    return { step: "code", userId: verified.user.id, email: maskEmail(email) };
  }

  try {
    await signIn("credentials", {
      identifier,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code === "rate_limited") {
      return { step: "password", error: t("tooManyAttempts") };
    }
    if (error instanceof AuthError) {
      return { step: "password", error: t("invalidCredentials") };
    }
    throw error; // re-throw the success redirect (NEXT_REDIRECT)
  }
  return { step: "password" };
}
