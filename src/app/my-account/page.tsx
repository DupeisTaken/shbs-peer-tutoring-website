import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import { AccountSettings } from "~/app/_components/account-settings";
export default async function Page() {
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("settings")}>
      <AccountSettings />
    </WorkflowShell>
  );
}
