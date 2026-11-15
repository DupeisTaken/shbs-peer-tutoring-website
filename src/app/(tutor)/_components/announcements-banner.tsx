"use client";

import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/**
 * Team announcements share one prominent card. Pinned posts stay visible regardless
 * of earlier acknowledgements; only ordinary posts can be dismissed from the dashboard.
 */
export function AnnouncementsBanner() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const utils = api.useUtils();
  const announcements = api.tutor.myAnnouncements.useQuery();
  const ack = api.tutor.acknowledgeAnnouncement.useMutation({
    onSuccess: () => utils.tutor.myAnnouncements.invalidate(),
  });

  const list = announcements.data ?? [];
  // Preserve the server's pinned-first order, including previously dismissed pins.
  const visible = list.filter((a) => a.pinned || !a.acked);

  if (visible.length === 0 && !announcements.error && !announcements.isLoading)
    return null;

  return (
    <section className="space-y-3" aria-label={t("tutor.announcements.label")}>
      {announcements.isLoading && (
        <p role="status">{t("tutor.tasks.loading")}</p>
      )}
      {announcements.error && (
        <p role="alert">
          {t("tutor.tasks.loadError")}{" "}
          <button
            className="btn-secondary btn-sm"
            onClick={() => void announcements.refetch()}
          >
            {t("tutor.tasks.retry")}
          </button>
        </p>
      )}
      {ack.error && (
        <p role="alert" className="text-sm text-red-700">
          {ack.error.message}
        </p>
      )}
      {visible.map((a) => (
        <div
          key={a.id}
          className="border-accent-200 bg-accent-50 rounded-lg border px-4 py-3"
        >
          <div className="grid gap-3 sm:flex sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-accent-900 font-semibold">
                {a.pinned && (
                  <>
                    <span aria-hidden="true">📌 </span>
                    <span className="sr-only">
                      {t("tutor.announcements.pinned")}{" "}
                    </span>
                  </>
                )}
                📣 {a.title}
              </p>
              <p className="text-accent-800 mt-1 text-sm whitespace-pre-line">
                {a.body}
              </p>
              <p className="text-accent-700 mt-1 text-xs">
                {programFormat.dateTime(new Date(a.createdAt), {
                  dateStyle: "medium",
                })}
              </p>
            </div>
            {!a.pinned && (
              <button
                className="btn-secondary btn-sm justify-self-start sm:shrink-0"
                disabled={ack.isPending}
                onClick={() => ack.mutate({ announcementId: a.id })}
              >
                {t("common.dismiss")}
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
