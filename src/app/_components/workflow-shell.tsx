import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { WorkspaceHeader } from "./workspace-header";
import { SectionLinks } from "./section-links";
import { APP_TITLE } from "~/lib/branding";
import { UserAvatar } from "./user-avatar";
import Link from "next/link";
import { portalAccess } from "~/lib/portal-access";

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
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { tutor: { select: { status: true } }, schoolDeparture: true },
  });
  if (!user) redirect("/signin");
  if (user.suspendedAt) redirect("/suspended");
  const staff = ["HEAD", "ADMIN", "COORDINATOR"].includes(user.role);
  if (management && !staff) redirect("/");
  const t = await getTranslations("workflows");
  const common = await getTranslations("common");
  const account = await getTranslations("components.userMenu");
  const accountCopy = await getTranslations("account");
  const roles = await getTranslations("admin.users.roles");
  const access = portalAccess(user);
  const elevated = staff || user.role === "VIEWER";
  // Match participant-shell entry semantics; an archived elevated link preserves history only.
  const canTutor =
    !user.tutorAccessRevoked &&
    !!user.tutor &&
    (!elevated || user.tutor.status !== "ARCHIVED");
  const workspaceItems = [
    ...(access.canReadManagement
      ? [
          {
            href: "/admin",
            label: access.managementReadOnly
              ? (await getTranslations("schoolDeparture"))("enter")
              : account("backToManagement"),
          },
        ]
      : []),
    ...(canTutor ? [{ href: "/dashboard", label: account("enterTutor") }] : []),
    ...(user.role !== "VIEWER" && (access.canParticipate || access.departed)
      ? [{ href: "/student", label: account("enterTutee") }]
      : []),
  ];
  const taskItems = [
    { href: "/my-account", label: t("settings") },
    { href: "/", label: t("home") },
    { href: "/messages", label: t("messages") },
    ...(staff ? [{ href: "/student-support", label: t("support") }] : []),
  ];
  const avatarItems = [
    { href: "/my-account", label: t("settings") },
    ...(canTutor
      ? [{ href: "/settings", label: accountCopy("tutorSettings") }]
      : []),
  ];
  const handle = user.username;
  return (
    <div className="min-h-screen">
      <WorkspaceHeader
        href="/"
        title={APP_TITLE}
        skipLabel={common("skipToContent")}
        containerClassName="mx-auto max-w-6xl"
        items={workspaceItems}
        identity={
          <Link
            href="/my-account"
            className="hidden shrink-0 rounded-md px-2 py-1 text-right leading-tight hover:bg-slate-100 lg:block"
            title={t("settings")}
          >
            <p className="max-w-44 truncate text-sm font-medium text-slate-900">
              {user.name ?? user.username}
            </p>
            <p className="muted text-xs">
              {handle ? `@${handle} · ` : ""}
              {roles(user.role)}
            </p>
          </Link>
        }
        account={await UserAvatar({
          name: user.name ?? user.username ?? user.email,
          username: user.username,
          email: user.email,
          role: user.role,
          compactAtDesktop: true,
          items: avatarItems,
        })}
      />
      <main
        id="main-content"
        className="mx-auto max-w-5xl space-y-6 px-4 py-6"
      >
        <SectionLinks label={title} items={taskItems} />
        <h1 className="page-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}
