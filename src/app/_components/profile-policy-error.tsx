"use client";

import { useTranslations } from "next-intl";

const errorKeys = {
  PROFILE_LATIN_NAME_REQUIRED: "latinRequired",
  PROFILE_LATIN_LEGAL_NAME_REQUIRED: "latinLegalRequired",
  PROFILE_GRADE_NOT_OFFERED: "gradeNotOffered",
  PROFILE_POLICY_CHANGED: "conflict",
  PROFILE_PROGRAM_YEAR_CHANGED: "yearChanged",
  PROFILE_NO_CURRENT_YEAR: "noCurrentYear",
} as const;

/** Share translations between inline errors and global notifications without importing tRPC. */
export function ProfilePolicyError({ message }: { message?: string }) {
  const t = useTranslations("profilePolicy");
  return (
    <>
      {message && Object.hasOwn(errorKeys, message)
        ? t(errorKeys[message as keyof typeof errorKeys])
        : message}
    </>
  );
}
