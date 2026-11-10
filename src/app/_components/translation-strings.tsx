"use client";

import { useLayoutEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { getQueryKey } from "@trpc/react-query";
import { DisclosureIcon } from "~/app/_components/icons";
import { translationAccess } from "~/lib/translation-access";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { FilterToolbar, InlineNotice } from "~/app/_components/ui/patterns";
import { Button, ChoiceButton } from "~/app/_components/ui/button";
import { useSessionAccessDenied } from "./session-view-state";
import { QueryFeedback } from "./ui/query-feedback";
import { viewAccessDenied } from "~/lib/session-view-state";
import { useTranslationIntent } from "./use-translation-intent";

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
  acceptedValue?: string;
  published?: boolean;
  pending?: boolean;
  error?: string | null;
  success?: boolean;
  refreshFailed?: boolean;
  readScope?: { locale: string; refLocales: string[] };
};

type StringDraftState = {
  revision: number;
  values: Record<string, StringDraft>;
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
  blocked,
  readScope,
  getDraft,
  onSubmit,
}: {
  locale: string;
  item: StringRowData;
  labelFor: (code: string) => string;
  onSaved: (scope: {
    locale: string;
    refLocales: string[];
  }) => Promise<unknown> | void;
  canPublish: boolean;
  draft: StringDraft | undefined;
  onDraftChange: (update: Partial<StringDraft>) => void;
  saveHelpId: string;
  blocked: boolean;
  readScope: { locale: string; refLocales: string[] };
  getDraft: () => StringDraft | undefined;
  onSubmit: (value: string) => void;
}) {
  const t = useTranslations();
  const current = item.override ?? item.base;
  const value = draft?.value ?? current;
  const submitted = draft?.submitted ?? null;
  const refreshSaved = async () => {
    if (getDraft()?.pending) return;
    onDraftChange({ pending: true });
    try {
      await onSaved(getDraft()?.readScope ?? readScope);
      onDraftChange({ refreshFailed: false });
    } catch {
      onDraftChange({ refreshFailed: true });
    } finally {
      onDraftChange({ pending: false });
    }
  };
  const pending = !!draft?.pending;
  const submit = (nextValue: string) => {
    const currentDraft = getDraft();
    if (
      blocked ||
      currentDraft?.pending ||
      currentDraft?.refreshFailed ||
      nextValue === currentDraft?.acceptedValue
    )
      return;
    onSubmit(nextValue);
  };

  const overridden = item.override !== null;

  return (
    <div className="border-b border-slate-100 py-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-[11px] text-slate-600">{item.key}</code>
        {overridden && (
          <span className="badge-slate">{t("localization.overridden")}</span>
        )}
        {draft?.success && (
          <span className="text-xs text-green-600">
            {t(
              (draft.published ?? canPublish)
                ? "translationEditor.published"
                : "translationEditor.submitted",
            )}
          </span>
        )}
        {overridden && (
          <button
            type="button"
            className="link control-compact inline-flex items-center text-xs"
            disabled={blocked || pending || draft?.refreshFailed}
            onClick={() => {
              if (blocked || getDraft()?.pending || getDraft()?.refreshFailed)
                return;
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
        disabled={blocked || pending || draft?.refreshFailed}
        lang={locale}
        aria-label={item.key}
        aria-describedby={saveHelpId}
        onChange={(e) => {
          if (!blocked && !getDraft()?.pending && !getDraft()?.refreshFailed)
            onDraftChange({ value: e.target.value, success: false });
        }}
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

export function TranslationStrings({
  concealed = false,
}: { concealed?: boolean } = {}) {
  const t = useTranslations();
  const ownerActive = useRef(false);
  useLayoutEffect(() => {
    ownerActive.current = true;
    return () => {
      ownerActive.current = false;
    };
  }, []);
  const scopeId = useId();
  const saveHelpId = `${scopeId}-save-help`;
  const me = api.account.me.useQuery();
  const access = translationAccess(me.data);
  const displayLocale = useLocale();
  const utils = api.useUtils();
  const languages = api.i18n.managedLanguages.useQuery(undefined, {
    enabled: !concealed && access.edit,
  });
  const [selectedLocale, setLocale] = useState<string>(displayLocale);
  const [refLocales, setRefLocales] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Cache only interacted-with row state, not thousands of hidden DOM nodes.
  // Locale/key ownership survives namespace collapse, search and language changes;
  // the authorized feature owner releases this memory when it unmounts.
  const [draftState, setDraftState] = useState<StringDraftState>({
    revision: 0,
    values: {},
  });
  const draftsNow = useRef(draftState);
  const admissions = useRef(new Map<string, symbol>());
  const updateDraft = (key: string, update: Partial<StringDraft>) => {
    const previous = draftsNow.current;
    const next = {
      revision: previous.revision + 1,
      values: {
        ...previous.values,
        [key]: { ...previous.values[key], ...update },
      },
    };
    draftsNow.current = next;
    setDraftState(next);
  };
  // Capability revocation removes unsent edits, while admitted/accepted rows
  // retain their receipt and lease. This pure projection runs before commit;
  // abandoned renders never prune the imperative event/callback owner.
  let visibleDraftState = draftState;
  if (me.isSuccess && me.data && !me.error && !access.edit) {
    const retained: Record<string, StringDraft> = {};
    let changed = false;
    for (const [key, draft] of Object.entries(draftState.values)) {
      if (draft.pending) retained[key] = draft;
      else if (draft.submitted != null) {
        retained[key] = {
          ...draft,
          value: draft.submitted,
          error: null,
          success: true,
        };
        changed ||=
          draft.value !== draft.submitted || !!draft.error || !draft.success;
      } else changed = true;
    }
    if (changed) {
      visibleDraftState = {
        revision: draftState.revision + 1,
        values: retained,
      };
      setDraftState(visibleDraftState);
    }
  }
  const drafts = visibleDraftState.values;
  useLayoutEffect(() => {
    // A stale/equal-version render cannot overwrite a newer synchronous edit
    // or terminal callback derived independently from the same old snapshot.
    if (draftsNow.current.revision < visibleDraftState.revision)
      draftsNow.current = visibleDraftState;
  }, [visibleDraftState]);
  const draftKey = (language: string, key: string) =>
    JSON.stringify([language, key]);

  const langOptions = useMemo(() => languages.data ?? [], [languages.data]);
  const labelFor = (code: string) =>
    langOptions.find((l) => l.code === code)?.label ?? code;
  // A removed language must not reach a query or reappear as a stale selection.
  // Row drafts remain separately owned by their language/key.
  const locale =
    langOptions.length > 0 &&
    !langOptions.some((language) => language.code === selectedLocale)
      ? displayLocale
      : selectedLocale;
  if (selectedLocale !== locale) setLocale(locale);

  const stringsInput = { locale, refLocales };
  const strings = api.localization.strings.useQuery(stringsInput, {
    enabled: !concealed && access.edit,
  });
  const denied = useSessionAccessDenied(
    ...[
      { ...me, queryKey: getQueryKey(api.account.me, undefined, "query") },
      {
        ...languages,
        queryKey: getQueryKey(api.i18n.managedLanguages, undefined, "query"),
      },
      {
        ...strings,
        denialKey: "interface-strings",
        queryKey: getQueryKey(api.localization.strings, stringsInput, "query"),
      },
    ].map((query) => ({
      ...query,
      isSuccess: query.isSuccess && query.data != null,
    })),
  );
  const missingRead = [me, languages, strings].some(
    (query) => query.isSuccess && query.data == null,
  );
  const readError = me.error ?? languages.error ?? strings.error;
  const ready =
    !concealed &&
    !denied &&
    access.edit &&
    !readError &&
    !missingRead &&
    !!languages.data &&
    !!strings.data;
  const readyNow = useRef(ready);
  const synchronizationAllowed = useRef(false);
  const currentActor = useRef(me.data?.id);
  // These are event/callback guards; rendered availability uses query/state.
  useLayoutEffect(() => {
    readyNow.current = ready;
    synchronizationAllowed.current = !concealed && !denied && access.edit;
    currentActor.current = me.data?.id;
  });
  // The retained feature owner holds transport and exact retries even when a
  // namespace/search change removes the submitting row from the DOM.
  const setString = api.localization.setString.useMutation({ retry: false });
  const controller = useTranslationIntent({
    actorId: !me.error && !denied ? me.data?.id : null,
    mode: access.publish ? "PUBLISH" : "DRAFT",
    canSubmit: !concealed && !denied && !me.error && access.edit,
    refreshAuthority: async () => {
      const result = await me.refetch({ throwOnError: true });
      const fresh = translationAccess(result.data);
      return {
        actorId: result.data?.id ?? null,
        mode: fresh.publish ? ("PUBLISH" as const) : ("DRAFT" as const),
        canSubmit: !!result.data && fresh.edit,
      };
    },
  });
  const [retrying, setRetrying] = useState(false);
  const retryLease = useRef(false);
  const retryReads = async () => {
    if (!ownerActive.current || retryLease.current || concealed) return;
    retryLease.current = true;
    setRetrying(true);
    try {
      await settleRefreshes([
        async () => {
          await me.refetch({ throwOnError: true });
        },
        async () => {
          await languages.refetch({ throwOnError: true });
        },
        async () => {
          await strings.refetch({ throwOnError: true });
        },
      ]);
    } catch {
      // The originating queries retain their error/null recovery state.
    } finally {
      retryLease.current = false;
      setRetrying(false);
    }
  };
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
  const onSaved = async (scope: { locale: string; refLocales: string[] }) => {
    if (!ownerActive.current || !synchronizationAllowed.current)
      throw new Error(t("translationEditor.refreshFailed"));
    const invalidations = await Promise.allSettled([
      invalidateAndReport(utils.localization.strings),
      invalidateAndReport(utils.translationReview.list),
    ]);
    if (!ownerActive.current || !synchronizationAllowed.current)
      throw new Error(t("translationEditor.refreshFailed"));
    for (const result of invalidations) {
      if (
        result.status === "rejected" &&
        viewAccessDenied(result.reason as { data?: { code?: string } })
      )
        throw result.reason as unknown;
    }
    await settleRefreshes([
      async () => {
        for (const result of invalidations)
          if (result.status === "rejected") throw result.reason as unknown;
      },
      async () => {
        const rows = await utils.localization.strings.fetch(scope, {
          staleTime: 0,
        });
        if (!Array.isArray(rows))
          throw new Error(t("translationEditor.readFailed"));
      },
      async () => {
        await me.refetch({ throwOnError: true });
      },
      async () => {
        await languages.refetch({ throwOnError: true });
      },
    ]);
  };

  const submitString = (
    item: StringRowData,
    value: string,
    scope: { locale: string; refLocales: string[] },
  ) => {
    const key = draftKey(scope.locale, item.key);
    const draft = draftsNow.current.values[key];
    if (
      !ownerActive.current ||
      !readyNow.current ||
      controller.blocked ||
      admissions.current.has(key) ||
      draft?.pending ||
      draft?.refreshFailed ||
      value === draft?.acceptedValue ||
      !me.data?.id
    )
      return;
    const actorId = me.data.id;
    const lease = Symbol(key);
    admissions.current.set(key, lease);
    const release = () => {
      if (admissions.current.get(key) !== lease) return;
      admissions.current.delete(key);
      updateDraft(key, { pending: false });
    };
    updateDraft(key, {
      pending: true,
      error: null,
      success: false,
      readScope: scope,
      published: access.publish,
    });
    void controller
      .submit(
        "localization.setString",
        { locale: scope.locale, key: item.key, value },
        async (input) => {
          try {
            return await setString.mutateAsync(input);
          } catch (error) {
            // A stopped old transport can finish after a new deliberate row edit.
            // Its error belongs only to the lease that originally sent it.
            if (admissions.current.get(key) === lease)
              updateDraft(key, {
                error:
                  error instanceof Error
                    ? error.message
                    : t("translationEditor.readFailed"),
              });
            throw error;
          }
        },
        {
          onAccepted: async (receipt, { synchronize }) => {
            // Acceptance is historical metadata for this original row, never the
            // row/language that happens to be displayed when a late check finishes.
            updateDraft(key, {
              submitted: value || item.base,
              acceptedValue: value,
              published: receipt.mode === "PUBLISH",
              success: true,
              error: null,
            });
            try {
              if (
                !synchronize ||
                !ownerActive.current ||
                !synchronizationAllowed.current ||
                currentActor.current !== actorId
              )
                throw new Error(t("translationEditor.refreshFailed"));
              await onSaved(scope);
              updateDraft(key, { refreshFailed: false });
            } catch {
              updateDraft(key, { refreshFailed: true });
            } finally {
              release();
            }
          },
          onStopped: () => {
            release();
            updateDraft(key, { error: null });
          },
        },
      )
      .then((result) => {
        if (result.status === "BLOCKED") release();
      });
  };

  const toggle = (ns: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns);
      else next.add(ns);
      return next;
    });

  if (concealed) return null;
  if (denied || (me.data && !access.edit))
    return (
      <div className="space-y-2">
        <p role="alert">{t("translationEditor.noAccess")}</p>
        {denied && (
          <Button disabled={retrying} onClick={() => void retryReads()}>
            {t("common.retry")}
          </Button>
        )}
      </div>
    );
  return (
    <div className="space-y-5">
      <QueryFeedback
        hasData={strings.data != null && languages.data != null}
        loading={me.isLoading || languages.isLoading || strings.isLoading}
        error={!!readError || missingRead}
        retrying={retrying}
        loadingTitle={t("localization.loading")}
        errorTitle={t("translationEditor.readFailed")}
        errorDetail={readError?.message}
        retryLabel={t("common.retry")}
        onRetry={() => void retryReads()}
      />
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
            disabled={!!readError || missingRead || !languages.data || retrying}
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

          {ready && view.length === 0 && (
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
                          blocked={!ready || retrying || controller.blocked}
                          readScope={{ locale, refLocales: [...refLocales] }}
                          draft={drafts[draftKey(locale, item.key)]}
                          getDraft={() =>
                            draftsNow.current.values[draftKey(locale, item.key)]
                          }
                          onDraftChange={(update) =>
                            updateDraft(draftKey(locale, item.key), update)
                          }
                          onSubmit={(value) =>
                            submitString(item, value, {
                              locale,
                              refLocales: [...refLocales],
                            })
                          }
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
