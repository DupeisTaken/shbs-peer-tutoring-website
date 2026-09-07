import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import { StudentPortal } from "~/app/_components/student-portal";
export default async function Page() {
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("student")}>
      <StudentPortal />
    </WorkflowShell>
  );
}
