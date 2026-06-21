"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { api } from "~/trpc/react";
import { LOCALES, LOCALE_LABELS } from "~/i18n/config";

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

/** One policy (slug) with a language tab per supported locale. */
function PolicyCard({ slug, byLocale, onSaved }: {
  slug: string;
  byLocale: Map<string, PolicyDoc>;
  onSaved: () => void;
}) {
  const [active, setActive] = useState<string>(LOCALES[0]);
  // English title is the friendliest label for the group header.
  const heading = byLocale.get("en")?.title ?? byLocale.values().next().value?.title ?? slug;

  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">{heading}</h2>
        <div className="flex gap-1">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setActive(l)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                active === l
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {LOCALE_LABELS[l]}
              {!byLocale.has(l) ? " •" : ""}
            </button>
          ))}
        </div>
      </div>
      <PolicyVersionEditor
        key={active}
        slug={slug}
        locale={active}
        doc={byLocale.get(active)}
        onSaved={onSaved}
      />
    </section>
  );
}

export default function PoliciesPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const policies = api.admin.policies.useQuery();
  const invalidate = () => utils.admin.policies.invalidate();

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.policies.title")}</h1>
        <p className="muted mt-1">{t("admin.policies.subtitle")}</p>
      </div>

      {policies.isLoading && <p className="muted">{t("admin.policies.loading")}</p>}
      {[...groups.entries()].map(([slug, byLocale]) => (
        <PolicyCard key={slug} slug={slug} byLocale={byLocale} onSaved={invalidate} />
      ))}
      {groups.size === 0 && !policies.isLoading && (
        <p className="muted">{t("admin.policies.empty")}</p>
      )}
    </div>
  );
}
