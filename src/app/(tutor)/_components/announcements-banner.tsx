"use client";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/**
 * Team announcements surfaced at the top of the tutor dashboard. Unacknowledged ones show
 * prominently on every login until the tutor dismisses them; pinned announcements stay
 * visible (as a quieter note) even after acknowledgement.
 */
export function AnnouncementsBanner() {
  const t = useTranslations();
  const utils = api.useUtils();
  const announcements = api.tutor.myAnnouncements.useQuery();
  const ack = api.tutor.acknowledgeAnnouncement.useMutation({
    onSuccess: () => utils.tutor.myAnnouncements.invalidate(),
  });

  const list = announcements.data ?? [];
  const unacked = list.filter((a) => !a.acked);
  const pinnedAcked = list.filter((a) => a.acked && a.pinned);

  if (unacked.length === 0 && pinnedAcked.length === 0) return null;

  return (
    <section className="space-y-3" aria-label={t("tutor.announcements.label")}>
      {unacked.map((a) => (
        <div
          key={a.id}
          className="border-accent-200 bg-accent-50 rounded-lg border px-4 py-3"
        >
          <div className="grid gap-3 sm:flex sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-accent-900 font-semibold">
                📣 {a.title}
                {a.pinned && (
                  <span className="badge-slate ml-2 align-middle text-[10px]">
                    {t("tutor.announcements.pinned")}
                  </span>
                )}
              </p>
              <p className="text-accent-800 mt-1 text-sm whitespace-pre-line">
                {a.body}
              </p>
              <p className="text-accent-400 mt-1 text-xs">
                {new Date(a.createdAt).toLocaleDateString()}
              </p>
            </div>
            <button
              className="btn-secondary btn-sm justify-self-start sm:shrink-0"
              disabled={ack.isPending}
              onClick={() => ack.mutate({ announcementId: a.id })}
            >
              {t("common.dismiss")}
            </button>
          </div>
        </div>
      ))}

      {pinnedAcked.map((a) => (
        <div
          key={a.id}
          className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2"
        >
          <p className="text-sm font-medium text-slate-700">📌 {a.title}</p>
          <p className="mt-0.5 text-sm whitespace-pre-line text-slate-600">
            {a.body}
          </p>
        </div>
      ))}
    </section>
  );
}
