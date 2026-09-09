import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import { StudentPortal } from "~/app/_components/student-portal";
import { StudentWorkspace } from "./student-workspace";

export const dynamic = "force-dynamic";
/** One authenticated home preserves intake actions and personal history across program refreshes. */
export default async function StudentPage() {
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("student")}>
      <StudentWorkspace />
      <StudentPortal />
    </WorkflowShell>
  );
}
