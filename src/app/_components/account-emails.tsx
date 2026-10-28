"use client";
import { CodeInput } from "~/app/_components/ui/code-field";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { QueryFeedback } from "./ui/query-feedback";
import { Button } from "./ui/button";
import { FormActions, InlineNotice, StatePanel } from "./ui/patterns";
import { useSessionAccessDenied } from "./session-view-state";
import {
  NotificationPreferenceFields,
  type NotificationPreferenceChoice,
} from "./notification-preference-fields";

/** One shared address manager for account and tutor settings. Passwords remain local to the form.
 * Form actions retain 44px touch targets; compact desktop address actions share 32px rows. */
export function AccountEmails() {
  const t = useTranslations("accountEmails");
  const utils = api.useUtils();
  const settings = api.account.emailSettings.useQuery();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = async () => {
    await Promise.all([
      utils.account.emailSettings.invalidate(),
      utils.account.me.invalidate(),
      utils.tutor.myProfile.invalidate(),
    ]);
  };
  const request = api.account.requestSecondaryEmail.useMutation({
    onSuccess: async (_, input) => {
      setSelected(input.email.trim().toLowerCase());
      setCode("");
      setEmail("");
      setPassword("");
      setNotice(t("sent"));
      await refresh();
    },
  });
  const confirm = api.account.confirmSecondaryEmail.useMutation({
    onSuccess: async () => {
      setSelected("");
      setCode("");
      setNotice(t("verifiedNotice"));
      await refresh();
    },
  });
  const manage = api.account.manageSecondaryEmail.useMutation({
    onSuccess: async () => {
      setPassword("");
      setSelected("");
      setCode("");
      setNotice(t("saved"));
      await refresh();
    },
  });
  const busy = request.isPending || confirm.isPending || manage.isPending;
  const error =
    request.error ?? confirm.error ?? manage.error ?? settings.error;
  const clear = () => {
    request.reset();
    confirm.reset();
    manage.reset();
    setNotice("");
  };
  const data = settings.data;

  return (
    <section
      className="card overflow-hidden"
      aria-labelledby="account-emails-heading"
    >
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
        <h2 id="account-emails-heading" className="section-title">
          {t("title")}
        </h2>
        <p className="muted mt-1 text-sm">{t("help")}</p>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        {settings.isLoading && <p className="muted">{t("loading")}</p>}
        {data && (
          <>
            <p className="muted text-sm">{t("optional")}</p>
            {!data.secondaryEmailBindingEnabled && (
              <p
                className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"
                role="status"
              >
                {t("bindingDisabled")}
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {data.emails.map((address) => (
                <li
                  key={address.email}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
                >
                  <div className="min-w-0 flex-1 basis-52">
                    <p className="text-sm font-medium break-all text-slate-900">
                      {address.email}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {address.email === data.email && (
                        <span className="badge-green">{t("primary")}</span>
                      )}
                      <span
                        className={
                          address.verifiedAt ? "badge-slate" : "badge-amber"
                        }
                      >
                        {t(address.verifiedAt ? "verified" : "pending")}
                      </span>
                    </div>
                  </div>
                  {address.email !== data.email && (
                    <div className="flex flex-wrap gap-2">
                      {address.verifiedAt ? (
                        <button
                          type="button"
                          className="btn-secondary min-h-11 text-xs lg:min-h-8"
                          disabled={busy || !password}
                          onClick={() => {
                            clear();
                            manage.mutate({
                              email: address.email,
                              currentPassword: password,
                              action: "primary",
                            });
                          }}
                        >
                          {t("makePrimary")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary min-h-11 text-xs lg:min-h-8"
                          disabled={busy || !data.secondaryEmailBindingEnabled}
                          onClick={() => {
                            clear();
                            setSelected(address.email);
                            setCode("");
                          }}
                        >
                          {t("verify")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary min-h-11 text-xs lg:min-h-8"
                        disabled={busy || !password}
                        onClick={() => {
                          clear();
                          manage.mutate({
                            email: address.email,
                            currentPassword: password,
                            action: "remove",
                          });
                        }}
                      >
                        {t(address.verifiedAt ? "remove" : "cancel")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {(data.secondaryEmailBindingEnabled ||
              data.emails.some((address) => address.email !== data.email)) && (
              <label className="block space-y-1 border-t border-slate-100 pt-4">
                <span className="label">{t("password")}</span>
                <input
                  type="password"
                  aria-label={t("password")}
                  aria-describedby="associated-email-password-help"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input min-h-11 lg:min-h-10"
                />
                <span
                  id="associated-email-password-help"
                  className="muted block text-xs"
                >
                  {t("passwordHelp")}
                </span>
              </label>
            )}
            {!data.deliveryAvailable && (
              <p className="text-sm text-amber-800">{t("unavailable")}</p>
            )}
            {data.secondaryEmailBindingEnabled && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  clear();
                  request.mutate({ email, currentPassword: password });
                }}
              >
                <label className="block space-y-1">
                  <span className="label">{t("addLabel")}</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={254}
                    required
                    className="input min-h-11 lg:min-h-10"
                  />
                </label>
                <button
                  className="btn-primary min-h-11 lg:min-h-10"
                  disabled={
                    busy ||
                    !password ||
                    !email.trim() ||
                    !data.deliveryAvailable ||
                    data.emails.length >= 6
                  }
                >
                  {t(busy ? "working" : "add")}
                </button>
                <p className="muted text-xs">{t("limit")}</p>
              </form>
            )}
            {selected && data.secondaryEmailBindingEnabled && (
              <form
                className="border-accent-200 bg-accent-50/50 space-y-3 rounded-lg border p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  clear();
                  confirm.mutate({ email: selected, code });
                }}
              >
                <p className="text-sm font-medium break-all">
                  {t("verifyAddress", { email: selected })}
                </p>
                <CodeInput
                  purpose="email"
                  value={code}
                  onValueChange={setCode}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "account-emails-error" : undefined}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-primary min-h-11 lg:min-h-10"
                    disabled={busy || !code.trim()}
                  >
                    {t("verify")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary min-h-11 lg:min-h-10"
                    disabled={busy || !password || !data.deliveryAvailable}
                    onClick={() => {
                      clear();
                      request.mutate({
                        email: selected,
                        currentPassword: password,
                      });
                    }}
                  >
                    {t("resend")}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        {notice && (
          <p role="status" className="text-sm text-green-700">
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            id="account-emails-error"
            className="text-sm text-red-700"
          >
            {error.message}
          </p>
        )}
      </div>
    </section>
  );
}

type PreferenceDraft = {
  categories: NotificationPreferenceChoice[];
  emailSecondaryRecipients: boolean;
};

/** A dirty draft owns its choices. Background reads can change availability,
 * but only Cancel or a successful post-save read replaces the draft. */
export function EmailPreferences() {
  const t = useTranslations("notificationPreferences");
  const emailText = useTranslations("emailPreferences");
  const recovery = useTranslations("participantRecovery");
  const ui = useTranslations("uiPatterns");
  const settings = api.account.notificationPreferences.useQuery();
  const utils = api.useUtils();
  const denied = useSessionAccessDenied(settings);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<PreferenceDraft | null>(null);
  const [committed, setCommitted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const admitted = useRef(false);
  const refreshSaved = async () => {
    setRefreshing(true);
    try {
      const result = await settings.refetch({ throwOnError: true });
      if (!result.data || !result.isSuccess)
        throw new Error("Preference refresh failed");
      setDraft(null);
      setCommitted(false);
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  };
  const save = api.account.setNotificationPreferences.useMutation({
    onSuccess: async () => {
      setSaved(true);
      setCommitted(true);
      void Promise.allSettled([
        utils.notification.unreadCount.invalidate(),
        utils.notification.list.invalidate(),
      ]);
      await refreshSaved();
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const retry = () => {
    if (committed) void refreshSaved();
    else void settings.refetch();
  };
  const feedback = (
    <QueryFeedback
      hasData={!!settings.data}
      loading={!settings.data && !settings.error}
      error={!!settings.error && !committed}
      retrying={settings.isFetching}
      loadingTitle={recovery("loading")}
      errorTitle={recovery(settings.data ? "refreshFailed" : "loadFailed")}
      retryLabel={ui("retry")}
      onRetry={retry}
    />
  );
  if (denied)
    return (
      <StatePanel
        kind="denied"
        title={recovery("accessDenied")}
        action={
          <Button onClick={retry} disabled={settings.isFetching || refreshing}>
            {ui("retry")}
          </Button>
        }
      />
    );
  if (!settings.data) return feedback;
  const data = settings.data;
  const preferences = draft ?? {
    categories: data.categories.map(
      ({ category, badgeEnabled, emailEnabled }) => ({
        category,
        badgeEnabled,
        emailEnabled,
      }),
    ),
    emailSecondaryRecipients: data.emailSecondaryRecipients,
  };
  const blocked = !!settings.error || save.isPending || committed || refreshing;
  return (
    <section
      id="notification-preferences"
      className="card scroll-mt-24 space-y-4 p-5 sm:p-6"
    >
      <div>
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-1 text-sm">{t("help")}</p>
      </div>
      {feedback}
      {!data.emailEnabled && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          {t("disabled")}
        </p>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked || admitted.current) return;
          admitted.current = true;
          setDraft(preferences);
          // A gate/role change must not enable an email choice retained in an
          // older draft. Badge changes remain available with email disabled.
          save.mutate({
            categories: data.categories.map((row) => {
              const choice =
                preferences.categories.find(
                  (item) => item.category === row.category,
                ) ?? row;
              return {
                category: row.category,
                badgeEnabled: row.badgeAvailable
                  ? choice.badgeEnabled
                  : row.badgeEnabled,
                emailEnabled: row.emailEditable
                  ? choice.emailEnabled
                  : row.emailEnabled,
              };
            }),
            ...(data.emailEnabled
              ? {
                  emailSecondaryRecipients:
                    preferences.emailSecondaryRecipients,
                }
              : {}),
          });
        }}
      >
        <fieldset
          disabled={blocked}
          className="divide-y divide-slate-100 disabled:opacity-60"
        >
          <NotificationPreferenceFields
            rows={data.categories}
            choices={preferences.categories}
            disabled={blocked}
            onChange={(choice) => {
              setSaved(false);
              setDraft({
                ...preferences,
                categories: preferences.categories.map((row) =>
                  row.category === choice.category ? choice : row,
                ),
              });
            }}
          />
          <label className="flex min-h-11 items-start gap-3 py-3">
            <input
              type="checkbox"
              className="accent-accent-600 mt-1 h-4 w-4 shrink-0"
              disabled={!data.emailEnabled}
              checked={
                data.emailEnabled
                  ? preferences.emailSecondaryRecipients
                  : data.emailSecondaryRecipients
              }
              onChange={(event) => {
                setSaved(false);
                setDraft({
                  ...preferences,
                  emailSecondaryRecipients: event.target.checked,
                });
              }}
            />
            <span>
              <span className="block text-sm font-medium">
                {emailText("emailSecondaryRecipients")}
              </span>
              <span className="block text-xs text-slate-600">
                {emailText("emailSecondaryRecipientsHelp")}
              </span>
            </span>
          </label>
        </fieldset>
        <p className="muted text-xs">{t("essential")}</p>
        <FormActions>
          <button
            className="btn-primary min-h-11 lg:min-h-10"
            disabled={blocked}
          >
            {t(save.isPending ? "saving" : "save")}
          </button>
          <Button
            disabled={blocked}
            onClick={() => {
              setDraft(null);
              setSaved(false);
            }}
          >
            {ui("cancel")}
          </Button>
        </FormActions>
        {save.error && (
          <p role="alert" className="text-sm text-red-700">
            {save.error.message}
          </p>
        )}
      </form>
      {saved && (
        <p role="status" className="text-sm text-green-700">
          {t("saved")}
        </p>
      )}
      {refreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button disabled={refreshing} onClick={() => void refreshSaved()}>
              {ui("retry")}
            </Button>
          }
        >
          {recovery("refreshFailed")}
        </InlineNotice>
      )}
    </section>
  );
}
