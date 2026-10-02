"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useDialogPending } from "./ui/modal";
import { ProfileEditSection } from "./profile-edit-section";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { invalidateAndReport } from "~/lib/invalidate-refresh";

/** Separate from ordinary profile edits: this operation always requires live Head authority. */
export function AccountUsernameEditor({
  userId,
  username: initial,
  profileVersion,
  onSaved,
}: {
  userId: string;
  username?: string | null;
  profileVersion: number;
  onSaved?: () => void;
}) {
  const t = useTranslations("accountProfile");
  const common = useTranslations("uiPatterns");
  const [username, setUsername] = useState(initial ?? "");
  const [saved, setSaved] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const committed = useRef(false);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const reloadPending = useRef(false);
  const submitting = useRef(false);
  // Academic saves refetch this same account. Keep the version that belongs to this draft.
  const [expectedProfileVersion, setExpectedProfileVersion] =
    useState(profileVersion);
  const utils = api.useUtils();
  const router = useRouter();
  const save = api.admin.updateAccountUsername.useMutation({
    onSettled: () => {
      submitting.current = false;
    },
    onSuccess: async () => {
      // Completion belongs to the username section, never the enclosing profile dialog.
      committed.current = true;
      setSaved(true);
      try {
        await settleRefreshes([
          () => invalidateAndReport(utils.admin.accounts),
          () => invalidateAndReport(utils.admin.tutors),
          () => invalidateAndReport(utils.account.me),
        ]);
      } catch {
        setRefreshFailed(true);
      }
      // Server-rendered headers also show the username, including the Head's own handle.
      router.refresh();
      onSaved?.();
    },
  });
  const busy = useDialogPending(save.isPending);
  const controlsBusy = busy || reloading;
  return (
    <form
      className="mt-5 space-y-3 border-t border-slate-200 pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          busy ||
          submitting.current ||
          reloadPending.current ||
          committed.current
        )
          return;
        submitting.current = true;
        save.mutate({ userId, username, expectedProfileVersion });
      }}
    >
      <ProfileEditSection
        busy={controlsBusy}
        saved={saved}
        refreshFailed={refreshFailed}
        className="space-y-3"
      >
        <label className="block">
          <span className="label">{t("username")}</span>
          <input
            aria-label={t("username")}
            className="input min-h-11 w-full lg:min-h-10"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            maxLength={64}
            pattern="[A-Za-z0-9]+"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <span className="muted text-xs">{t("usernameHelp")}</span>
        </label>
        <button
          className="btn-secondary min-h-11 lg:min-h-10"
          disabled={!username.trim()}
        >
          {t("saveUsername")}
        </button>
        {save.error && (
          <p role="alert" className="text-sm text-red-600">
            {save.error.message}
          </p>
        )}
        {save.error?.data?.code === "CONFLICT" && (
          <button
            type="button"
            className="btn-secondary min-h-11 lg:min-h-10"
            onClick={async () => {
              if (
                busy ||
                submitting.current ||
                reloadPending.current ||
                committed.current
              )
                return;
              // Reload may replace this draft. Exclude writes immediately, but keep
              // dialog dismissal available for this cancellable read.
              reloadPending.current = true;
              setReloading(true);
              setReloadError(null);
              try {
                // Explicit Reload must read the server even when the list cache is fresh.
                const accounts = await utils.admin.accounts.fetch(undefined, {
                  staleTime: 0,
                });
                const latest = accounts.rows.find(
                  (row) => row.userId === userId,
                );
                if (latest?.profileVersion != null) {
                  setUsername(latest.username ?? "");
                  setExpectedProfileVersion(latest.profileVersion);
                  save.reset();
                }
              } catch (error) {
                setReloadError(
                  error instanceof Error ? error.message : common("loadFailed"),
                );
              } finally {
                reloadPending.current = false;
                setReloading(false);
              }
            }}
          >
            {t("reloadUsername")}
          </button>
        )}
        {reloadError && (
          <p role="alert" className="text-sm text-red-600">
            {reloadError}
          </p>
        )}
      </ProfileEditSection>
    </form>
  );
}
