import { pageMetadata } from "~/server/branding-metadata";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StudentSupport } from "~/app/_components/student-support";
import { auth } from "~/server/auth";

/** Staff queues keep the same navigation and visual shell as the other management pages. */
export async function generateMetadata() {
  return pageMetadata("workflows.support");
}

export default async function StudentSupportPage() {
  const session = await auth();
  if (!session || !["HEAD", "ADMIN", "COORDINATOR"].includes(session.role))
    redirect("/student-support");
  const t = await getTranslations("workflows");
  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("support")}</h1>
      <StudentSupport />
    </div>
  );
}
