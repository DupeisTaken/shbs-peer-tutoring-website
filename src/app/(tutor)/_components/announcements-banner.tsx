"use client";

import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { Button } from "~/app/_components/ui/button";
import { InlineNotice, StatePanel } from "~/app/_components/ui/patterns";
import { formatClientError } from "~/lib/client-error-message";

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
        <StatePanel kind="loading" title={t("tutor.tasks.loading")} />
      )}
      {announcements.error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button
              size="compact"
              onClick={() => void announcements.refetch()}
            >
              {t("tutor.tasks.retry")}
            </Button>
          }
        >
          {t("tutor.tasks.loadError")}
        </InlineNotice>
      )}
      {ack.error && (
        <InlineNotice tone="error" announcement="alert">
          {formatClientError(ack.error, t)}
        </InlineNotice>
      )}
      {visible.map((a) => (
        <InlineNotice
          key={a.id}
          tone="accent"
          action={
            !a.pinned ? (
              <Button
                size="compact"
                disabled={ack.isPending}
                onClick={() => ack.mutate({ announcementId: a.id })}
              >
                {t("common.dismiss")}
              </Button>
            ) : undefined
          }
        >
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
        </InlineNotice>
      ))}
    </section>
  );
}
