import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { APP_TITLE } from "~/lib/branding";

/**
 * Gates the entire tutor section. Requires an authenticated user linked to a Tutor record.
 * Authorization is enforced here on the server (in addition to the middleware and per-procedure
 * checks) — never trust the client. Provides the shared tutor top bar (with sign-out).
 */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/signin");
  if (!session.tutorId) redirect("/");

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="text-lg font-bold text-slate-900">
            {APP_TITLE}
          </Link>
          <div className="flex items-center gap-4">
            <span className="muted hidden sm:inline">{session.user.name}</span>
            <SignOutButton className="btn-secondary btn-sm" />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
