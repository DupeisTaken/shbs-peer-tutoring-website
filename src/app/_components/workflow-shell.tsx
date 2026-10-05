import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { WorkspaceHeader } from "./workspace-header";
import { SectionLinks } from "./section-links";
import { APP_TITLE } from "~/lib/branding";
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
  const account = await getTranslations("components.userMenu");
  return (
    <div className="min-h-screen">
      <WorkspaceHeader
        href="/"
        title={APP_TITLE}
        items={[
          ...(staff ? [{ href: "/admin", label: account("enterAdmin") }] : []),
          // A Viewer must change membership before entering participant onboarding.
          ...(user.role !== "VIEWER"
            ? [{ href: "/student", label: account("enterTutee") }]
            : []),
        ]}
        identity={<span className="text-sm font-medium">{user.name}</span>}
        account={
          <SignOutButton className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0" />
        }
      />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <SectionLinks
          label={title}
          items={[
            { href: "/my-account", label: t("settings") },
            { href: "/", label: t("home") },
            { href: "/messages", label: t("messages") },
            ...(staff
              ? [{ href: "/student-support", label: t("support") }]
              : []),
          ]}
        />
        <h1 className="page-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}
