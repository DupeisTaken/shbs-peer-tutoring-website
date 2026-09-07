import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import { InterviewManagement } from "~/app/_components/interview-management";
export default async function Page() {
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("interviewComplete")} management={true}>
      <InterviewManagement />
    </WorkflowShell>
  );
}
