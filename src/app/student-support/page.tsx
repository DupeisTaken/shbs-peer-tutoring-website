import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import { StudentSupport } from "~/app/_components/student-support";
import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
export default async function Page() {
  const session = await auth();
  // Preserve opt-in shared feedback for participants; staff receive their complete admin shell.
  if (session && ["HEAD", "ADMIN", "COORDINATOR"].includes(session.role))
    redirect("/admin/student-support");
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("support")}>
      <StudentSupport />
    </WorkflowShell>
  );
}
