"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { api } from "~/trpc/react";

type PolicyDoc = {
  id: string;
  slug: string;
  title: string;
  body: string;
  version: string | null;
  updatedAt: Date;
  updatedBy: { name: string | null; email: string } | null;
};

function PolicyEditor({ doc, onSaved }: { doc: PolicyDoc; onSaved: () => void }) {
  const t = useTranslations();
  const [title, setTitle] = useState(doc.title);
  const [version, setVersion] = useState(doc.version ?? "");
  const [body, setBody] = useState(doc.body);
  const update = api.admin.updatePolicy.useMutation({ onSuccess: onSaved });

  const dirty = title !== doc.title || version !== (doc.version ?? "") || body !== doc.body;

  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          className="input max-w-md text-lg font-semibold"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="input max-w-[10rem]"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder={t("admin.policies.editor.versionPlaceholder")}
        />
      </div>
      <p className="muted text-xs">
        {t("admin.policies.editor.slugLabel")} <code>{doc.slug}</code>{" "}
        {t("admin.policies.editor.lastEdited", { date: new Date(doc.updatedAt).toLocaleString() })}
        {doc.updatedBy
          ? " " + t("admin.policies.editor.editedBy", { who: doc.updatedBy.name ?? doc.updatedBy.email })
          : ""}
      </p>
      <textarea
        className="textarea w-full font-mono text-xs"
        rows={18}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <button
          className="btn-primary btn-sm"
          disabled={!dirty || !title.trim() || !body.trim() || update.isPending}
          onClick={() =>
            update.mutate({
              id: doc.id,
              title: title.trim(),
              version: version.trim() || null,
              body,
            })
          }
        >
          {update.isPending ? t("admin.policies.editor.saving") : t("admin.policies.editor.save")}
        </button>
        {update.isSuccess && !dirty && (
          <span className="text-sm text-green-600">{t("admin.policies.editor.saved")}</span>
        )}
        {update.error && <span className="text-sm text-red-600">{update.error.message}</span>}
      </div>
    </section>
  );
}

export default function PoliciesPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const policies = api.admin.policies.useQuery();
  const invalidate = () => utils.admin.policies.invalidate();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.policies.title")}</h1>
        <p className="muted mt-1">{t("admin.policies.subtitle")}</p>
      </div>

      {policies.isLoading && <p className="muted">{t("admin.policies.loading")}</p>}
      {(policies.data ?? []).map((doc) => (
        <PolicyEditor key={doc.id} doc={doc} onSaved={invalidate} />
      ))}
      {policies.data?.length === 0 && (
        <p className="muted">{t("admin.policies.empty")}</p>
      )}
    </div>
  );
}
