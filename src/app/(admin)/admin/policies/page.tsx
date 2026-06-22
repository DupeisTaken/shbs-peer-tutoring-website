"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { api } from "~/trpc/react";
import { LOCALES, LOCALE_LABELS } from "~/i18n/config";
import { Markdown } from "~/app/_components/markdown";
import { DisclosureIcon } from "~/app/_components/icons";

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
  onSaved,
}: {
  slug: string;
  locale: string;
  doc: PolicyDoc | undefined;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const [title, setTitle] = useState(doc?.title ?? "");
  const [version, setVersion] = useState(doc?.version ?? "");
  const [body, setBody] = useState(doc?.body ?? "");
  const upsert = api.admin.upsertPolicy.useMutation({ onSuccess: onSaved });

  const dirty =
    title !== (doc?.title ?? "") ||
    version !== (doc?.version ?? "") ||
    body !== (doc?.body ?? "");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          className="input max-w-md text-lg font-semibold"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("admin.policies.editor.titlePlaceholder")}
        />
        <input
          className="input max-w-[10rem]"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder={t("admin.policies.editor.versionPlaceholder")}
        />
      </div>
      <p className="muted text-xs">
        {t("admin.policies.editor.slugLabel")} <code>{slug}</code> · <code>{locale}</code>
        {doc ? (
          <>
            {" "}
            {t("admin.policies.editor.lastEdited", {
              date: new Date(doc.updatedAt).toLocaleString(),
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
      <textarea
        className="textarea w-full font-mono text-xs"
        rows={18}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("admin.policies.editor.bodyPlaceholder")}
      />
      <div className="flex items-center gap-3">
        <button
          className="btn-primary btn-sm"
          disabled={!dirty || !title.trim() || !body.trim() || upsert.isPending}
          onClick={() =>
            upsert.mutate({
              slug,
              locale,
              title: title.trim(),
              version: version.trim() || null,
              body,
            })
          }
        >
          {upsert.isPending ? t("admin.policies.editor.saving") : t("admin.policies.editor.save")}
        </button>
        {upsert.isSuccess && !dirty && (
          <span className="text-sm text-green-600">{t("admin.policies.editor.saved")}</span>
        )}
        {upsert.error && <span className="text-sm text-red-600">{upsert.error.message}</span>}
      </div>
    </div>
  );
}

/** A read-only modal rendering an archived version's body. */
function ArchiveModal({ doc, onClose }: { doc: ArchiveDoc; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card flex max-h-[85vh] w-full max-w-2xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="section-title">
            {doc.title}
            {doc.version ? ` · ${doc.version}` : ""}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 text-sm leading-relaxed text-slate-700">
          <Markdown>{doc.body}</Markdown>
        </div>
      </div>
    </div>
  );
}

/** Collapsible list of a policy version's earlier (archived) copies for one locale. */
function VersionHistory({ archives }: { archives: ArchiveDoc[] }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<ArchiveDoc | null>(null);

  return (
    <div className="border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-slate-600"
      >
        <DisclosureIcon open={open} />
        {t("admin.policies.history")} ({archives.length})
      </button>
      {open &&
        (archives.length === 0 ? (
          <p className="muted mt-2 text-sm">{t("admin.policies.historyEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {archives.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="muted">
                  {t("admin.policies.archivedOn", { date: new Date(a.archivedAt).toLocaleString() })}
                  {a.version ? ` · ${a.version}` : ""}
                  {a.archivedByName ? ` · ${a.archivedByName}` : ""}
                </span>
                <button type="button" className="link text-xs" onClick={() => setViewing(a)}>
                  {t("admin.policies.viewArchived")}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {viewing && <ArchiveModal doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** One policy (slug) with a language selector per supported locale. */
function PolicyCard({ slug, byLocale, archivesByLocale, onSaved }: {
  slug: string;
  byLocale: Map<string, PolicyDoc>;
  archivesByLocale: Map<string, ArchiveDoc[]>;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const [active, setActive] = useState<string>(LOCALES[0]);
  // English title is the friendliest label for the group header.
  const heading = byLocale.get("en")?.title ?? byLocale.values().next().value?.title ?? slug;

  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">{heading}</h2>
        <label className="flex items-center gap-2 text-sm">
          <span className="muted">{t("admin.policies.languageLabel")}</span>
          <select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            className="select w-auto"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l]}
                {!byLocale.has(l) ? ` (${t("admin.policies.notTranslatedShort")})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <PolicyVersionEditor
        key={active}
        slug={slug}
        locale={active}
        doc={byLocale.get(active)}
        onSaved={onSaved}
      />
      <VersionHistory archives={archivesByLocale.get(active) ?? []} />
    </section>
  );
}

export default function PoliciesPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const policies = api.admin.policies.useQuery();
  const archives = api.admin.policyArchives.useQuery();
  const invalidate = () =>
    Promise.all([utils.admin.policies.invalidate(), utils.admin.policyArchives.invalidate()]);

  // Group the flat rows into slug -> (locale -> doc).
  const groups = useMemo(() => {
    const m = new Map<string, Map<string, PolicyDoc>>();
    for (const doc of policies.data ?? []) {
      const inner = m.get(doc.slug) ?? new Map<string, PolicyDoc>();
      inner.set(doc.locale, doc);
      m.set(doc.slug, inner);
    }
    return m;
  }, [policies.data]);

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

      {policies.isLoading && <p className="muted">{t("admin.policies.loading")}</p>}
      {[...groups.entries()].map(([slug, byLocale]) => (
        <PolicyCard
          key={slug}
          slug={slug}
          byLocale={byLocale}
          archivesByLocale={archiveGroups.get(slug) ?? new Map()}
          onSaved={invalidate}
        />
      ))}
      {groups.size === 0 && !policies.isLoading && (
        <p className="muted">{t("admin.policies.empty")}</p>
      )}
    </div>
  );
}
