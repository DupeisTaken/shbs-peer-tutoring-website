import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { WorkspaceHeader } from "./workspace-header";
import { SectionLinks } from "./section-links";
import { UserAvatar } from "./user-avatar";
import Link from "next/link";
import {
  resolveWorkspaceNavigation,
  workspaceNavLabels,
  workspaceSwitcherLabels,
} from "~/lib/workspace-navigation";

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
  const [rootT, features] = await Promise.all([
    getTranslations(),
    getFeatures(db),
  ]);
  const t = (key: string) => rootT(`workflows.${key}`);
  const common = (key: string) => rootT(`common.${key}`);
  const account = (key: string) => rootT(`components.userMenu.${key}`);
  const elevated = staff || user.role === "VIEWER";
  // Match participant-shell entry semantics; an archived elevated link preserves history only.
  const canTutor =
    !user.tutorAccessRevoked &&
    !!user.tutor &&
    (!elevated || user.tutor.status !== "ARCHIVED");
  const nav = resolveWorkspaceNavigation({
    account: user,
    crewEnabled: features.CREW,
    currentArea: null,
    labels: workspaceNavLabels(rootT),
  });
  const taskItems = [
    { href: "/my-account", label: t("settings") },
    { href: "/", label: t("home") },
    { href: "/messages", label: t("messages") },
    ...(staff ? [{ href: "/student-support", label: t("support") }] : []),
  ];
  return (
    <div className="min-h-screen">
      <WorkspaceHeader
        href="/"
        title={title}
        switcherItems={nav.items}
        switcherLabels={workspaceSwitcherLabels(rootT)}
        skipLabel={common("skipToContent")}
        containerClassName="mx-auto max-w-5xl"
        identity={
          <Link
            href="/my-account"
            className="hidden max-w-48 truncate rounded-md px-2 py-0.5 text-[13px] font-medium hover:bg-slate-100 lg:block"
          >
            {user.name ?? user.username}
          </Link>
        }
        account={await UserAvatar({
          name: user.name ?? user.username ?? user.email,
          username: user.username,
          email: user.email,
          role: user.role,
          compactAtDesktop: true,
          items: [
            {
              href: "/messages",
              label: t("messages"),
              group: "tools" as const,
            },
            ...(staff
              ? [
                  {
                    href: "/student-support",
                    label: t("support"),
                    group: "tools" as const,
                  },
                ]
              : []),
            {
              href: "/my-account",
              label: t("settings"),
              group: "account" as const,
            },
            ...(canTutor
              ? [
                  {
                    href: "/settings",
                    label: account("settings"),
                    group: "account" as const,
                  },
                ]
              : []),
          ],
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
