"use client";

import { InlineNotice } from "./ui/patterns";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useDialog } from "./confirm-dialog";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { useSessionAccessDenied } from "./session-view-state";
import { translationAccess } from "~/lib/translation-access";

/** This lifetime ends on catalogue denial, settling any open confirmation as cancelled. */
function LanguageRemoval({
  label,
  disabled,
  onRemove,
}: {
  label: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations();
  const { confirm, dialog } = useDialog();
  return (
    <>
      <button
        type="button"
        className="link-danger control-compact text-xs"
        disabled={disabled}
        onClick={async () => {
          if (disabled) return;
          if (
            await confirm({
              title: t("localization.confirmRemoveLanguage", { label }),
              confirmLabel: t("common.delete"),
              cancelLabel: t("common.cancel"),
              danger: true,
            })
          )
            onRemove();
        }}
      >
        {t("localization.removeLanguage")}
      </button>
      {dialog}
    </>
  );
}

/** Separate catalog administration from translator-only text editing and catalog creation. */
export function LanguagesPanel({
  canAdd,
  concealed = false,
}: {
  canAdd: boolean;
  concealed?: boolean;
}) {
  const t = useTranslations();
  const identity = api.account.me.useQuery();
  const eligible =
    !identity.error &&
    ["HEAD", "ADMIN", "COORDINATOR"].includes(identity.data?.role ?? "");
  const utils = api.useUtils();
  const languages = api.i18n.managedLanguages.useQuery(undefined, {
    enabled: !concealed,
  });
  const canManage = api.i18n.canManageLanguages.useQuery(undefined, {
    enabled: !concealed,
  });
  const list = languages.data ?? [];
  const [refreshError, setRefreshError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const admission = useRef(false);
  const synchronizationAllowed = useRef(false);
  const ownerActive = useRef(false);
  useEffect(() => {
    ownerActive.current = true;
    return () => {
      ownerActive.current = false;
    };
  }, []);
  const settled = () => {
    admission.current = false;
  };

  const invalidate = async () => {
    setRefreshing(true);
    try {
      if (!ownerActive.current || !synchronizationAllowed.current)
        throw new Error(t("localization.languagesReadFailed"));
      await settleRefreshes([
        () => invalidateAndReport(utils.i18n.managedLanguages),
        () => invalidateAndReport(utils.i18n.languages),
        async () => {
          await canManage.refetch({ throwOnError: true });
        },
        async () => {
          await identity.refetch({ throwOnError: true });
        },
      ]);
      setRefreshError(null);
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      setRefreshing(false);
    }
  };
  const add = api.i18n.addLanguage.useMutation({
    onSettled: settled,
    onSuccess: async () => {
      setCode("");
      setLabel("");
      await invalidate();
    },
  });
  const reorder = api.i18n.reorderLanguages.useMutation({
    onSuccess: invalidate,
    onSettled: settled,
  });
  const del = api.i18n.deleteLanguage.useMutation({
    onSuccess: invalidate,
    onSettled: settled,
  });
  const setEnabled = api.i18n.setLanguageEnabled.useMutation({
    onSuccess: invalidate,
    onSettled: settled,
  });

  const missingRead = [languages, canManage, identity].some(
    (query) => query.isSuccess && query.data == null,
  );
  const readError =
    languages.error ??
    canManage.error ??
    identity.error ??
    (missingRead ? new Error(t("localization.languagesReadFailed")) : null);
  const denied = useSessionAccessDenied(
    ...[languages, canManage, identity].map((query) => ({
      ...query,
      isSuccess: query.isSuccess && query.data != null,
    })),
  );
  useLayoutEffect(() => {
    synchronizationAllowed.current =
      !concealed && !denied && translationAccess(identity.data).enter;
  }, [concealed, denied, identity.data]);
  const busy =
    concealed ||
    add.isPending ||
    reorder.isPending ||
    del.isPending ||
    setEnabled.isPending ||
    refreshing ||
    !!readError ||
    !!refreshError ||
    languages.isLoading ||
    canManage.isLoading ||
    identity.isLoading ||
    !languages.data ||
    canManage.data === undefined ||
    !identity.data;
  const canRemove = useRef<(code: string) => boolean>(() => false);
  useLayoutEffect(() => {
    // Deferred confirmations consult only the latest committed authority.
    canRemove.current = (code) =>
      ownerActive.current &&
      !busy &&
      !denied &&
      eligible &&
      canManage.data === true &&
      !!languages.data?.some(
        (language) => language.code === code && !language.builtIn,
      );
  }, [busy, denied, eligible, canManage.data, languages.data]);

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  const move = (index: number, dir: -1 | 1) => {
    const next = [...list];
    const j = index + dir;
    if (
      !ownerActive.current ||
      !eligible ||
      busy ||
      admission.current ||
      j < 0 ||
      j >= next.length
    )
      return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    admission.current = true;
    reorder.mutate({ codes: next.map((l) => l.code) });
  };
  const retryRead = () => {
    if (!ownerActive.current || refreshing || admission.current) return;
    if (refreshError && !denied) {
      void invalidate();
      return;
    }
    setRefreshing(true);
    void settleRefreshes([
      async () => {
        await languages.refetch();
      },
      async () => {
        await canManage.refetch();
      },
      async () => {
        await identity.refetch();
      },
    ])
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  if (concealed) return null;
  if (denied)
    return (
      <div className="space-y-2">
        <p role="alert">{t("translationEditor.noAccess")}</p>
        <button
          type="button"
          className="btn-secondary"
          disabled={refreshing}
          onClick={retryRead}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  if (!languages.data && (languages.isLoading || canManage.isLoading))
    return <p role="status">{t("translationEditor.loading")}</p>;

  return (
    <section className="card space-y-3 p-5">
      <h2 className="section-title">{t("localization.languagesHeading")}</h2>
      {(readError ?? refreshError) && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-700">
            {(readError ?? refreshError)?.message}
          </p>
          <p className="text-sm">{t("localization.languagesReadFailed")}</p>
          <button
            type="button"
            className="btn-secondary"
            disabled={refreshing}
            onClick={retryRead}
          >
            {t("common.retry")}
          </button>
        </div>
      )}
      <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        {t("localization.languagesHelp")}
      </div>

      <p className="muted text-sm">{t("approvals.sensitiveHelp")}</p>
      <ul className="divide-y divide-slate-100">
        {list.map((l, i) => (
          <li
            key={l.code}
            className="flex min-h-11 flex-wrap items-center gap-2 py-2"
          >
            <span className="font-medium text-slate-800">{l.label}</span>
            <code className="text-xs text-slate-400">{l.code}</code>
            {l.builtIn && (
              <span className="badge-slate">{t("localization.builtIn")}</span>
            )}
            <span
              className={
                l.enabled
                  ? "badge bg-emerald-50 text-emerald-700"
                  : "badge bg-slate-100 text-slate-500"
              }
            >
              {l.enabled
                ? t("localization.enabled")
                : t("localization.disabled")}
            </span>
            {l.code === "en" && (
              <span className="text-xs text-slate-400">
                {t("localization.required")}
              </span>
            )}
            {canManage.data && eligible && (
              <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto">
                <button
                  type="button"
                  className="btn-secondary control-compact min-w-11 lg:min-w-9"
                  disabled={l.code === "en" || busy}
                  onClick={() => {
                    if (!ownerActive.current || busy || admission.current)
                      return;
                    admission.current = true;
                    setEnabled.mutate({ code: l.code, enabled: !l.enabled });
                  }}
                >
                  {l.enabled
                    ? t("localization.disableLanguage")
                    : t("localization.enableLanguage")}
                </button>
                <button
                  type="button"
                  className="btn-secondary control-compact min-w-11 lg:min-w-9"
                  aria-label={t("localization.moveUp")}
                  disabled={i === 0 || busy}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-secondary control-compact min-w-11 lg:min-w-9"
                  aria-label={t("localization.moveDown")}
                  disabled={i === list.length - 1 || busy}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                {!l.builtIn && (
                  <LanguageRemoval
                    label={l.label}
                    disabled={busy}
                    onRemove={() => {
                      // Confirmation can outlive the render that opened it.
                      if (!canRemove.current(l.code) || admission.current)
                        return;
                      admission.current = true;
                      del.mutate({ code: l.code });
                    }}
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Adding catalogs remains an explicit translator capability. */}
      {canAdd && translationAccess(identity.data).edit && (
        <>
          <form
            className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                ownerActive.current &&
                !busy &&
                !admission.current &&
                code.trim() &&
                label.trim()
              ) {
                admission.current = true;
                add.mutate({ code: code.trim(), label: label.trim() });
              }
            }}
          >
            {/* Names stay visible after typing; the row aligns the actual input boxes. */}
            <label className="block w-36 max-w-full space-y-1">
              <span className="label">{t("localization.addLanguageCode")}</span>
              <input
                className="input lg:min-h-10"
                value={code}
                disabled={busy}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <label className="block w-56 max-w-full space-y-1">
              <span className="label">{t("localization.addLanguageName")}</span>
              <input
                className="input lg:min-h-10"
                value={label}
                disabled={busy}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <button
              className="btn-secondary control-standard"
              disabled={!code.trim() || !label.trim() || busy}
            >
              {t("localization.addLanguageBtn")}
            </button>
          </form>
          <p className="muted text-xs">{t("localization.newLanguageHint")}</p>
        </>
      )}
      {[add.error, reorder.error, del.error, setEnabled.error].some(
        (error) => error?.data?.approvalId,
      ) && (
        <InlineNotice tone="warning" announcement="status">
          {t("approvals.queuedBody")}
        </InlineNotice>
      )}
      {add.error && !add.error.data?.approvalId && (
        <p className="text-sm text-red-600">{add.error.message}</p>
      )}
      {[reorder.error, del.error, setEnabled.error].find(
        (error) => error && !error.data?.approvalId,
      ) && (
        <p className="text-sm text-red-600">
          {
            [reorder.error, del.error, setEnabled.error].find(
              (error) => error && !error.data?.approvalId,
            )?.message
          }
        </p>
      )}
    </section>
  );
}
