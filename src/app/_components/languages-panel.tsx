"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useDialog } from "./confirm-dialog";

/** Separate catalog administration from translator-only text editing and catalog creation. */
export function LanguagesPanel({ canAdd }: { canAdd: boolean }) {
  const t = useTranslations();
  const { confirm, dialog } = useDialog();
  const utils = api.useUtils();
  const languages = api.i18n.managedLanguages.useQuery();
  const canManage = api.i18n.canManageLanguages.useQuery();
  const list = languages.data ?? [];

  const invalidate = () =>
    Promise.all([
      utils.i18n.managedLanguages.invalidate(),
      utils.i18n.languages.invalidate(),
    ]);
  const add = api.i18n.addLanguage.useMutation({
    onSuccess: async () => {
      setCode("");
      setLabel("");
      await invalidate();
    },
  });
  const reorder = api.i18n.reorderLanguages.useMutation({
    onSuccess: invalidate,
  });
  const del = api.i18n.deleteLanguage.useMutation({ onSuccess: invalidate });
  const setEnabled = api.i18n.setLanguageEnabled.useMutation({
    onSuccess: invalidate,
  });

  const busy = reorder.isPending || del.isPending || setEnabled.isPending;

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  const move = (index: number, dir: -1 | 1) => {
    const next = [...list];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    reorder.mutate({ codes: next.map((l) => l.code) });
  };

  if (languages.isLoading || canManage.isLoading)
    return <p role="status">{t("translationEditor.loading")}</p>;
  if (languages.error || canManage.error)
    return <p role="alert">{(languages.error ?? canManage.error)?.message}</p>;

  return (
    <section className="card space-y-3 p-5">
      <h2 className="section-title">{t("localization.languagesHeading")}</h2>
      <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        {t("localization.languagesHelp")}
      </div>

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
            {canManage.data && (
              <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto">
                <button
                  type="button"
                  className="btn-secondary btn-sm min-w-11 lg:min-w-9"
                  disabled={l.code === "en" || busy}
                  onClick={() =>
                    setEnabled.mutate({ code: l.code, enabled: !l.enabled })
                  }
                >
                  {l.enabled
                    ? t("localization.disableLanguage")
                    : t("localization.enableLanguage")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm min-w-11 lg:min-w-9"
                  aria-label={t("localization.moveUp")}
                  disabled={i === 0 || busy}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm min-w-11 lg:min-w-9"
                  aria-label={t("localization.moveDown")}
                  disabled={i === list.length - 1 || busy}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                {!l.builtIn && (
                  <button
                    type="button"
                    className="link-danger text-xs"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: t("localization.confirmRemoveLanguage", {
                            label: l.label,
                          }),
                          confirmLabel: t("common.delete"),
                          cancelLabel: t("common.cancel"),
                          danger: true,
                        })
                      )
                        del.mutate({ code: l.code });
                    }}
                  >
                    {t("localization.removeLanguage")}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Adding catalogs remains an explicit translator capability. */}
      {canAdd && (
        <>
          <form
            className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim() && label.trim())
                add.mutate({ code: code.trim(), label: label.trim() });
            }}
          >
            <input
              className="input field-auto min-w-28"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label={t("localization.addLanguageCode")}
              placeholder={t("localization.addLanguageCode")}
            />
            <input
              className="input field-auto min-w-40"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-label={t("localization.addLanguageName")}
              placeholder={t("localization.addLanguageName")}
            />
            <button
              className="btn-secondary btn-sm"
              disabled={!code.trim() || !label.trim() || add.isPending}
            >
              {t("localization.addLanguageBtn")}
            </button>
          </form>
          <p className="muted text-xs">{t("localization.newLanguageHint")}</p>
        </>
      )}
      {add.error && <p className="text-sm text-red-600">{add.error.message}</p>}
      {(reorder.error ?? del.error ?? setEnabled.error) && (
        <p className="text-sm text-red-600">
          {(reorder.error ?? del.error ?? setEnabled.error)?.message}
        </p>
      )}
      {dialog}
    </section>
  );
}
