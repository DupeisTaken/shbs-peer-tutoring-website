import { StudentWorkspace } from "./student-workspace";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";

export const dynamic = "force-dynamic";
/** Read only the signed-in account's student relation; email/name matches never grant access. */
export default async function StudentPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const [user, t] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        suspendedAt: true,
      },
    }),
    getTranslations("survey"),
  ]);
  if (!user) redirect("/signin");
  if (user.suspendedAt) redirect("/suspended");
  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-6 px-4 py-12">
      <FloatingLanguageSwitcher />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">{t("portalTitle")}</h1>
          <p className="muted mt-2">
            {user.name} · {user.email}
          </p>
        </div>
        <SignOutButton />
      </header>
      <StudentWorkspace />
    </main>
  );
}
