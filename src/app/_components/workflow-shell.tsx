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
  // Messages and Tutee Support are already in SectionLinks; keep the avatar menu focused on account destinations.
  const avatarItems = [
    {
      href: "/my-account",
      label: t("settings"),
      group: "account" as const,
    },
    ...(canTutor
      ? [
          {
            href: "/settings",
            label: rootT("account.tutorSettings"),
            group: "account" as const,
          },
        ]
      : []),
  ];
  const handle = user.username;
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
            className="hidden shrink-0 rounded-md px-2 py-0.5 text-right leading-tight hover:bg-slate-100 lg:block"
            title={t("settings")}
          >
            <p className="max-w-44 truncate text-[13px] font-medium text-slate-900">
              {user.name ?? user.username}
            </p>
            <p className="muted text-[11px]">
              {handle ? `@${handle} · ` : ""}
              {rootT(`admin.users.roles.${user.role}`)}
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
