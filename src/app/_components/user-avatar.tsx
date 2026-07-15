import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SignOutButton } from "~/app/_components/sign-out-button";
import { DetailsAutoClose } from "~/app/_components/details-auto-close";

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
 * name / username / email, contextual navigation links, and a sign-out control. Built on a
 * native <details>/<summary> with DetailsAutoClose so it closes on an outside click.
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
  items?: { href: string; label: string }[];
  /** Keeps dashboard menus touch-friendly on mobile while removing desktop-only empty space. */
  compactAtDesktop?: boolean;
}) {
  const t = await getTranslations();
  return (
    <details className="group relative">
      <DetailsAutoClose />
      <summary
        aria-label={t("account.title")}
        title={t("account.title")}
        className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md [&::-webkit-details-marker]:hidden"
      >
        <span className="bg-accent-600 group-open:ring-accent-200 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-white transition">
          {initials(name)}
        </span>
      </summary>

      <div
        className={`absolute right-0 z-30 mt-2 w-[min(14rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg ${
          compactAtDesktop ? "lg:p-2" : ""
        }`}
      >
        <div className="border-b border-slate-100 pb-2">
          <p className="truncate text-sm font-semibold text-slate-900">
            {name}
          </p>
          {username && <p className="muted truncate text-xs">@{username}</p>}
          {email && <p className="muted truncate text-xs">{email}</p>}
          {role && (
            <span className="badge-slate mt-2 inline-block text-[10px]">
              {role}
            </span>
          )}
        </div>
        <div
          className={`grid gap-1 pt-2 ${
            compactAtDesktop ? "lg:gap-0 lg:pt-1" : ""
          }`}
        >
          {items.map((item) => (
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
        <div className={compactAtDesktop ? "pt-2 lg:pt-1" : "pt-2"}>
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
