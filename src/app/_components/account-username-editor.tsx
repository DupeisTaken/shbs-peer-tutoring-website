"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

/** Separate from ordinary profile edits: this operation always requires live Head authority. */
export function AccountUsernameEditor({ userId, username: initial, profileVersion, onSaved }: {
  userId: string; username?: string | null; profileVersion: number; onSaved: () => void;
}) {
  const t = useTranslations("accountProfile");
  const [username, setUsername] = useState(initial ?? "");
  const utils = api.useUtils();
  const router = useRouter();
  const save = api.admin.updateAccountUsername.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.admin.accounts.invalidate(), utils.admin.tutors.invalidate(), utils.account.me.invalidate()]);
      // Server-rendered headers also show the username, including the Head's own handle.
      router.refresh();
      onSaved();
    },
  });
  return <form className="mt-5 space-y-3 border-t border-slate-200 pt-4" onSubmit={(event) => {
    event.preventDefault(); save.mutate({ userId, username, expectedProfileVersion: profileVersion });
  }}>
    <label className="block">
      <span className="label">{t("username")}</span>
      <input aria-label={t("username")} className="input min-h-11 w-full lg:min-h-10" value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={64} pattern="[A-Za-z0-9]+" autoCapitalize="none" autoCorrect="off" />
      <span className="muted text-xs">{t("usernameHelp")}</span>
    </label>
    <button className="btn-secondary min-h-11 lg:min-h-10" disabled={save.isPending || !username.trim()}>{t("saveUsername")}</button>
    {save.error && <p role="alert" className="text-sm text-red-600">{save.error.message}</p>}
  </form>;
}
