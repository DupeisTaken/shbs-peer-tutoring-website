"use client";
import { useTranslations } from "next-intl";
import { ProfilePolicyError } from "./profile-policy";

/** Stable server codes keep admission errors translated without exposing quota identities. */
export function SignupError({
  error,
}: {
  error: {
    message: string;
    data?: { retryAfterSeconds?: number | null } | null;
  };
}) {
  const t = useTranslations("signupProtection");
  if (error.message === "SIGNUP_RETRY")
    return <>{t("retry", { seconds: error.data?.retryAfterSeconds ?? 60 })}</>;
  if (error.message === "SIGNUP_MAIL_FAILED") return <>{t("mailFailed")}</>;
  return <ProfilePolicyError message={error.message} />;
}
