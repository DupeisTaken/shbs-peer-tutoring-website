"use client";

import {
  FormActions,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { Button } from "~/app/_components/ui/button";
import { useFormatter, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { api } from "~/trpc/react";
import { Markdown } from "~/app/_components/markdown";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";
import { useDialog } from "~/app/_components/confirm-dialog";

type PolicyDoc = {
  id: string;
  slug: string;
  locale: string;
  title: string;
  body: string;
  version: string | null;
  updatedAt: Date;
  updatedBy: { name: string | null; email: string } | null;
};

type ArchiveDoc = {
  id: string;
  slug: string;
  locale: string;
  title: string;
  body: string;
  version: string | null;
  archivedByName: string | null;
  archivedAt: Date;
};

/** Editor for one (slug, locale) policy version. `doc` is undefined when that translation
 *  doesn't exist yet — saving creates it. */
function PolicyVersionEditor({
  slug,
  locale,
  doc,
  readOnly,
  onSaved,
  onBusyChange,
}: {
  slug: string;
  locale: string;
  doc: PolicyDoc | undefined;
  readOnly: boolean;
  onSaved: () => Promise<unknown>;
  onBusyChange: (locale: string, pending: boolean) => void;
}) {
  const programFormat = useFormatter();
  const t = useTranslations();
  const [title, setTitle] = useState(doc?.title ?? "");
  const [version, setVersion] = useState(doc?.version ?? "");
  const [body, setBody] = useState(doc?.body ?? "");
  // The original baseline belongs to this locale. Unrelated refetches cannot
  // change what its unsaved draft is compared against.
  const [baseline, setBaseline] = useState(() => ({
    title: doc?.title ?? "",
    version: doc?.version ?? "",
    body: doc?.body ?? "",
  }));
  const fieldId = useId();
  const admitted = useRef(false);
  const refreshInFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const identity = api.account.me.useQuery();
  const refreshSaved = async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      await onSaved();
      setRefreshFailed(false);
      admitted.current = false;
    } catch {
      // This write already succeeded. Recovery reads only; never offer Save again
      // while the matching policy/archive views still need synchronization.
      setRefreshFailed(true);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  };
  const upsert = api.admin.upsertPolicy.useMutation({
    onSuccess: async (_result, input) => {
      const saved = {
        title: input.title,
        version: input.version ?? "",
        body: input.body,
      };
      setTitle(saved.title);
      setVersion(saved.version);
      setBody(saved.body);
      setBaseline(saved);
      await refreshSaved();
    },
    onError: () => {
      admitted.current = false;
    },
  });
  const pending = upsert.isPending || refreshing;
  useEffect(() => {
    onBusyChange(locale, pending);
    return () => onBusyChange(locale, false);
  }, [locale, pending, onBusyChange]);

  const dirty =
    title !== baseline.title ||
    version !== baseline.version ||
    body !== baseline.body;

  return (
    <div className="space-y-3">
      <fieldset
        disabled={readOnly || pending || refreshFailed}
        aria-busy={pending}
        className="min-w-0 space-y-3"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label
            className="min-w-0 flex-1 basis-64"
            htmlFor={`${fieldId}-title`}
          >
            <span className="label">
              {t("admin.policies.editor.titleLabel")}
            </span>
            <input
              id={`${fieldId}-title`}
              className="input w-full text-lg font-semibold"
              value={title}
              readOnly={readOnly}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("admin.policies.editor.titlePlaceholder")}
            />
          </label>
          <label className="max-w-full min-w-0" htmlFor={`${fieldId}-version`}>
            <span className="label">
              {t("admin.policies.editor.versionLabel")}
            </span>
            <input
              id={`${fieldId}-version`}
              className="input field-auto-bounded [--field-min-width:10rem]"
              value={version}
              readOnly={readOnly}
              onChange={(e) => setVersion(e.target.value)}
              placeholder={t("admin.policies.editor.versionPlaceholder")}
            />
          </label>
        </div>
        <p className="muted text-xs">
          {t("admin.policies.editor.slugLabel")} <code>{slug}</code> ·{" "}
          <code>{locale}</code>
          {doc ? (
            <>
              {" "}
              {t("admin.policies.editor.lastEdited", {
                date: programFormat.dateTime(new Date(doc.updatedAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
              {doc.updatedBy
                ? " " +
                  t("admin.policies.editor.editedBy", {
                    who: doc.updatedBy.name ?? doc.updatedBy.email,
                  })
                : ""}
            </>
          ) : (
            <> · {t("admin.policies.editor.notTranslated")}</>
          )}
        </p>
        <label className="block" htmlFor={`${fieldId}-body`}>
          <span className="label">{t("admin.policies.editor.bodyLabel")}</span>
          <textarea
            id={`${fieldId}-body`}
            className="textarea w-full font-mono text-xs"
            rows={18}
            value={body}
            readOnly={readOnly}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("admin.policies.editor.bodyPlaceholder")}
          />
        </label>
        {!readOnly && (
          <FormActions>
            <button
              className="btn-primary btn-sm"
              disabled={
                !dirty ||
                !title.trim() ||
                !body.trim() ||
                pending ||
                refreshFailed
              }
              onClick={() => {
                if (
                  admitted.current ||
                  readOnly ||
                  !dirty ||
                  !title.trim() ||
                  !body.trim()
                )
                  return;
                admitted.current = true;
                upsert.mutate({
                  slug,
                  locale,
                  title: title.trim(),
                  version: version.trim() || null,
                  body,
                });
              }}
            >
              {upsert.isPending
                ? t("admin.policies.editor.saving")
                : identity.data?.role === "ADMIN"
                  ? t("approvals.requestHead")
                  : t("admin.policies.editor.save")}
            </button>
            {dirty && (
              <span className="muted text-sm">
                {t("admin.policies.editor.unsaved")}
              </span>
            )}
            {upsert.isSuccess && !dirty && (
              <span className="text-sm text-green-600">
                {t("admin.policies.editor.saved")}
              </span>
            )}
            {upsert.error?.data?.approvalId && (
              <InlineNotice tone="warning" announcement="status">
                {t("approvals.queuedBody")}
              </InlineNotice>
            )}
            {upsert.error && !upsert.error.data?.approvalId && (
              <span className="text-sm text-red-600">
                {upsert.error.message}
              </span>
            )}
          </FormActions>
        )}
      </fieldset>
      {refreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button disabled={refreshing} onClick={() => void refreshSaved()}>
              {t("admin.policies.editor.retryRefresh")}
            </Button>
          }
        >
          {t("admin.policies.editor.refreshFailed")}
        </InlineNotice>
      )}
    </div>
  );
}

/** A read-only modal rendering an archived version's body. */
function ArchiveModal({
  doc,
  onClose,
}: {
  doc: ArchiveDoc;
  onClose: () => void;
}) {
  return (
    <ProfileDialog
      title={`${doc.title}${doc.version ? ` · ${doc.version}` : ""}`}
      onClose={onClose}
    >
      {/* Read the explicitly selected archive, even when its locale differs
            from the interface. CurrentPolicyDialog's fallback does not apply. */}
      <div
        lang={doc.locale}
        className="text-sm leading-relaxed [overflow-wrap:anywhere] text-slate-700"
      >
        <Markdown>{doc.body}</Markdown>
      </div>
    </ProfileDialog>
  );
}

/** Collapsible list of a policy version's earlier (archived) copies for one locale. */
function VersionHistory({ archives }: { archives: ArchiveDoc[] }) {
  const programFormat = useFormatter();
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<ArchiveDoc | null>(null);

  return (
    <div className="border-t border-slate-100 pt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-slate-600"
      >
        <DisclosureIcon open={open} />
        {t("admin.policies.history")} ({archives.length})
      </button>
      {open &&
        (archives.length === 0 ? (
          <p className="muted mt-2 text-sm">
            {t("admin.policies.historyEmpty")}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {archives.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 py-1.5 text-sm"
              >
                <span className="muted">
                  {t("admin.policies.archivedOn", {
                    date: programFormat.dateTime(new Date(a.archivedAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                  {a.version ? ` · ${a.version}` : ""}
                  {a.archivedByName ? ` · ${a.archivedByName}` : ""}
                </span>
                <button
                  type="button"
                  className="link text-xs"
                  onClick={() => setViewing(a)}
                >
                  {t("admin.policies.viewArchived")}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {viewing && (
        <ArchiveModal doc={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

type LangInfo = { code: string; label: string };

/** Default policy language — always present; the fallback shown when a language isn't translated. */
const DEFAULT_LOCALE = "en";

/**
 * One policy (slug). Only languages that have actually been added are selectable; the rest are
 * added on demand via the "Add language" picker (which opens a blank draft for that language).
 * Languages follow the order set on /localization (admins reorder there). The default language
 * can't be removed — it's the fallback for untranslated languages.
 */
function PolicyCard({
  slug,
  byLocale,
  archivesByLocale,
  languages,
  readOnly,
  onSaved,
  archivesReady,
}: {
  slug: string;
  byLocale: Map<string, PolicyDoc>;
  archivesByLocale: Map<string, ArchiveDoc[]>;
  languages: LangInfo[];
  readOnly: boolean;
  onSaved: () => Promise<unknown>;
  archivesReady: boolean;
}) {
  const t = useTranslations();
  const { confirm, dialog } = useDialog();
  const [deleteRefreshFailed, setDeleteRefreshFailed] = useState(false);
  const [deleteRefreshing, setDeleteRefreshing] = useState(false);
  const refreshDeleted = async () => {
    setDeleteRefreshing(true);
    try {
      await onSaved();
      setDeleteRefreshFailed(false);
    } catch {
      // Removing a locale is also an accepted write; retry its reads, not Delete.
      setDeleteRefreshFailed(true);
    } finally {
      setDeleteRefreshing(false);
    }
  };
  const del = api.admin.deletePolicyLocale.useMutation({
    onSuccess: refreshDeleted,
  });

  const codes = languages.map((l) => l.code);
  const labelFor = (code: string) =>
    languages.find((l) => l.code === code)?.label ?? code;

  // Languages this policy already has, in the configured order; any stranded ones (a doc for a
  // language no longer listed) are kept at the end so they stay editable.
  const existing = [
    DEFAULT_LOCALE,
    ...codes.filter((c) => c !== DEFAULT_LOCALE && byLocale.has(c)),
    ...[...byLocale.keys()].filter(
      (c) => c !== DEFAULT_LOCALE && !codes.includes(c),
    ),
  ];
  // Languages the editor has opened a blank draft for (not yet saved).
  const [drafts, setDrafts] = useState<string[]>([]);
  const available = [
    ...existing,
    ...drafts.filter((d) => !existing.includes(d)),
  ];
  const notAdded = codes.filter((c) => !available.includes(c));

  const [active, setActive] = useState<string>(() =>
    byLocale.has(DEFAULT_LOCALE)
      ? DEFAULT_LOCALE
      : (existing.find((locale) => byLocale.has(locale)) ?? DEFAULT_LOCALE),
  );
  const [visited, setVisited] = useState<string[]>([]);
  const [busyLocales, setBusyLocales] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onBusyChange = useCallback((locale: string, pending: boolean) => {
    setBusyLocales((previous) => {
      if (previous.has(locale) === pending) return previous;
      const next = new Set(previous);
      if (pending) next.add(locale);
      else next.delete(locale);
      return next;
    });
  }, []);
  const changeLocale = (locale: string) => {
    setVisited((previous) => [...new Set([...previous, active, locale])]);
    setActive(locale);
  };
  // English title is the friendliest label for the group header.
  const heading =
    byLocale.get(DEFAULT_LOCALE)?.title ??
    byLocale.values().next().value?.title ??
    (slug === "tutee-policy"
      ? t("admin.policies.studentTitle")
      : slug === "tutor-policy"
        ? t("admin.policies.tutorTitle")
        : slug);

  const isDraft = !byLocale.has(active);

  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">{heading}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="muted">{t("admin.policies.languageLabel")}</span>
            <select
              value={active}
              onChange={(e) => changeLocale(e.target.value)}
              className="select field-auto min-w-32"
            >
              {available.map((l) => (
                <option key={l} value={l}>
                  {labelFor(l)}
                  {l === DEFAULT_LOCALE
                    ? ` (${t("admin.policies.defaultBadge")})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {!readOnly && notAdded.length > 0 && (
            <select
              value=""
              aria-label={t("admin.policies.addLanguage")}
              onChange={(e) => {
                const l = e.target.value;
                if (!l) return;
                setDrafts((d) => [...d, l]);
                changeLocale(l);
              }}
              className="select field-auto min-w-40"
            >
              <option value="">{t("admin.policies.addLanguage")}</option>
              {notAdded.map((l) => (
                <option key={l} value={l}>
                  {labelFor(l)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {/* Keep opened locale owners mounted, including mutation callbacks. Hidden
          drafts remain independent; an explicit discard/removal releases them. */}
      {available
        .filter((locale) => locale === active || visited.includes(locale))
        .map((locale) => (
          <div key={locale} hidden={locale !== active}>
            <PolicyVersionEditor
              slug={slug}
              locale={locale}
              doc={byLocale.get(locale)}
              readOnly={
                readOnly ||
                deleteRefreshFailed ||
                deleteRefreshing ||
                del.isPending
              }
              onSaved={onSaved}
              onBusyChange={onBusyChange}
            />
          </div>
        ))}
      {!readOnly && active !== DEFAULT_LOCALE && (
        <div>
          {isDraft ? (
            <button
              className="link text-xs"
              disabled={busyLocales.has(active)}
              onClick={() => {
                setDrafts((d) => d.filter((x) => x !== active));
                setVisited((previous) =>
                  previous.filter((locale) => locale !== active),
                );
                setActive(DEFAULT_LOCALE);
              }}
            >
              {t("admin.policies.discardLanguage")}
            </button>
          ) : (
            <button
              className="link-danger text-xs"
              disabled={
                del.isPending ||
                deleteRefreshing ||
                deleteRefreshFailed ||
                busyLocales.has(active)
              }
              onClick={async () => {
                const locale = active;
                if (
                  busyLocales.has(locale) ||
                  del.isPending ||
                  deleteRefreshing ||
                  deleteRefreshFailed
                )
                  return;
                if (
                  await confirm({
                    title: t("admin.policies.confirmRemoveLanguage", {
                      lang: labelFor(active),
                    }),
                    confirmLabel: t("common.delete"),
                    cancelLabel: t("common.cancel"),
                    danger: true,
                  })
                )
                  del.mutate(
                    { slug, locale },
                    {
                      onSuccess: () => {
                        setVisited((previous) =>
                          previous.filter((entry) => entry !== locale),
                        );
                        setActive(DEFAULT_LOCALE);
                      },
                    },
                  );
              }}
            >
              {t("admin.policies.removeLanguage")}
            </button>
          )}
        </div>
      )}
      {archivesReady && (
        <VersionHistory archives={archivesByLocale.get(active) ?? []} />
      )}
      {deleteRefreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button
              disabled={deleteRefreshing}
              onClick={() => void refreshDeleted()}
            >
              {t("admin.policies.editor.retryRefresh")}
            </Button>
          }
        >
          {t("managementRecovery.refreshFailed", { section: heading })}
        </InlineNotice>
      )}
      {del.error?.data?.approvalId && (
        <InlineNotice tone="warning" announcement="status">
          {t("approvals.queuedBody")}
        </InlineNotice>
      )}
      {dialog}
    </section>
  );
}

export default function PoliciesPage() {
  const t = useTranslations();
  const viewerReadOnly = useReadOnly();
  const identity = api.account.me.useQuery();
  const readOnly =
    viewerReadOnly ||
    !!identity.error ||
    !["HEAD", "ADMIN"].includes(identity.data?.role ?? "");
  // A temporary identity read failure disables editing without deleting already
  // opened seed-free form owners. A definitive access denial still hides them.
  const canSeedPolicies =
    !viewerReadOnly && ["HEAD", "ADMIN"].includes(identity.data?.role ?? "");
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState({ policies: false, archives: false });
  const utils = api.useUtils();
  const policies = api.admin.policies.useQuery(undefined, {
    enabled: !denied.policies,
  });
  const archives = api.admin.policyArchives.useQuery(undefined, {
    enabled: !denied.archives,
  });
  const languages = api.i18n.languages.useQuery();
  const invalidate = () =>
    settleRefreshes([
      () => invalidateAndReport(utils.admin.policies),
      () => invalidateAndReport(utils.admin.policyArchives),
    ]);
  const identityAccessDenied =
    identity.error?.data?.code === "FORBIDDEN" ||
    identity.error?.data?.code === "UNAUTHORIZED";
  const policyAccessDenied =
    identityAccessDenied ||
    policies.error?.data?.code === "FORBIDDEN" ||
    policies.error?.data?.code === "UNAUTHORIZED";
  const archiveAccessDenied =
    identityAccessDenied ||
    archives.error?.data?.code === "FORBIDDEN" ||
    archives.error?.data?.code === "UNAUTHORIZED";
  const policyDenied = policyAccessDenied || denied.policies;
  const archiveDenied = archiveAccessDenied || denied.archives;
  useEffect(() => {
    if (policyAccessDenied) {
      setDenied((previous) => ({ ...previous, policies: true }));
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.policies, undefined, "query"),
        exact: true,
      });
    } else if (policies.isSuccess && !policies.isFetching && !identity.error) {
      setDenied((previous) =>
        previous.policies ? { ...previous, policies: false } : previous,
      );
    }
  }, [
    policyAccessDenied,
    policies.isSuccess,
    policies.isFetching,
    identity.error,
    queryClient,
  ]);
  useEffect(() => {
    if (archiveAccessDenied) {
      setDenied((previous) => ({ ...previous, archives: true }));
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.policyArchives, undefined, "query"),
        exact: true,
      });
    } else if (archives.isSuccess && !archives.isFetching && !identity.error) {
      setDenied((previous) =>
        previous.archives ? { ...previous, archives: false } : previous,
      );
    }
  }, [
    archiveAccessDenied,
    archives.isSuccess,
    archives.isFetching,
    identity.error,
    queryClient,
  ]);

  // A seed-free installation still needs editors for both required policies. Wait for
  // the query before mounting them so a blank draft cannot hide subsequently loaded text.
  const groups = useMemo(() => {
    const m = new Map<string, Map<string, PolicyDoc>>();
    if (!policies.data || policyDenied) return m;
    if (canSeedPolicies) {
      m.set("tutee-policy", new Map());
      m.set("tutor-policy", new Map());
    }
    for (const doc of policies.data ?? []) {
      const inner = m.get(doc.slug) ?? new Map<string, PolicyDoc>();
      inner.set(doc.locale, doc);
      m.set(doc.slug, inner);
    }
    return m;
  }, [policies.data, canSeedPolicies, policyDenied]);

  // Group archives into slug -> (locale -> [archives newest-first]).
  const archiveGroups = useMemo(() => {
    const m = new Map<string, Map<string, ArchiveDoc[]>>();
    for (const a of archives.data ?? []) {
      const inner = m.get(a.slug) ?? new Map<string, ArchiveDoc[]>();
      const list = inner.get(a.locale) ?? [];
      list.push(a);
      inner.set(a.locale, list);
      m.set(a.slug, inner);
    }
    return m;
  }, [archives.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.policies.title")}</h1>
        <p className="muted mt-1">{t("admin.policies.subtitle")}</p>
      </div>

      {policyDenied ? (
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", {
            section: t("admin.policies.title"),
          })}
          action={
            <Button
              disabled={policies.isFetching}
              onClick={() => void policies.refetch()}
            >
              {t("managementRecovery.retry", {
                section: t("admin.policies.title"),
              })}
            </Button>
          }
        />
      ) : (
        <QueryFeedback
          hasData={policies.data !== undefined}
          loading={policies.data === undefined}
          error={!!policies.error}
          retrying={policies.isFetching}
          loadingTitle={t("managementRecovery.loading", {
            section: t("admin.policies.title"),
          })}
          errorTitle={t(
            policies.data === undefined
              ? "managementRecovery.loadFailed"
              : "managementRecovery.refreshFailed",
            { section: t("admin.policies.title") },
          )}
          retryLabel={t("managementRecovery.retry", {
            section: t("admin.policies.title"),
          })}
          onRetry={() => void policies.refetch()}
        />
      )}
      {!policyDenied && groups.size > 0 && (
        <>
          {archiveDenied ? (
            <StatePanel
              kind="denied"
              title={t("managementRecovery.denied", {
                section: t("admin.policies.history"),
              })}
              action={
                <Button
                  disabled={archives.isFetching}
                  onClick={() => void archives.refetch()}
                >
                  {t("managementRecovery.retry", {
                    section: t("admin.policies.history"),
                  })}
                </Button>
              }
            />
          ) : (
            <QueryFeedback
              hasData={archives.data !== undefined}
              loading={archives.data === undefined}
              error={!!archives.error}
              retrying={archives.isFetching}
              loadingTitle={t("managementRecovery.loading", {
                section: t("admin.policies.history"),
              })}
              errorTitle={t(
                archives.data === undefined
                  ? "managementRecovery.loadFailed"
                  : "managementRecovery.refreshFailed",
                { section: t("admin.policies.history") },
              )}
              retryLabel={t("managementRecovery.retry", {
                section: t("admin.policies.history"),
              })}
              onRetry={() => void archives.refetch()}
            />
          )}
          <QueryFeedback
            hasData={languages.data !== undefined}
            loading={languages.data === undefined}
            error={!!languages.error}
            retrying={languages.isFetching}
            loadingTitle={t("managementRecovery.loading", {
              section: t("localization.languagesHeading"),
            })}
            errorTitle={t(
              languages.data === undefined
                ? "managementRecovery.loadFailed"
                : "managementRecovery.refreshFailed",
              { section: t("localization.languagesHeading") },
            )}
            retryLabel={t("managementRecovery.retry", {
              section: t("localization.languagesHeading"),
            })}
            onRetry={() => void languages.refetch()}
          />
        </>
      )}
      {[...groups.entries()].map(([slug, byLocale]) => (
        <PolicyCard
          key={slug}
          slug={slug}
          byLocale={byLocale}
          archivesByLocale={archiveGroups.get(slug) ?? new Map()}
          languages={languages.data ?? []}
          readOnly={readOnly}
          onSaved={invalidate}
          archivesReady={archives.data !== undefined && !archiveDenied}
        />
      ))}
      {groups.size === 0 &&
        policies.data !== undefined &&
        !policies.error &&
        !policyDenied && <p className="muted">{t("admin.policies.empty")}</p>}
    </div>
  );
}
