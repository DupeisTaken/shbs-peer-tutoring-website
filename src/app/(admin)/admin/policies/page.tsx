"use client";

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
          placeholder="version"
        />
      </div>
      <p className="muted text-xs">
        Slug <code>{doc.slug}</code> · Markdown · last edited{" "}
        {new Date(doc.updatedAt).toLocaleString()}
        {doc.updatedBy ? ` by ${doc.updatedBy.name ?? doc.updatedBy.email}` : ""}
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
          {update.isPending ? "Saving…" : "Save"}
        </button>
        {update.isSuccess && !dirty && (
          <span className="text-sm text-green-600">Saved.</span>
        )}
        {update.error && <span className="text-sm text-red-600">{update.error.message}</span>}
      </div>
    </section>
  );
}

export default function PoliciesPage() {
  const utils = api.useUtils();
  const policies = api.admin.policies.useQuery();
  const invalidate = () => utils.admin.policies.invalidate();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Policy documents</h1>
        <p className="muted mt-1">
          Edit the tutor and tutee handbooks. Written in Markdown; the saved copy is the
          source of truth.
        </p>
      </div>

      {policies.isLoading && <p className="muted">Loading…</p>}
      {(policies.data ?? []).map((doc) => (
        <PolicyEditor key={doc.id} doc={doc} onSaved={invalidate} />
      ))}
      {policies.data?.length === 0 && (
        <p className="muted">No policy documents yet. Run the seed to create them.</p>
      )}
    </div>
  );
}
