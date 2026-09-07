import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { NotificationBell } from "./notification-bell";
import { LanguageSwitcher } from "./language-switcher";
import { SignOutButton } from "./sign-out-button";

/** Shared, small shell for participant and management workflows; APIs enforce data ownership. */
export async function WorkflowShell({
  title,
  children,
  management = false,
}: {
  title: string;
  children: React.ReactNode;
  management?: boolean;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/signin");
  if (user.suspendedAt) redirect("/suspended");
  const staff = ["HEAD", "ADMIN", "COORDINATOR"].includes(user.role);
  if (management && !staff) redirect("/");
  const t = await getTranslations("workflows");
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link className="link" href="/my-account">
            {t("settings")}
          </Link>
          <Link className="link" href="/">
            {t("home")}
          </Link>
          <Link className="link" href="/student">
            {t("student")}
          </Link>
          <Link className="link" href="/messages">
            {t("messages")}
          </Link>
          {staff && (
            <Link className="link" href="/student-support">
              {t("support")}
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <LanguageSwitcher />
          <SignOutButton />
        </div>
      </header>
      <h1 className="page-title">{title}</h1>
      {children}
    </main>
  );
}
