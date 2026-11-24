import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SignOutButton } from "~/app/_components/sign-out-button";
import { DetailsAutoClose } from "~/app/_components/details-auto-close";

export type UserAvatarGroup = "workspaces" | "tools" | "account";

export type UserAvatarItem = {
  href: string;
  label: string;
  group?: UserAvatarGroup;
};

const GROUP_ORDER: readonly UserAvatarGroup[] = [
  "workspaces",
  "tools",
  "account",
];

/** First letters of the first and last words of a name (max 2), uppercased. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last =
    parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * Top-right user menu: an avatar circle (initials) that opens a dropdown with the user's
 * name / username / email, clearly grouped workspace / tool / account links, and a sign-out
 * control. Built on a native <details>/<summary> with DetailsAutoClose so it closes on outside click.
 */
export async function UserAvatar({
  name,
  username,
  email,
  role,
  items = [],
  compactAtDesktop = false,
}: {
  name: string;
  username?: string | null;
  email?: string | null;
  role?: string;
  items?: UserAvatarItem[];
  /** Keeps dashboard menus touch-friendly on mobile while removing desktop-only empty space. */
  compactAtDesktop?: boolean;
}) {
  const t = await getTranslations();
  const deduped = [
    ...items,
    {
      href: "/history",
      label: t("tuteeHistory.myHistory"),
      group: "account" as const,
    },
    {
      href: "/register",
      label: t("accountInvitation.addAccess"),
      group: "account" as const,
    },
  ].filter(
    (item, index, all) =>
      all.findIndex((other) => other.href === item.href) === index,
  );

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    title: t(`components.userMenu.groups.${group}`),
    items: deduped.filter((item) => (item.group ?? "tools") === group),
  })).filter((section) => section.items.length > 0);

  return (
    <details className="group relative">
      <DetailsAutoClose />
      <summary
        aria-label={t("account.title")}
        title={t("account.title")}
        className="focus-visible:ring-accent-500 flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 lg:min-w-8 [&::-webkit-details-marker]:hidden"
      >
        <span className="bg-accent-600 group-open:ring-accent-200 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-white transition lg:h-8 lg:w-8 lg:text-xs">
          {initials(name)}
        </span>
      </summary>

      <div
        className={`absolute right-0 z-30 mt-2 max-h-[calc(100dvh-5rem)] w-[min(15.5rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-lg ${
          compactAtDesktop ? "lg:p-2.5" : ""
        }`}
      >
        <div className="border-b border-slate-100 pb-2.5">
          <p className="truncate text-sm font-semibold text-slate-900">
            {name}
          </p>
          {username && <p className="muted truncate text-xs">@{username}</p>}
          {email && <p className="muted truncate text-xs">{email}</p>}
          {role && (
            <span className="badge-slate mt-2 inline-block text-[10px]">
              {t.has(`admin.users.roles.${role}`)
                ? t(`admin.users.roles.${role}`)
                : role}
            </span>
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {grouped.map((section) => (
            <div
              key={section.group}
              className={`py-2 ${compactAtDesktop ? "lg:py-1.5" : ""}`}
            >
              <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">
                {section.title}
              </p>
              <div
                className={`grid gap-0.5 ${
                  compactAtDesktop ? "lg:gap-0" : ""
                }`}
              >
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-link flex min-h-11 items-center text-sm ${
                      compactAtDesktop ? "lg:min-h-0 lg:py-1.5" : ""
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div
          className={`border-t border-slate-100 pt-2 ${
            compactAtDesktop ? "lg:pt-1.5" : ""
          }`}
        >
          <SignOutButton
            className={`btn-secondary min-h-11 w-full ${
              compactAtDesktop ? "lg:min-h-0 lg:py-1.5" : ""
            }`}
          />
        </div>
      </div>
    </details>
  );
}
