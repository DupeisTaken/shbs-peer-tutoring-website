import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import { StudentSupport } from "~/app/_components/student-support";
export default async function Page() {
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("support")}>
      <StudentSupport />
    </WorkflowShell>
  );
}
