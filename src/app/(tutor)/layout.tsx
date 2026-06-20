import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { UserAvatar } from "~/app/_components/user-avatar";
import { NotificationBell } from "~/app/_components/notification-bell";
import { APP_TITLE } from "~/lib/branding";

/**
 * Gates the entire tutor section. Requires an authenticated user linked to a Tutor record.
 * Authorization is enforced here on the server (in addition to the middleware and per-procedure
 * checks) — never trust the client. Also enforces first-login onboarding and renders the
 * shared tutor top bar with the user-avatar menu.
 */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/signin");
  if (!session.tutorId) redirect("/");

  // First-login gate: unverified users confirm their contact email + 2FA first.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      emailVerifiedAt: true,
      tutor: { select: { username: true } },
    },
  });
  if (!me?.emailVerifiedAt) redirect("/onboarding/email");

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="text-lg font-bold text-slate-900">
            {APP_TITLE}
          </Link>
          <div className="flex items-center gap-4">
            <span className="muted hidden sm:inline">{session.user.name}</span>
            <NotificationBell />
            <UserAvatar
              name={session.user.name ?? "Tutor"}
              username={me?.tutor?.username}
              email={me?.email}
              role={session.role}
            />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
