"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";
import { useDialog } from "~/app/_components/confirm-dialog";

type Announcement = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  active: boolean;
  createdAt: Date;
  createdBy: { name: string | null } | null;
  _count: { acks: number };
};

function AnnouncementCard({
  a,
  onChanged,
  readOnly,
}: {
  a: Announcement;
  onChanged: () => void;
  readOnly: boolean;
}) {
  const t = useTranslations();
  const { confirm, dialog } = useDialog();
  const [title, setTitle] = useState(a.title);
  const [body, setBody] = useState(a.body);
  const update = api.admin.updateAnnouncement.useMutation({ onSuccess: onChanged });
  const del = api.admin.deleteAnnouncement.useMutation({ onSuccess: onChanged });

  const dirty = title !== a.title || body !== a.body;

  return (
    <div className={`card space-y-3 p-4 ${a.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {readOnly ? (
          <span className="flex-1 font-semibold text-slate-900">{a.title}</span>
        ) : (
          <input
            className="input flex-1 font-semibold"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
        {a.pinned && <span className="badge-slate">{t("admin.announcements.badge.pinned")}</span>}
        <span className={a.active ? "badge-green" : "badge-slate"}>
          {a.active ? t("admin.announcements.badge.active") : t("admin.announcements.badge.inactive")}
        </span>
      </div>
      {readOnly ? (
        <p className="whitespace-pre-wrap text-slate-700">{a.body}</p>
      ) : (
        <textarea
          className="textarea w-full"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <button
            className="btn-primary btn-sm"
            disabled={!dirty || !title.trim() || !body.trim() || update.isPending}
            onClick={() => update.mutate({ id: a.id, title: title.trim(), body: body.trim() })}
          >
            {t("admin.announcements.card.save")}
          </button>
        )}
        {!readOnly && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => update.mutate({ id: a.id, pinned: !a.pinned })}
          >
            {a.pinned ? t("admin.announcements.card.unpin") : t("admin.announcements.card.pin")}
          </button>
        )}
        {!readOnly && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => update.mutate({ id: a.id, active: !a.active })}
          >
            {a.active ? t("admin.announcements.card.deactivate") : t("admin.announcements.card.reactivate")}
          </button>
        )}
        <span className="muted text-xs">
          {t("admin.announcements.card.dismissed", { count: a._count.acks })} ·{" "}
          {new Date(a.createdAt).toLocaleDateString()}
          {a.createdBy?.name ? ` · ${a.createdBy.name}` : ""}
        </span>
        {!readOnly && (
          <button
            className="link-danger ml-auto text-sm"
            onClick={async () => {
              if (
                await confirm({
                  title: t("admin.announcements.card.confirmDelete"),
                  confirmLabel: t("common.delete"),
                  cancelLabel: t("common.cancel"),
                  danger: true,
                })
              )
                del.mutate({ id: a.id });
            }}
          >
            {t("admin.announcements.card.delete")}
          </button>
        )}
      </div>
      {dialog}
    </div>
  );
}

export default function AnnouncementsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const announcements = api.admin.announcements.useQuery();
  const invalidate = () => utils.admin.announcements.invalidate();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const create = api.admin.createAnnouncement.useMutation({
    onSuccess: async () => {
      setTitle("");
      setBody("");
      setPinned(false);
      await invalidate();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.announcements.title")}</h1>
        <p className="muted mt-1">{t("admin.announcements.subtitle")}</p>
      </div>

      {!readOnly && (
      <section className="card space-y-3 p-5">
        <h2 className="section-title">{t("admin.announcements.new.title")}</h2>
        <input
          className="input w-full"
          placeholder={t("admin.announcements.new.titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="textarea w-full"
          rows={3}
          placeholder={t("admin.announcements.new.messagePlaceholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            {t("admin.announcements.new.pinLabel")}
          </label>
          <button
            className="btn-primary btn-sm"
            disabled={!title.trim() || !body.trim() || create.isPending}
            onClick={() =>
              create.mutate({ title: title.trim(), body: body.trim(), pinned })
            }
          >
            {create.isPending ? t("admin.announcements.new.posting") : t("admin.announcements.new.broadcast")}
          </button>
        </div>
      </section>
      )}

      <div className="space-y-3">
        {(announcements.data ?? []).map((a) => (
          <AnnouncementCard key={a.id} a={a} onChanged={invalidate} readOnly={readOnly} />
        ))}
        {announcements.data?.length === 0 && (
          <p className="muted">{t("admin.announcements.empty")}</p>
        )}
      </div>
    </div>
  );
}
