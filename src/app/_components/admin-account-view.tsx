"use client";

import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { AccountSettings } from "./account-settings";
import { useSessionAccessDenied, useSessionPageScroll } from "./session-view-state";
import { StatePanel } from "./ui/patterns";
import { Button } from "./ui/button";

/** This route owns only position. Existing shared account forms keep their drafts,
 * passwords and version snapshots local. These observers reuse the mounted forms'
 * cached reads; optional academic history remains on demand. */
export function AdminAccountView() {
  const t = useTranslations("participantRecovery");
  const me = api.account.me.useQuery();
  const features = api.program.features.useQuery();
  const policy = api.program.profilePolicy.useQuery();
  const emails = api.account.emailSettings.useQuery();
  const departure = api.departure.state.useQuery({ userId: undefined });
  const queries = [me, features, policy, emails, departure];
  const denied = useSessionAccessDenied(...queries);
  useSessionPageScroll({ id: "admin-account", ready: queries.every((query) => query.data !== undefined), enabled: !denied });
  if (denied) return <StatePanel kind="denied" title={t("accessDenied")}
    action={<Button disabled={queries.some((query) => query.isFetching)} onClick={() => {
      for (const query of queries) void query.refetch();
    }}>{t("retry")}</Button>} />;
  return <AccountSettings />;
}
