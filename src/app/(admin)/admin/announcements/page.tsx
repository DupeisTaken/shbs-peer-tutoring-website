"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

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
}: {
  a: Announcement;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(a.title);
  const [body, setBody] = useState(a.body);
  const update = api.admin.updateAnnouncement.useMutation({ onSuccess: onChanged });
  const del = api.admin.deleteAnnouncement.useMutation({ onSuccess: onChanged });

  const dirty = title !== a.title || body !== a.body;

  return (
    <div className={`card space-y-3 p-4 ${a.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 font-semibold"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {a.pinned && <span className="badge-slate">pinned</span>}
        <span className={a.active ? "badge-green" : "badge-slate"}>
          {a.active ? "active" : "inactive"}
        </span>
      </div>
      <textarea
        className="textarea w-full"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary btn-sm"
          disabled={!dirty || !title.trim() || !body.trim() || update.isPending}
          onClick={() => update.mutate({ id: a.id, title: title.trim(), body: body.trim() })}
        >
          Save
        </button>
        <button
          className="btn-secondary btn-sm"
          onClick={() => update.mutate({ id: a.id, pinned: !a.pinned })}
        >
          {a.pinned ? "Unpin" : "Pin"}
        </button>
        <button
          className="btn-secondary btn-sm"
          onClick={() => update.mutate({ id: a.id, active: !a.active })}
        >
          {a.active ? "Deactivate" : "Reactivate"}
        </button>
        <span className="muted text-xs">
          {a._count.acks} dismissed · {new Date(a.createdAt).toLocaleDateString()}
          {a.createdBy?.name ? ` · ${a.createdBy.name}` : ""}
        </span>
        <button
          className="link-danger ml-auto text-sm"
          onClick={() => {
            if (confirm("Delete this announcement?")) del.mutate({ id: a.id });
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function AnnouncementsPage() {
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
        <h1 className="page-title">Announcements</h1>
        <p className="muted mt-1">
          Broadcast to tutors. Each shows on their dashboard on every login until they
          dismiss it; pinned ones stay visible.
        </p>
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold text-slate-900">New announcement</h2>
        <input
          className="input w-full"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="textarea w-full"
          rows={3}
          placeholder="Message…"
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
            Pin (stays visible after dismissal)
          </label>
          <button
            className="btn-primary btn-sm"
            disabled={!title.trim() || !body.trim() || create.isPending}
            onClick={() =>
              create.mutate({ title: title.trim(), body: body.trim(), pinned })
            }
          >
            {create.isPending ? "Posting…" : "Broadcast"}
          </button>
        </div>
      </section>

      <div className="space-y-3">
        {(announcements.data ?? []).map((a) => (
          <AnnouncementCard key={a.id} a={a} onChanged={invalidate} />
        ))}
        {announcements.data?.length === 0 && (
          <p className="muted">No announcements yet.</p>
        )}
      </div>
    </div>
  );
}
