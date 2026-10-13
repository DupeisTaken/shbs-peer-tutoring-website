"use client";
import { useTranslations } from "next-intl";

/** A presentation fallback is never written into canonical names, intake snapshots or audit evidence. */
export function participantNameLabel(
  name: string | null | undefined,
  username: string | null | undefined,
  unnamed: string,
) {
  return name?.trim() ? name : username?.trim() ? username : unnamed;
}
export function ParticipantName({
  name,
  username,
}: {
  name?: string | null;
  username?: string | null;
}) {
  const t = useTranslations("participantNames");
  return <>{participantNameLabel(name, username, t("unnamed"))}</>;
}
