"use client";
import { useProfileReloadFocus } from "./use-profile-reload-focus";
import { useDialogPending } from "./ui/modal";
import { Button } from "./ui/button";
import { ProfileEditSection } from "./profile-edit-section";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
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
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const committed = useRef(false);
  const [reloading, setReloading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const reloadFocus = useProfileReloadFocus(formRef, reloading);
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
      // This success owns only the username section, never the enclosing profile dialog.
      committed.current = true;
      setSaved(true);
      setNeedsRefresh(true);
      await reloadUsername(true);
      // Server-rendered headers also show the username, including the Head's own handle.
      router.refresh();
      onSaved?.();
    },
  });
  const busy = useDialogPending(save.isPending);
  const controlsBusy = busy || reloading;
  const reloadUsername = async (afterSave: boolean) => {
    reloadPending.current = true;
    setReloading(true);
    setReloadError(null);
    try {
      if (afterSave) {
        await settleRefreshes([
          () => invalidateAndReport(utils.admin.accounts),
          () => invalidateAndReport(utils.admin.tutors),
          () => invalidateAndReport(utils.account.me),
        ]);
      }
      const accounts = await utils.admin.accounts.fetch(undefined, {
        staleTime: 0,
      });
      const latest = accounts.rows.find((row) => row.userId === userId);
      if (latest?.profileVersion == null) throw new Error(common("loadFailed"));
      // Only this section adopts its fresh snapshot; sibling drafts are independent.
      setUsername(latest.username ?? "");
      setExpectedProfileVersion(latest.profileVersion);
      setRefreshFailed(false);
      setNeedsRefresh(false);
      committed.current = false;
      return true;
    } catch (error) {
      // A committed write remains fenced; its recovery retries reads, never the rename.
      if (afterSave) setRefreshFailed(true);
      setReloadError(
        error instanceof Error ? error.message : common("loadFailed"),
      );
      return false;
    } finally {
      reloadPending.current = false;
      setReloading(false);
    }
  };
  return (
    <form
      ref={formRef}
      className="mt-5 space-y-3 border-t border-slate-200 pt-4"
      onChangeCapture={() => {
        if (!committed.current) setSaved(false);
      }}
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
        title={t("username")}
        busy={controlsBusy}
        saved={saved}
        refreshFailed={refreshFailed}
        readOnly={needsRefresh}
        refreshBusy={controlsBusy}
        refreshError={saved ? reloadError : null}
        onRefresh={() => {
          if (busy || submitting.current || reloadPending.current) return;
          reloadFocus.beginReload();
          void reloadUsername(true).then((succeeded) => {
            if (succeeded) save.reset();
            reloadFocus.finishReload(succeeded);
          });
        }}
        actions={
          <Button type="submit" disabled={controlsBusy || !username.trim()}>
            {t("saveUsername")}
          </Button>
        }
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
              reloadFocus.beginReload();
              const succeeded = await reloadUsername(false);
              if (succeeded) save.reset();
              reloadFocus.finishReload(succeeded);
            }}
          >
            {t("reloadUsername")}
          </button>
        )}
        {reloadError && !saved && (
          <p role="alert" className="text-sm text-red-600">
            {reloadError}
          </p>
        )}
      </ProfileEditSection>
    </form>
  );
}
