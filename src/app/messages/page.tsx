import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import { MessageInbox } from "~/app/_components/message-inbox";
export default async function Page() {
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("messages")}>
      <MessageInbox />
    </WorkflowShell>
  );
}
