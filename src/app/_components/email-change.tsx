"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getQueryKey } from "@trpc/react-query";
import { api } from "~/trpc/react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { CodeInput } from "./ui/code-field";
import { Button } from "./ui/button";
import { FormActions, InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { useSessionAccessDenied } from "./session-view-state";

/** Primary replacement stays independent of optional alias binding. The server
 * owns password checks, destination ownership, mailbox proof and identity sync. */
export function EmailChange({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("emailChange");
  const recovery = useTranslations("participantRecovery");
  const ui = useTranslations("uiPatterns");
  const utils = api.useUtils();
  const settings = api.account.emailSettings.useQuery();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const admitted = useRef(false);
  const accepted = useRef(false);
  const refreshPending = useRef(false);

  const refreshSaved = async () => {
    if (refreshPending.current) return;
    refreshPending.current = true;
    setRefreshing(true);
    try {
      await settleRefreshes([
        async () => {
          const result = await settings.refetch({
            throwOnError: true,
            cancelRefetch: true,
          });
          if (!result.isSuccess || !result.data)
            throw new Error("Account email refresh failed");
        },
        () => invalidateAndReport(utils.account.me),
        () => invalidateAndReport(utils.tutor.myProfile),
      ]);
      setEmail("");
      setCode("");
      setDestination(null);
      request.reset();
      confirm.reset();
      setCommitted(false);
      accepted.current = false;
      setRefreshFailed(false);
    } catch {
      // A consumed code must never be resubmitted to recover a saved change.
      setRefreshFailed(true);
    } finally {
      refreshPending.current = false;
      setRefreshing(false);
    }
  };
  const request = api.account.requestEmailChange.useMutation({
    onSuccess: (_, input) => {
      setDestination(input.email.trim().toLowerCase());
      setPassword("");
      setCode("");
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const confirm = api.account.confirmEmailChange.useMutation({
    onSuccess: async () => {
      accepted.current = true;
      setCommitted(true);
      setSaved(true);
      setPassword("");
      await refreshSaved();
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const denied = useSessionAccessDenied(
    {
      ...settings,
      denialKey: "primary-email-settings",
      queryKey: getQueryKey(api.account.emailSettings, undefined, "query"),
    },
    {
      error: request.error ?? confirm.error,
      isSuccess: !request.error && !confirm.error,
      isFetching: refreshing,
    },
  );
  const busy = request.isPending || confirm.isPending;
  const blocked =
    denied ||
    !settings.data ||
    !!settings.error ||
    settings.isFetching ||
    busy ||
    committed ||
    refreshing;
  const retry = () => {
    if (busy || admitted.current) return;
    if (accepted.current) void refreshSaved();
    else if (!refreshPending.current) {
      refreshPending.current = true;
      setRefreshing(true);
      void settings
        .refetch({ throwOnError: true, cancelRefetch: true })
        .then((result) => {
          if (!result.isSuccess || !result.data) return;
          // Mutation access failures remain concealed until a fresh settings read
          // authorizes this account again; a transport failure cannot release them.
          request.reset();
          confirm.reset();
        })
        .catch(() => undefined)
        .finally(() => {
          refreshPending.current = false;
          setRefreshing(false);
        });
    }
  };

  if (denied)
    return (
      <StatePanel
        kind="denied"
        title={recovery("accessDenied")}
        action={
          <Button
            disabled={settings.isFetching || refreshing || busy}
            onClick={retry}
          >
            {ui("retry")}
          </Button>
        }
      />
    );

  return (
    <section
      aria-label={t("title")}
      className={embedded ? "space-y-3" : "card space-y-3 p-5 sm:p-6"}
    >
      {!embedded && <h2 className="section-title">{t("title")}</h2>}
      <p className="muted text-sm">{t("help")}</p>
      <QueryFeedback
        hasData={!!settings.data}
        loading={!settings.data && !settings.error}
        error={!!settings.error && !committed}
        retrying={settings.isFetching || refreshing || busy}
        loadingTitle={recovery("loading")}
        errorTitle={recovery(settings.data ? "refreshFailed" : "loadFailed")}
        retryLabel={ui("retry")}
        onRetry={retry}
      />
      {settings.data && (
        <>
          {!settings.data.deliveryAvailable && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {t("unavailable")}
            </p>
          )}
          {!destination ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  blocked ||
                  admitted.current ||
                  refreshPending.current ||
                  accepted.current ||
                  !settings.data?.deliveryAvailable ||
                  !email.trim() ||
                  !password
                )
                  return;
                admitted.current = true;
                setSaved(false);
                confirm.reset();
                request.mutate({
                  email: email.trim(),
                  currentPassword: password,
                });
              }}
            >
              <fieldset
                disabled={blocked}
                className="space-y-3 disabled:opacity-60"
              >
                <label className="block space-y-1">
                  <span className="label">{t("email")}</span>
                  <input
                    className="input min-h-11 lg:min-h-10"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="label">{t("password")}</span>
                  <input
                    className="input min-h-11 lg:min-h-10"
                    type="password"
                    autoComplete="current-password"
                    maxLength={1024}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <FormActions>
                  <button
                    className="btn-primary min-h-11 lg:min-h-10"
                    disabled={
                      !settings.data.deliveryAvailable ||
                      !email.trim() ||
                      !password
                    }
                  >
                    {t("send")}
                  </button>
                </FormActions>
              </fieldset>
            </form>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  blocked ||
                  admitted.current ||
                  refreshPending.current ||
                  accepted.current ||
                  !code.trim()
                )
                  return;
                admitted.current = true;
                confirm.mutate({ code });
              }}
            >
              {/* Confirmation consumes the server's latest challenge, so its
               * displayed destination cannot follow an editable email draft. */}
              <p className="text-sm break-all">
                {t("sentTo", { email: destination })}
              </p>
              <fieldset
                disabled={blocked}
                className="space-y-3 disabled:opacity-60"
              >
                <CodeInput
                  purpose="email"
                  value={code}
                  onValueChange={setCode}
                  aria-invalid={Boolean(confirm.error)}
                  aria-describedby={
                    confirm.error ? "email-change-error" : undefined
                  }
                />
                <FormActions>
                  <button
                    className="btn-primary min-h-11 lg:min-h-10"
                    disabled={!code.trim()}
                  >
                    {t("confirm")}
                  </button>
                  <Button
                    onClick={() => {
                      if (blocked || admitted.current || accepted.current)
                        return;
                      setDestination(null);
                      setCode("");
                      request.reset();
                      confirm.reset();
                    }}
                  >
                    {t("changeAddress")}
                  </Button>
                </FormActions>
              </fieldset>
            </form>
          )}
        </>
      )}
      {(request.error ?? confirm.error) && !committed && (
        <p
          role="alert"
          id="email-change-error"
          className="text-sm text-red-700"
        >
          {request.error?.message ?? confirm.error?.message}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-green-700">
          {t("success")}
        </p>
      )}
      {refreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button disabled={refreshing || busy} onClick={retry}>
              {ui("retry")}
            </Button>
          }
        >
          {t("savedRefreshFailed")}
        </InlineNotice>
      )}
    </section>
  );
}
