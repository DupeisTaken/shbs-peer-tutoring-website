"use client";

import Link from "next/link";
import { useState } from "react";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatNotificationEvent } from "~/lib/notification-events";
import { navigateNotificationFragment } from "~/lib/notification-navigation";

import { api } from "~/trpc/react";
import { DetailsAutoClose } from "~/app/_components/details-auto-close";
import { useClampedPopover } from "~/app/_components/use-clamped-popover";

/**
 * Bell + dropdown of the signed-in user's in-app notifications, with an unread badge.
 * Available to all roles; a native <details> with DetailsAutoClose for outside-click close.
 */
export function NotificationBell() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const eventText = useTranslations("notificationEvents");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const panelRef = useClampedPopover<HTMLDivElement>(open);
  const utils = api.useUtils();
  const list = api.notification.list.useQuery();
  const unread = api.notification.unreadCount.useQuery();
  const invalidate = async () => {
    await Promise.all([
      utils.notification.list.invalidate(),
      utils.notification.unreadCount.invalidate(),
    ]);
  };
  const markAll = api.notification.markAllRead.useMutation({
    onSuccess: invalidate,
  });
  const markOne = api.notification.markRead.useMutation({
    onSuccess: invalidate,
  });

  const items = list.data ?? [];
  const count = unread.data ?? 0;

  return (
    <details
      className="group relative"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <DetailsAutoClose />
      <summary className="relative flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        <span
          className="text-xl"
          aria-label={t("components.notifications.title")}
        >
          🔔
        </span>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </summary>

      <div
        ref={panelRef}
        className="absolute right-0 z-20 mt-2 hidden w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white shadow-lg group-open:block"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-sm font-semibold text-slate-900">
            {t("components.notifications.title")}
          </span>
          {count > 0 && (
            <button
              className="link min-h-11 text-xs lg:min-h-8"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              {t("components.notifications.markAllRead")}
            </button>
          )}
        </div>
        <ul className="max-h-[min(24rem,calc(100dvh-16rem))] overflow-y-auto">
          {items.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-slate-400">
              {t("components.notifications.empty")}
            </li>
          )}
          {items.map((n) => {
            // New notices localize an explicit event. Older records retain their
            // original readable text without guessing an event from private body text.
            const copy = formatNotificationEvent(
              n.event,
              n.context,
              locale,
              eventText,
            );
            const title = copy?.title ?? n.title;
            const body = copy?.body ?? n.body;
            const inner = (
              <>
                <p
                  className={`text-sm text-slate-800 ${n.readAt ? "font-medium" : "font-semibold"}`}
                >
                  {title}
                </p>
                {body && (
                  <p className="mt-1 text-xs leading-relaxed break-words text-slate-600">
                    {body}
                  </p>
                )}
                {copy?.time && (
                  <p className="mt-1 text-xs break-words text-slate-600">
                    {copy.time}
                  </p>
                )}
                <p className="text-[10px] text-slate-400">
                  {programFormat.dateTime(new Date(n.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </>
            );
            const cls = `block min-h-11 px-3 py-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-600 ${
              n.readAt ? "bg-white" : "bg-accent-50/40"
            }`;
            return (
              <li key={n.id} className="border-b border-slate-50 last:border-0">
                {n.link ? (
                  <Link
                    href={n.link}
                    onNavigate={(event) =>
                      navigateNotificationFragment(n.link!, event)
                    }
                    className={cls}
                    onClick={() => markOne.mutate({ id: n.id })}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    className={`w-full ${cls}`}
                    onClick={() => markOne.mutate({ id: n.id })}
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
