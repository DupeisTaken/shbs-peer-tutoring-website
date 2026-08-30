"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation link with active-state styling. `exact` matches the pathname exactly
 * (use it for index routes like "/admin"); otherwise a route and its children match.
 */
export function NavLink({
  href,
  label,
  exact = false,
  className = "",
}: {
  href: string;
  label: string;
  exact?: boolean;
  /** Optional context-specific sizing without duplicating active-link behavior. */
  className?: string;
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`nav-link ${active ? "nav-link-active" : ""} ${className}`}
    >
      {label}
    </Link>
  );
}
