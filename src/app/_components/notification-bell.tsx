"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DetailsAutoClose } from "~/app/_components/details-auto-close";

/**
 * Bell + dropdown of the signed-in user's in-app notifications, with an unread badge.
 * Available to all roles; a native <details> with DetailsAutoClose for outside-click close.
 */
export function NotificationBell() {
  const t = useTranslations();
  const utils = api.useUtils();
  const list = api.notification.list.useQuery();
  const unread = api.notification.unreadCount.useQuery();
  const invalidate = async () => {
    await Promise.all([
      utils.notification.list.invalidate(),
      utils.notification.unreadCount.invalidate(),
    ]);
  };
  const markAll = api.notification.markAllRead.useMutation({ onSuccess: invalidate });
  const markOne = api.notification.markRead.useMutation({ onSuccess: invalidate });

  const items = list.data ?? [];
  const count = unread.data ?? 0;

  return (
    <details className="group relative">
      <DetailsAutoClose />
      <summary className="relative flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
        <span className="text-xl" aria-label={t("components.notifications.title")}>
          🔔
        </span>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </summary>

      <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-sm font-semibold text-slate-900">
            {t("components.notifications.title")}
          </span>
          {count > 0 && (
            <button className="link text-xs" onClick={() => markAll.mutate()}>
              {t("components.notifications.markAllRead")}
            </button>
          )}
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {items.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-slate-400">
              {t("components.notifications.empty")}
            </li>
          )}
          {items.map((n) => {
            const inner = (
              <>
                <p className="text-sm font-medium text-slate-800">{n.title}</p>
                {n.body && <p className="muted text-xs">{n.body}</p>}
                <p className="text-[10px] text-slate-400">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </>
            );
            const cls = `block px-3 py-2 text-left hover:bg-slate-50 ${
              n.readAt ? "opacity-60" : "bg-accent-50/40"
            }`;
            return (
              <li key={n.id} className="border-b border-slate-50 last:border-0">
                {n.link ? (
                  <Link href={n.link} className={cls} onClick={() => markOne.mutate({ id: n.id })}>
                    {inner}
                  </Link>
                ) : (
                  <button className={`w-full ${cls}`} onClick={() => markOne.mutate({ id: n.id })}>
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
