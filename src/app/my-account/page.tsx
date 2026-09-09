import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import AccountPage from "~/app/(admin)/admin/account/page";
export default async function Page() {
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("settings")}>
      <AccountPage />
    </WorkflowShell>
  );
}
