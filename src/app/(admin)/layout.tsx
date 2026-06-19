import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";

const ELEVATED_ROLES = ["ADMIN", "COORDINATOR"];

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/pairings", label: "Pairings" },
  { href: "/admin/submissions", label: "Submissions" },
  { href: "/admin/summary", label: "Monthly summary" },
  { href: "/admin/meetings", label: "Meetings" },
  { href: "/admin/punishments", label: "Punishments" },
  { href: "/admin/adjustments", label: "Adjustments" },
  { href: "/admin/tutors", label: "Tutors" },
  { href: "/admin/tutees", label: "Tutees" },
  { href: "/admin/rooms", label: "Rooms" },
];

/**
 * Gates the entire admin section. Requires an elevated role (ADMIN or COORDINATOR).
 * Server-enforced; the middleware only checks authentication, not role.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/signin");
  if (!ELEVATED_ROLES.includes(session.role)) redirect("/");

  const isAdmin = session.role === "ADMIN";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
          <span className="font-bold">SHBS Admin</span>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-gray-600 hover:text-indigo-600">
              {n.label}
            </Link>
          ))}
          {isAdmin && (
            <Link href="/admin/users" className="text-gray-600 hover:text-indigo-600">
              Users
            </Link>
          )}
          <span className="ml-auto text-gray-400">
            {session.user.name} · {session.role}
          </span>
          <Link href="/api/auth/signout" className="text-gray-600 hover:text-indigo-600">
            Sign out
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
    </div>
  );
}
