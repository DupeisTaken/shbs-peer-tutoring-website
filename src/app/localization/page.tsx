"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { LOCALES, LOCALE_LABELS } from "~/i18n/config";
import { DisclosureIcon } from "~/app/_components/icons";

type Locale = (typeof LOCALES)[number];
type StringRowData = { key: string; en: string; base: string; override: string | null };

// Safety cap on how many rows one expanded group renders at once (most groups are far smaller).
const MAX_ROWS_PER_GROUP = 300;

/** One editable string: seeded from its current value, saved on blur when changed. */
function StringRow({
  locale,
  item,
  onSaved,
}: {
  locale: Locale;
  item: StringRowData;
  onSaved: () => Promise<unknown> | void;
}) {
  const t = useTranslations();
  const current = item.override ?? item.base;
  const [value, setValue] = useState(current);
  const setString = api.localization.setString.useMutation({ onSuccess: () => onSaved() });

  const overridden = item.override !== null;

  return (
    <div className="border-b border-slate-100 py-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-[11px] text-slate-400">{item.key}</code>
        {overridden && <span className="badge-amber">{t("localization.overridden")}</span>}
        {setString.isSuccess && (
          <span className="text-xs text-green-600">{t("localization.saved")}</span>
        )}
        {overridden && (
          <button
            type="button"
            className="link text-xs"
            onClick={() => {
              setValue(item.base);
              setString.mutate({ locale, key: item.key, value: "" });
            }}
          >
            {t("localization.reset")}
          </button>
        )}
      </div>
      <p className="muted mt-0.5 text-xs">
        <span className="font-medium">{t("localization.english")}:</span> {item.en}
      </p>
      <textarea
        className="textarea mt-1 w-full text-sm"
        rows={2}
        value={value}
        lang={locale}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== current) setString.mutate({ locale, key: item.key, value });
        }}
      />
      {setString.error && <p className="text-xs text-red-600">{setString.error.message}</p>}
    </div>
  );
}

export default function LocalizationPage() {
  const t = useTranslations();
  const displayLocale = useLocale();
  const utils = api.useUtils();
  const [locale, setLocale] = useState<Locale>(displayLocale as Locale);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const strings = api.localization.strings.useQuery({ locale });
  const all = useMemo(() => strings.data ?? [], [strings.data]);
  const needle = q.trim().toLowerCase();

  // Group keys by their top-level namespace (the part before the first dot). The query already
  // returns keys sorted, so namespaces come out alphabetically.
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

  // Per group, the rows that match the search (all of them when there's no search).
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
  const onSaved = () => utils.localization.strings.invalidate();

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
        <h1 className="page-title">{t("localization.title")}</h1>
        <p className="muted mt-1">{t("localization.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="label">{t("localization.targetLanguage")}</span>
          <select
            className="select field-auto min-w-40"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l]}
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

      {strings.isLoading ? (
        <p className="muted">{t("localization.loading")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="muted text-xs">
              {t("localization.count", { shown: totalShown, total: all.length })}
            </p>
            {!needle && (
              <div className="flex gap-3">
                <button
                  type="button"
                  className="link text-xs"
                  onClick={() => setExpanded(new Set(groups.map((g) => g.ns)))}
                >
                  {t("localization.expandAll")}
                </button>
                <button type="button" className="link text-xs" onClick={() => setExpanded(new Set())}>
                  {t("localization.collapseAll")}
                </button>
              </div>
            )}
          </div>

          {view.length === 0 && <p className="muted">{t("localization.empty")}</p>}

          <div className="space-y-3">
            {view.map(({ ns, rows, shownRows }) => {
              const open = !!needle || expanded.has(ns);
              const edited = rows.filter((r) => r.override !== null).length;
              return (
                <div key={ns} className="card overflow-hidden">
                  <button
                    type="button"
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
                      {needle ? `${shownRows.length} / ${rows.length}` : rows.length}{" "}
                      {t("localization.keysLabel")}
                      {edited > 0 ? ` · ${edited} ${t("localization.overridden")}` : ""}
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-slate-100 px-4 pb-1">
                      {shownRows.slice(0, MAX_ROWS_PER_GROUP).map((item) => (
                        <StringRow
                          key={`${locale}:${item.key}`}
                          locale={locale}
                          item={item}
                          onSaved={onSaved}
                        />
                      ))}
                      {shownRows.length > MAX_ROWS_PER_GROUP && (
                        <p className="muted py-2 text-xs">
                          {t("localization.tooMany", { max: MAX_ROWS_PER_GROUP })}
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
