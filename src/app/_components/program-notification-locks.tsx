"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { NotificationLockValue } from "~/lib/notification-categories";
import { api } from "~/trpc/react";
import { Button } from "./ui/button";
import {
  FormActions,
  InlineNotice,
  SettingRow,
  StatePanel,
} from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { useSessionAccessDenied } from "./session-view-state";

export function NotificationLockFields({
  rows,
  disabled,
  onChange,
}: {
  rows: NotificationLockValue[];
  disabled: boolean;
  onChange: (choice: NotificationLockValue) => void;
}) {
  const t = useTranslations("notificationLocks");
  const preferences = useTranslations("notificationPreferences");
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => {
        const category = preferences(`categories.${row.category}`);
        return (
          <div key={row.category} className="py-4">
            <SettingRow
              stackOnMobile
              label={category}
              description={preferences(`descriptions.${row.category}`)}
              control={
                <>
                  {row.category !== "reminders" ? (
                    <label className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-accent-600 h-4 w-4"
                        disabled={disabled}
                        checked={row.badgeLocked}
                        aria-label={t("badgeFor", { category })}
                        onChange={(event) =>
                          onChange({
                            category: row.category,
                            emailLocked: row.emailLocked,
                            badgeLocked: event.target.checked,
                          })
                        }
                      />
                      {t("badge")}
                    </label>
                  ) : (
                    <span className="px-2 text-xs text-slate-600">
                      {preferences("emailOnly")}
                    </span>
                  )}
                  <label className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-accent-600 h-4 w-4"
                      disabled={disabled}
                      checked={row.emailLocked}
                      aria-label={t("emailFor", { category })}
                      onChange={(event) =>
                        onChange({
                          category: row.category,
                          badgeLocked: row.badgeLocked,
                          emailLocked: event.target.checked,
                        })
                      }
                    />
                    {t("email")}
                  </label>
                </>
              }
            />
          </div>
        );
      })}
    </div>
  );
}

/** The draft retains its original expected snapshot. A successful write is
 * recovered through reads only, including when another tab hides this editor. */
export function ProgramNotificationLocks() {
  const t = useTranslations("notificationLocks");
  const ui = useTranslations("uiPatterns");
  const recovery = useTranslations("participantRecovery");
  const settings = api.program.notificationLockSettings.useQuery();
  const save = api.program.setNotificationLocks.useMutation();
  const utils = api.useUtils();
  const denied = useSessionAccessDenied(settings);
  const admitted = useRef(false);
  const [draft, setDraft] = useState<{
    categories: NotificationLockValue[];
    expectedCategories: NotificationLockValue[];
  } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload(replaceDraft = false) {
    setRecovering(true);
    try {
      const result = await settings.refetch();
      if (!result.isSuccess || !result.data)
        throw new Error("Requirements refresh failed");
      if (replaceDraft || accepted || admitted.current) setDraft(null);
      if (replaceDraft && save.error) save.reset();
      setRefreshFailed(false);
      setAccepted(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      setRecovering(false);
    }
  }

  async function submit() {
    if (
      admitted.current ||
      busy ||
      recovering ||
      accepted ||
      refreshFailed ||
      settings.error ||
      denied ||
      !settings.data?.canEdit ||
      !draft
    )
      return;
    admitted.current = true;
    setBusy(true);
    try {
      await save.mutateAsync(draft);
      setAccepted(true);
      void Promise.allSettled([
        utils.account.notificationPreferences.invalidate(),
        utils.notification.unreadCount.invalidate(),
        utils.notification.list.invalidate(),
      ]);
      await reload(true);
    } catch {
      /* A rejected write retains its draft and expected snapshot. */
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  }

  const blocked =
    busy ||
    recovering ||
    accepted ||
    refreshFailed ||
    !!settings.error ||
    !settings.data?.canEdit;
  const data = settings.data;
  if (denied)
    return (
      <StatePanel
        kind="denied"
        title={recovery("accessDenied")}
        action={
          <Button disabled={recovering} onClick={() => void reload()}>
            {ui("retry")}
          </Button>
        }
      />
    );
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t("help")}</p>
      <p className="text-xs text-slate-600">{t("deliveryHelp")}</p>
      <QueryFeedback
        hasData={!!settings.data}
        loading={!settings.data && !settings.error}
        error={!!settings.error && !accepted}
        retrying={recovering || settings.isFetching}
        loadingTitle={recovery("loading")}
        errorTitle={t("loadFailed")}
        retryLabel={ui("retry")}
        onRetry={() => void reload()}
      />
      {data && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {!data.canEdit && (
            <p className="text-sm text-slate-600">{t("readOnly")}</p>
          )}
          <NotificationLockFields
            rows={
              data.canEdit
                ? (draft?.categories ?? data.categories)
                : data.categories
            }
            disabled={blocked}
            onChange={(choice) => {
              setAccepted(false);
              save.reset();
              setDraft((previous) => ({
                expectedCategories:
                  previous?.expectedCategories ??
                  data.categories.map(
                    ({ category, badgeLocked, emailLocked }) => ({
                      category,
                      badgeLocked,
                      emailLocked,
                    }),
                  ),
                categories: (previous?.categories ?? data.categories).map(
                  ({ category, badgeLocked, emailLocked }) =>
                    category === choice.category
                      ? choice
                      : { category, badgeLocked, emailLocked },
                ),
              }));
            }}
          />
          {data.canEdit && (
            <FormActions>
              <Button
                type="submit"
                variant="primary"
                disabled={blocked || !draft}
              >
                {t(busy ? "saving" : "save")}
              </Button>
              <Button
                disabled={busy || recovering || accepted}
                onClick={() => {
                  setDraft(null);
                  save.reset();
                }}
              >
                {ui("cancel")}
              </Button>
              {save.error && (
                <Button
                  disabled={busy || recovering || accepted}
                  onClick={() => void reload(true)}
                >
                  {t("reload")}
                </Button>
              )}
            </FormActions>
          )}
          {save.error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {save.error.message}
            </p>
          )}
        </form>
      )}
      {(accepted || save.isSuccess) && (
        <InlineNotice tone="success" announcement="status">
          {t("saved")}
        </InlineNotice>
      )}
      {refreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button disabled={recovering} onClick={() => void reload(accepted)}>
              {ui("retry")}
            </Button>
          }
        >
          {t(accepted ? "refreshFailed" : "loadFailed")}
        </InlineNotice>
      )}
    </div>
  );
}
