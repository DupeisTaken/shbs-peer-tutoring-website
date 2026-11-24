"use client";

import { usePathname } from "next/navigation";

/** Viewer read-only banner for management pages; hidden on self-service /admin/account
 * where the user's own profile, password, emails, and preferences remain interactive. */
export function AdminReadOnlyBanner({ message }: { message: string }) {
  const pathname = usePathname();
  if (pathname === "/admin/account") return null;
  return (
    <div className="border-accent-200 bg-accent-50 mb-5 flex items-center gap-3 rounded-xl border px-4 py-2.5">
      <span
        aria-hidden
        className="bg-accent-100 text-accent-700 ring-accent-200 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="2.6" />
        </svg>
      </span>
      <p className="text-accent-800 text-sm leading-snug">{message}</p>
    </div>
  );
}
