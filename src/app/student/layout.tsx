import Link from "next/link";
import { redirect } from "next/navigation";
import { getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { APP_TITLE } from "~/lib/branding";
import { NotificationBell } from "~/app/_components/notification-bell";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { UserAvatar } from "~/app/_components/user-avatar";
import { TuteeNavigation } from "./navigation";
import { getFeatures } from "~/server/program/features";
import { tuteePeriodMessages } from "./period-messages";

/** Participation is independent of role. All active accounts enter; APIs scope records by ownership. */
export default async function TuteeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const [me, t, messages, features] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        username: true,
        role: true,
        suspendedAt: true,
        tutor: { select: { status: true } },
      },
    }),
    getTranslations(),
    getMessages(),
    getFeatures(db),
  ]);
  if (!me) redirect("/signin");
  if (me.suspendedAt) redirect("/suspended");
  const elevated = ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"].includes(me.role);
  const canTutor = !!me.tutor && (!elevated || me.tutor.status !== "ARCHIVED");
  const items = [
    { href: "/student?view=account", label: t("tuteePortal.account") },
    { href: "/student?view=messages", label: t("tuteePortal.messages") },
    ...(canTutor
      ? [{ href: "/dashboard", label: t("components.userMenu.enterTutor") }]
      : []),
    ...(elevated
      ? [{ href: "/admin", label: t("components.userMenu.enterAdmin") }]
      : []),
  ];
  const content = (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="grid min-w-0 gap-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-6">
          <Link
            href="/student"
            className="flex min-h-11 min-w-0 items-center truncate text-lg font-bold text-slate-900"
          >
            {APP_TITLE}
          </Link>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Link
              href="/student?view=account"
              className="hidden max-w-48 truncate rounded-md px-2 py-1 text-sm font-medium hover:bg-slate-100 lg:block"
            >
              {me.name ?? me.username}
            </Link>
            <ThemeSwitcher compactAtDesktop />
            <NotificationBell />
            <LanguageSwitcher compactAtDesktop />
            <UserAvatar
              name={me.name ?? me.username ?? me.email}
              username={me.username}
              email={me.email}
              role={me.role}
              items={items}
              compactAtDesktop
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:py-8">
        <TuteeNavigation />
        {children}
      </main>
    </div>
  );
  // Nested messages affect client workflow panels without changing global policy-gate copy.
  return features.QUARTER_SYSTEM ? (
    content
  ) : (
    <NextIntlClientProvider messages={tuteePeriodMessages(messages, false)}>
      {content}
    </NextIntlClientProvider>
  );
}
