import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SignOutButton } from "~/app/_components/sign-out-button";
import { DetailsAutoClose } from "~/app/_components/details-auto-close";
import { ChevronDownIcon } from "~/app/_components/icons";

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
 * Top-bar account menu trigger: on desktop (`lg+`), renders the two-line account identity
 * (`Name` / `@username · Role`) with a quiet chevron (no circular avatar); on mobile (`<lg`),
 * retains the compact circular initials badge. Opens a dropdown with account details, clearly
 * grouped workspace / tool / account links, and a sign-out control. Built on a native
 * `<details>`/`<summary>` with `DetailsAutoClose` so it closes on outside click.
 */
export async function UserAvatar({
  name,
  username,
  email,
  role,
  roleLabel,
  items = [],
  compactAtDesktop = false,
}: {
  name: string;
  username?: string | null;
  email?: string | null;
  role?: string;
  /** Optional desktop trigger subtitle role override (e.g. Crew in the patrol workspace). */
  roleLabel?: string;
  items?: UserAvatarItem[];
  /** Keeps dashboard menus touch-friendly on mobile while removing desktop-only empty space. */
  compactAtDesktop?: boolean;
}) {
  const t = await getTranslations();
  const translatedRole = role
    ? t.has(`admin.users.roles.${role}`)
      ? t(`admin.users.roles.${role}`)
      : role
    : undefined;
  const triggerRole = roleLabel ?? translatedRole;
  const triggerSubtitle = [
    username ? `@${username}` : null,
    triggerRole ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  const deduped = [
    ...items,
    {
      href: "/history",
      label: t("tuteeHistory.myHistory"),
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
        className="focus-visible:ring-accent-500 lg:group-open:bg-accent-50 lg:group-open:ring-accent-200/80 flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 lg:min-w-0 lg:gap-1.5 lg:rounded-lg lg:px-2 lg:py-0.5 lg:leading-tight lg:hover:bg-slate-100/90 lg:group-open:ring-1 [&::-webkit-details-marker]:hidden"
      >
        <span className="bg-accent-600 group-open:ring-accent-200 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-white transition lg:hidden">
          {initials(name)}
        </span>
        <span className="hidden min-w-0 text-right lg:block">
          <span className="block max-w-44 truncate text-[13px] font-medium text-slate-900">
            {name}
          </span>
          {triggerSubtitle && (
            <span className="muted block max-w-44 truncate text-[11px]">
              {triggerSubtitle}
            </span>
          )}
        </span>
        <ChevronDownIcon className="group-open:text-accent-600 hidden h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-150 group-open:rotate-180 lg:block" />
      </summary>

      <div
        className={`popover-surface absolute right-0 z-30 mt-2 max-h-[calc(100dvh-5rem)] w-[min(15.5rem,calc(100vw-2rem))] overflow-y-auto p-3 ${
          compactAtDesktop ? "lg:p-2.5" : ""
        }`}
      >
        <div className="border-b border-slate-100 pb-2.5">
          <p className="truncate text-sm font-semibold text-slate-900">
            {name}
          </p>
          {username && <p className="muted truncate text-xs">@{username}</p>}
          {email && <p className="muted truncate text-xs">{email}</p>}
          {translatedRole && (
            <span className="badge-slate mt-2 inline-block text-[10px]">
              {translatedRole}
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
