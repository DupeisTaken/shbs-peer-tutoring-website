"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DisclosureIcon } from "~/app/_components/icons";
import { translationAccess } from "~/lib/translation-access";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { FilterToolbar, InlineNotice } from "~/app/_components/ui/patterns";
import { Button, ChoiceButton } from "~/app/_components/ui/button";

type StringRowData = {
  key: string;
  en: string;
  base: string;
  override: string | null;
  refs?: { locale: string; value: string }[];
};

type StringDraft = {
  value?: string;
  submitted?: string | null;
  pending?: boolean;
  error?: string | null;
  success?: boolean;
  refreshFailed?: boolean;
};

// Safety cap on how many rows one expanded group renders at once (most groups are far smaller).
const MAX_ROWS_PER_GROUP = 300;

/** One editable string: seeded from its current value, saved on blur when changed. */
function StringRow({
  locale,
  item,
  labelFor,
  onSaved,
  canPublish,
  draft,
  onDraftChange,
  saveHelpId,
}: {
  locale: string;
  item: StringRowData;
  labelFor: (code: string) => string;
  onSaved: () => Promise<unknown> | void;
  canPublish: boolean;
  draft: StringDraft | undefined;
  onDraftChange: (update: Partial<StringDraft>) => void;
  saveHelpId: string;
}) {
  const t = useTranslations();
  const current = item.override ?? item.base;
  const value = draft?.value ?? current;
  const submitted = draft?.submitted ?? null;
  const admitted = useRef(false);
  const refreshSaved = async () => {
    onDraftChange({ pending: true });
    try {
      await onSaved();
      onDraftChange({ refreshFailed: false });
    } catch {
      onDraftChange({ refreshFailed: true });
    } finally {
      onDraftChange({ pending: false });
    }
  };
  const setString = api.localization.setString.useMutation({
    onSuccess: async (_result, input) => {
      onDraftChange({ submitted: input.value || item.base, success: true });
      await refreshSaved();
    },
    onError: (error) => onDraftChange({ error: error.message }),
    onSettled: () => {
      admitted.current = false;
      onDraftChange({ pending: false });
    },
  });
  const pending = !!draft?.pending || setString.isPending;
  const submit = (nextValue: string) => {
    if (pending || admitted.current || draft?.refreshFailed) return;
    admitted.current = true;
    onDraftChange({ pending: true, error: null, success: false });
    setString.mutate({ locale, key: item.key, value: nextValue });
  };

  const overridden = item.override !== null;

  return (
    <div className="border-b border-slate-100 py-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-[11px] text-slate-600">{item.key}</code>
        {overridden && (
          <span className="badge-amber">{t("localization.overridden")}</span>
        )}
        {draft?.success && (
          <span className="text-xs text-green-600">
            {t(
              canPublish
                ? "translationEditor.published"
                : "translationEditor.submitted",
            )}
          </span>
        )}
        {overridden && (
          <button
            type="button"
            className="link control-compact inline-flex items-center text-xs"
            disabled={pending || draft?.refreshFailed}
            onClick={() => {
              onDraftChange({ value: item.base });
              submit("");
            }}
          >
            {t("localization.reset")}
          </button>
        )}
      </div>
      <p className="muted mt-0.5 text-xs">
        <span className="font-medium">{t("localization.english")}:</span>{" "}
        {item.en}
      </p>
      {item.refs?.map((r) => (
        <p key={r.locale} className="muted text-xs">
          <span className="font-medium">{labelFor(r.locale)}:</span> {r.value}
        </p>
      ))}
      <textarea
        className="textarea mt-1 w-full text-sm"
        rows={2}
        value={value}
        disabled={pending || draft?.refreshFailed}
        lang={locale}
        aria-label={item.key}
        aria-describedby={saveHelpId}
        onChange={(e) =>
          onDraftChange({ value: e.target.value, success: false })
        }
        onBlur={() => {
          if (value !== current && value !== submitted) submit(value);
        }}
      />
      {draft?.error && (
        <p role="alert" className="text-xs text-red-600">
          {draft.error}
        </p>
      )}
      {draft?.refreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button
              size="compact"
              disabled={pending}
              onClick={() => void refreshSaved()}
            >
              {t("uiPatterns.retry")}
            </Button>
          }
        >
          {t("translationEditor.refreshFailed")}
        </InlineNotice>
      )}
    </div>
  );
}

export function TranslationStrings() {
  const t = useTranslations();
  const scopeId = useId();
  const saveHelpId = `${scopeId}-save-help`;
  const me = api.account.me.useQuery();
  const access = translationAccess(me.data);
  const displayLocale = useLocale();
  const utils = api.useUtils();
  const languages = api.i18n.managedLanguages.useQuery();
  const [locale, setLocale] = useState<string>(displayLocale);
  const [refLocales, setRefLocales] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Cache only interacted-with row state, not thousands of hidden DOM nodes.
  // Locale/key ownership survives namespace collapse, search and language changes;
  // the authorized feature owner releases this memory when it unmounts.
  const [drafts, setDrafts] = useState<Record<string, StringDraft>>({});
  const draftKey = (language: string, key: string) =>
    JSON.stringify([language, key]);

  const langOptions = useMemo(() => languages.data ?? [], [languages.data]);
  const labelFor = (code: string) =>
    langOptions.find((l) => l.code === code)?.label ?? code;
  // If the chosen language disappears (removed), fall back to the display locale.
  useEffect(() => {
    if (langOptions.length > 0 && !langOptions.some((l) => l.code === locale)) {
      setLocale(displayLocale);
    }
  }, [langOptions, locale, displayLocale]);

  const strings = api.localization.strings.useQuery({ locale, refLocales });
  const all = useMemo(() => strings.data ?? [], [strings.data]);
  const needle = q.trim().toLowerCase();

  // Group keys by their top-level namespace (the part before the first dot).
  const groups = useMemo(() => {
    const m = new Map<string, StringRowData[]>();
    for (const s of all) {
      const ns = s.key.split(".")[0] ?? "";
      const arr = m.get(ns);
      if (arr) arr.push(s);
      else m.set(ns, [s]);
    }
    return [...m.entries()].map(([ns, rows]) => ({ ns, rows }));
  }, [all]);

  const view = useMemo(() => {
    return groups
      .map(({ ns, rows }) => {
        const shownRows = needle
          ? rows.filter(
              (s) =>
                s.key.toLowerCase().includes(needle) ||
                s.en.toLowerCase().includes(needle) ||
                (s.override ?? s.base).toLowerCase().includes(needle),
            )
          : rows;
        return { ns, rows, shownRows };
      })
      .filter((g) => !needle || g.shownRows.length > 0);
  }, [groups, needle]);

  const totalShown = view.reduce((n, g) => n + g.shownRows.length, 0);
  const onSaved = () =>
    settleRefreshes([
      () => invalidateAndReport(utils.localization.strings),
      () => invalidateAndReport(utils.translationReview.list),
    ]);

  const toggle = (ns: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns);
      else next.add(ns);
      return next;
    });

  return (
    <div className="space-y-5">
      <div>
        <p className="muted">{t("localization.subtitle")}</p>
        <p id={saveHelpId} className="muted mt-2 text-sm">
          {t("saveBoundary.blur")}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="label">{t("localization.targetLanguage")}</span>
          <select
            className="select field-auto min-w-40"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            {langOptions.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
                {!l.enabled ? ` — ${t("localization.disabled")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 space-y-1 text-sm">
          <span className="label">{t("localization.searchLabel")}</span>
          <input
            className="input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("localization.search")}
          />
        </label>
      </div>

      {/* Optional reference languages: shown (read-only) under English in every row. */}
      {langOptions.some((l) => l.code !== locale && l.code !== "en") && (
        <FilterToolbar label={t("localization.reference")}>
          <span className="label">{t("localization.reference")}</span>
          {langOptions
            .filter((l) => l.code !== locale && l.code !== "en")
            .map((l) => {
              const on = refLocales.includes(l.code);
              return (
                <ChoiceButton
                  key={l.code}
                  selected={on}
                  onClick={() =>
                    setRefLocales((prev) =>
                      on ? prev.filter((c) => c !== l.code) : [...prev, l.code],
                    )
                  }
                >
                  {l.label}
                </ChoiceButton>
              );
            })}
        </FilterToolbar>
      )}

      {strings.error && <p role="alert">{strings.error.message}</p>}
      {strings.isLoading ? (
        <p className="muted">{t("localization.loading")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="muted text-xs">
              {t("localization.count", {
                shown: totalShown,
                total: all.length,
              })}
            </p>
            {!needle && (
              <div className="flex gap-3">
                <button
                  type="button"
                  className="link control-compact inline-flex items-center text-xs"
                  onClick={() => setExpanded(new Set(groups.map((g) => g.ns)))}
                >
                  {t("localization.expandAll")}
                </button>
                <button
                  type="button"
                  className="link control-compact inline-flex items-center text-xs"
                  onClick={() => setExpanded(new Set())}
                >
                  {t("localization.collapseAll")}
                </button>
              </div>
            )}
          </div>

          {view.length === 0 && (
            <p className="muted">{t("localization.empty")}</p>
          )}

          <div className="space-y-3">
            {view.map(({ ns, rows, shownRows }) => {
              const open = !!needle || expanded.has(ns);
              const edited = rows.filter((r) => r.override !== null).length;
              const panelId = `${scopeId}-namespace-${encodeURIComponent(ns)}`;
              return (
                <div key={ns} className="card overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50"
                    onClick={() => {
                      if (!needle) toggle(ns);
                    }}
                  >
                    <DisclosureIcon open={open} />
                    <span className="font-semibold text-slate-900">
                      {ns.charAt(0).toUpperCase() + ns.slice(1)}
                    </span>
                    <span className="muted text-xs">
                      {needle
                        ? `${shownRows.length} / ${rows.length}`
                        : rows.length}{" "}
                      {t("localization.keysLabel")}
                      {edited > 0
                        ? ` · ${edited} ${t("localization.overridden")}`
                        : ""}
                    </span>
                  </button>
                  {open && (
                    <div
                      id={panelId}
                      className="border-t border-slate-100 px-4 pb-1"
                    >
                      {shownRows.slice(0, MAX_ROWS_PER_GROUP).map((item) => (
                        <StringRow
                          key={`${locale}:${item.key}`}
                          locale={locale}
                          item={item}
                          labelFor={labelFor}
                          onSaved={onSaved}
                          canPublish={access.publish}
                          saveHelpId={saveHelpId}
                          draft={drafts[draftKey(locale, item.key)]}
                          onDraftChange={(update) => {
                            const key = draftKey(locale, item.key);
                            setDrafts((previous) => ({
                              ...previous,
                              [key]: { ...previous[key], ...update },
                            }));
                          }}
                        />
                      ))}
                      {shownRows.length > MAX_ROWS_PER_GROUP && (
                        <p className="muted py-2 text-xs">
                          {t("localization.tooMany", {
                            max: MAX_ROWS_PER_GROUP,
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
