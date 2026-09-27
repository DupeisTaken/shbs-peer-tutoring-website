"use client";

import { ProfilePolicyError } from "./profile-policy";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** Stable server codes keep lifecycle guards localized without treating them as permission grants. */
export function AcademicError({
  message,
  selfService = false,
}: {
  message?: string;
  selfService?: boolean;
}) {
  const t = useTranslations("academics");
  const requiresConfirmation = message === "ACADEMIC_CONFIRMATION_REQUIRED";
  return (
    <>
      {requiresConfirmation ? (
        t("confirmationRequired")
      ) : message === "ACADEMIC_SHARED_EDITOR_REQUIRED" ? (
        t("useSharedEditor")
      ) : (
        <ProfilePolicyError message={message} />
      )}
      {requiresConfirmation && selfService && (
        <>
          {" "}
          <Link
            href="/my-account"
            className="link inline-flex min-h-11 items-center lg:min-h-8"
          >
            {t("review")}
          </Link>
        </>
      )}
    </>
  );
}
